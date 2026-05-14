import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Modal, PanResponder, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { FlexWeekSheet } from '@/components/FlexWeekSheet';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import { ImportPlanSheet } from '@/components/ImportPlanSheet';
import { SessionRemoveIconButton } from '@/components/session-remove-icon-button';
import { getSportIcon } from '@/components/sport-icon';
import { SkeletonBlock } from '@/components/loading-ui';
import { TabHeader, TAB_SCREEN_CONTENT_PADDING_TOP, TAB_SCREEN_PADDING_HORIZONTAL } from '@/components/tab-header';
import { usePromptRemoveSession } from '@/hooks/usePromptRemoveSession';
import { sessionQueryKeys, useActiveAthlete, useMonthSessions, useRaceGoals, useWeekSessions } from '@/hooks/useSessionData';
import { useScrollToTopTabRef } from '@/hooks/useScrollToTopTabRef';
import { useTheme } from '@/contexts/ThemeContext';
import { StatusAreaFade } from '@/components/status-area-fade';
import { LogSessionSheet } from '@/components/LogSessionSheet';
import { withAlpha } from '@/lib/theme-utils';
import { requestPlanReoptimization } from '@/lib/plan-reoptimization';
import {
  daysUntilIsoDate,
  getMainGoalRaceForPlanning,
  getPrimaryRaceForPlanning,
  getRaceFocusInfo,
  raceMarkerForPriority,
  racePriorityLabel,
  type RaceMarker,
} from '@/services/racePriority';
import { usePlanAdjustmentStore } from '@/store/plan-adjustment-store';
import { supabase } from '@/lib/supabase';
import { datePickerMondayWeekProps, mondayBasedMonthLeadingDayCount } from '@/lib/dates';

type SessionStatus = 'planned' | 'completed' | 'skipped';
type SessionDotStatus = 'planned' | 'completed';

type DayCell = {
  key: string;
  isoDate: string | null;
  dayNumber: number | null;
};

type RaceGoalCalendarEvent = {
  id: string;
  name: string;
  date: string;
  priority: 'a' | 'b' | 'c';
  raceType: string | null;
  distance: string;
  isRace: boolean;
  notes: string | null;
};

type ViewMode = 'calendar' | 'week';

type WeekSession = {
  id: string;
  title: string;
  sport: string;
  scheduled_date: string;
  duration_mins: number | null;
  distance: number | null;
  distance_unit: string | null;
  intensity: string | null;
  status: string | null;
  completionStatus?: SessionStatus;
};

type DayBucketLayout = {
  y: number;
  height: number;
};

const weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Normalize `race_goals.event_date` from DB (`date` or timestamptz string) to `YYYY-MM-DD` for calendar keys. */
function raceGoalCalendarDateKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function getMonthGrid(anchor: Date): DayCell[] {
  const startOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const dayCount = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const leading = mondayBasedMonthLeadingDayCount(startOfMonth);
  const cells: DayCell[] = [];

  for (let i = 0; i < leading; i += 1) {
    cells.push({ key: `leading-${i}`, isoDate: null, dayNumber: null });
  }

  for (let day = 1; day <= dayCount; day += 1) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth(), day);
    cells.push({ key: toIsoDate(date), isoDate: toIsoDate(date), dayNumber: day });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trailing-${cells.length}`, isoDate: null, dayNumber: null });
  }

  return cells;
}

function getWeekWindow(start: Date): string[] {
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return toIsoDate(value);
  });
}

function getWeekStartMonday(anchor: Date) {
  const day = anchor.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatWeekHeader(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatWeekSessionSubtitle(session: WeekSession) {
  const duration = session.duration_mins != null ? `${session.duration_mins} min` : '—';
  const intensity = session.intensity ?? 'Steady';
  return `${duration} · ${intensity}`;
}


function WeekSummaryCard({
  swimCount,
  bikeCount,
  runCount,
  restCount,
  totalTimeLabel,
}: {
  swimCount: number;
  bikeCount: number;
  runCount: number;
  restCount: number;
  totalTimeLabel: string;
}) {
  const { theme } = useTheme();
  const metrics = [
    { value: swimCount, label: 'swim' },
    { value: bikeCount, label: 'bike' },
    { value: runCount, label: 'run' },
    { value: restCount, label: 'rest' },
    { value: totalTimeLabel, label: 'total time' },
  ];
  return (
    <View style={[styles.weekSummaryCard, { backgroundColor: theme.surface, borderColor: withAlpha(theme.primary, 0.1) }]}>
      <View style={styles.weekSummaryMetricsRow}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.weekSummaryMetricCard}>
            <Text style={[styles.weekSummaryMetricValue, { color: theme.text }]}>{metric.value}</Text>
            <Text style={[styles.weekSummaryMetricLabel, { color: theme.textMuted }]}>{metric.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function DragHandleAffordance() {
  const { theme } = useTheme();
  return (
    <View style={styles.weekSessionDragHandle} pointerEvents="none">
      <View style={[styles.weekSessionDragHandleLine, { backgroundColor: withAlpha(theme.text, 0.45) }]} />
      <View style={[styles.weekSessionDragHandleLine, { backgroundColor: withAlpha(theme.text, 0.45) }]} />
      <View style={[styles.weekSessionDragHandleLine, { backgroundColor: withAlpha(theme.text, 0.45) }]} />
    </View>
  );
}

function SessionMarkerRow({
  dots,
  raceMarker,
}: {
  dots: SessionDotStatus[];
  raceMarker?: RaceMarker;
}) {
  const { theme } = useTheme();
  const showRace = Boolean(raceMarker);
  const showDots = dots.length > 0;
  const showOverflow = dots.length > 3;
  const visibleDots = dots.slice(0, 3);

  if (!showRace && !showDots) {
    return <View style={styles.markerRow} />;
  }

  return (
    <View style={styles.markerRow}>
      {showRace ? (
        raceMarker === 'c_dot' ? (
          <View style={[styles.racePriorityDot, { backgroundColor: '#B16C3D' }]} />
        ) : (
          <Ionicons name="flag" size={10} color={raceMarker === 'a_flag' ? '#C97E2F' : '#B0B7C3'} />
        )
      ) : null}
      {showDots
        ? visibleDots.map((status, index) => (
            <View
              key={`${status}-${index}`}
              style={[
                status === 'planned' ? styles.dayDotPlanned : styles.dayDotCompleted,
                status === 'planned' ? { backgroundColor: theme.primary } : { backgroundColor: theme.accent },
              ]}
            />
          ))
        : null}
      {showOverflow ? (
        <Text style={[styles.dotOverflowText, { color: theme.text }]} allowFontScaling={false}>
          3+
        </Text>
      ) : null}
    </View>
  );
}

type WeekSessionCardProps = {
  session: WeekSession;
  onPress: (sessionId: string) => void;
  onLongPress?: (sessionId: string) => void;
  onRemovePress?: (session: WeekSession) => void;
  onDrop: (session: WeekSession, dropY: number) => void;
  onDragStateChange: (isDragging: boolean) => void;
};

function WeekSessionCard({ session, onPress, onLongPress, onRemovePress, onDrop, onDragStateChange }: WeekSessionCardProps) {
  const { theme } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const completed = (session.completionStatus ?? session.status) === 'completed';
  const canDrag = (session.completionStatus ?? session.status) === 'planned';
  const isWeb = Platform.OS === 'web';
  const [isActiveDrag, setIsActiveDrag] = useState(false);
  const [isDragPrimed, setIsDragPrimed] = useState(false);
  const suppressPressRef = useRef(false);

  const resetDragPosition = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 5,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 5,
      }),
    ]).start(() => {
      setIsActiveDrag(false);
      setIsDragPrimed(false);
      onDragStateChange(false);
    });
  }, [onDragStateChange, translateX, translateY]);

  const panResponder = useMemo(() => {
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (!canDrag) return false;
        if (!isWeb && !isDragPrimed) return false;
        const absDx = Math.abs(gestureState.dx);
        const absDy = Math.abs(gestureState.dy);
        // Require a deliberate mostly-vertical gesture so tap/scroll feels natural.
        return absDy > 12 && absDy > absDx + 4;
      },
      onPanResponderGrant: () => {
        setIsActiveDrag(true);
        onDragStateChange(true);
      },
      onPanResponderMove: Animated.event([null, { dx: translateX, dy: translateY }], {
        useNativeDriver: true,
      }),
      onPanResponderRelease: (_, gestureState) => {
        suppressPressRef.current = true;
        setTimeout(() => {
          suppressPressRef.current = false;
        }, 220);
        if (canDrag) onDrop(session, gestureState.moveY);
        resetDragPosition();
      },
      onPanResponderTerminate: () => {
        suppressPressRef.current = true;
        setTimeout(() => {
          suppressPressRef.current = false;
        }, 220);
        resetDragPosition();
      },
    });
  }, [canDrag, isDragPrimed, isWeb, onDragStateChange, onDrop, resetDragPosition, session, translateX, translateY]);

  const panHandlers = panResponder?.panHandlers ?? {};

  return (
    <Animated.View
      style={[
        styles.weekSessionCardOuter,
        {
          backgroundColor: theme.surface,
          borderColor: completed ? withAlpha(theme.accent, 0.55) : withAlpha(theme.primary, 0.1),
        },
        { transform: [{ translateX }, { translateY }] },
        isActiveDrag ? styles.weekSessionCardDragging : null,
      ]}
      {...panHandlers}>
      <View style={styles.weekSessionCardInner}>
        <Pressable
          style={styles.weekSessionPressableMain}
          onPressIn={() => {
            if (isWeb && canDrag) {
              setIsDragPrimed(true);
            }
          }}
          onPressOut={() => {
            if (isWeb && !isActiveDrag) {
              setIsDragPrimed(false);
            }
          }}
          onPress={() => {
            if (isActiveDrag || isDragPrimed || suppressPressRef.current) return;
            if (session.id) {
              onPress(session.id);
            }
          }}
          onLongPress={() => {
            if (!canDrag) {
              if (session.id) onLongPress?.(session.id);
              return;
            }
            setIsDragPrimed(true);
            suppressPressRef.current = true;
            setTimeout(() => {
              suppressPressRef.current = false;
            }, 260);
          }}>
          {completed ? (
            <View style={styles.weekSessionCheckCol}>
              <View style={[styles.weekSessionCheckBubble, { backgroundColor: theme.accent }]}>
                <Ionicons name="checkmark" size={14} color={theme.surface} />
              </View>
            </View>
          ) : null}
          <View style={[styles.weekSessionIconWrap, { backgroundColor: theme.primary }]}>
            {getSportIcon(session.sport, 16, theme.surface)}
            <View style={[styles.weekSessionIconAccentDot, { backgroundColor: theme.accent }]} />
          </View>
          <View style={styles.weekSessionCopy}>
            <Text
              style={[
                styles.weekSessionTitle,
                { color: completed ? withAlpha(theme.text, 0.72) : theme.text },
              ]}
              numberOfLines={1}>
              {session.title}
            </Text>
            <Text style={[styles.weekSessionMeta, { color: theme.textMuted }]} numberOfLines={1}>
              {formatWeekSessionSubtitle(session)}
              {completed ? (
                <>
                  {' · '}
                  <Text style={{ color: theme.accent }}>Completed</Text>
                </>
              ) : null}
            </Text>
          </View>
        </Pressable>
        <View style={styles.weekSessionTrailing}>
          {onRemovePress && session.id ? (
            <SessionRemoveIconButton
              iconColor={withAlpha(theme.primary, 0.45)}
              onPress={() => onRemovePress(session)}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Session details"
            hitSlop={10}
            style={styles.weekSessionChevronHit}
            onPress={() => {
              if (isActiveDrag || suppressPressRef.current) return;
              if (session.id) onPress(session.id);
            }}>
            <Ionicons name="chevron-forward" size={16} color={withAlpha(theme.primary, 0.2)} />
          </Pressable>
          {canDrag ? <DragHandleAffordance /> : null}
        </View>
      </View>
    </Animated.View>
  );
}

export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tabScrollRef = useScrollToTopTabRef();
  const { theme } = useTheme();
  const weekPickerThemeVariant = theme.id === 'obsidianIce' ? 'dark' : 'light';
  const enqueueAdjustment = usePlanAdjustmentStore((state) => state.enqueueAdjustment);
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [selectedDate, setSelectedDate] = useState(() => toIsoDate(new Date()));
  const [raceLoading, setRaceLoading] = useState(true);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rescheduleNotice, setRescheduleNotice] = useState<string | null>(null);
  const [logSheetOpen, setLogSheetOpen] = useState(false);
  const [logSheetInitialDate, setLogSheetInitialDate] = useState<string | undefined>(undefined);
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [importSheetInitialDate, setImportSheetInitialDate] = useState<string | undefined>(undefined);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const lastCalendarTapRef = useRef<{ iso: string | null; time: number }>({ iso: null, time: 0 });
  const dayBucketRefs = useRef<Record<string, View | null>>({});
  const dayBucketLayouts = useRef<Record<string, DayBucketLayout>>({});
  const queryClient = useQueryClient();
  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const [weekStart, setWeekStart] = useState(() => getWeekStartMonday(new Date()));
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [weekPickerDate, setWeekPickerDate] = useState(() => new Date());

  const showFeedback = useCallback((message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    Alert.alert(message);
  }, []);
  const [isFlexWeekOpen, setIsFlexWeekOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const weekDates = useMemo(() => getWeekWindow(weekStart), [weekStart]);
  const {
    data: monthSessions = [],
    isLoading: monthLoading,
    isFetching: monthFetching,
    refetch: refetchMonthSessions,
  } = useMonthSessions(monthAnchor.getFullYear(), monthAnchor.getMonth());
  const { data: athlete } = useActiveAthlete();
  const { data: raceGoals = [], isLoading: raceGoalsLoading } = useRaceGoals(athlete?.id);
  const {
    data: weekSessionsByDate = {},
    isLoading: weekLoading,
    isFetching: weekFetching,
    error: weekQueryError,
    refetch: refetchWeekSessions,
  } = useWeekSessions(weekStart);

  const refreshRaces = useCallback(async () => {
    setRaceLoading(true);
    try {
      // Keep loading state parity with other refresh hooks.
    } finally {
      setRaceLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRaces();
  }, [refreshRaces]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refetchMonthSessions(), refetchWeekSessions(), refreshRaces()]);
    setIsRefreshing(false);
  }, [refetchMonthSessions, refetchWeekSessions, refreshRaces]);

  const calendarDays = useMemo(() => getMonthGrid(monthAnchor), [monthAnchor]);
  const racesByDate = useMemo(() => {
    const grouped: Record<string, RaceGoalCalendarEvent[]> = {};
    for (const row of raceGoals) {
      const dateKey = raceGoalCalendarDateKey(row.event_date);
      if (!dateKey) continue;
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({
        id: row.id,
        name: row.title,
        date: dateKey,
        priority: row.priority === 'a' || row.priority === 'b' ? row.priority : 'c',
        raceType: row.race_type,
        distance: row.goal_overall_time ?? '',
        isRace: true,
        notes: null,
      });
    }
    for (const date of Object.keys(grouped)) {
      grouped[date].sort((a, b) => {
        const rank = (p: 'a' | 'b' | 'c') => (p === 'a' ? 3 : p === 'b' ? 2 : 1);
        return rank(b.priority) - rank(a.priority);
      });
    }
    return grouped;
  }, [raceGoals]);
  const primaryRace = useMemo(() => getPrimaryRaceForPlanning(raceGoals, todayIso), [raceGoals, todayIso]);
  const mainGoalRace = useMemo(() => getMainGoalRaceForPlanning(raceGoals, todayIso), [raceGoals, todayIso]);
  const phaseAnchorRace = mainGoalRace ?? primaryRace;
  const raceFocus = useMemo(() => getRaceFocusInfo(phaseAnchorRace, todayIso), [phaseAnchorRace, todayIso]);
  const selectedDateRaces = racesByDate[selectedDate] ?? [];
  const showCalendarMarkers = !monthLoading && !raceLoading && !raceGoalsLoading;
  const sessionDotsByDate = useMemo(() => {
    const grouped: Record<string, SessionDotStatus[]> = {};
    for (const session of monthSessions) {
      const marker: SessionDotStatus = session.completionStatus === 'completed' ? 'completed' : 'planned';
      if (!grouped[session.scheduled_date]) grouped[session.scheduled_date] = [];
      grouped[session.scheduled_date].push(marker);
    }
    return grouped;
  }, [monthSessions]);
  const selectedDateDots = sessionDotsByDate[selectedDate] ?? [];
  const selectedDateSessions = useMemo(
    () => monthSessions.filter((session) => session.scheduled_date === selectedDate),
    [monthSessions, selectedDate]
  );
  const hasScheduledSession = selectedDateDots.length > 0;
  const selectedDateLabel = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }, [selectedDate]);

  const monthTitle = monthAnchor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const weekSummary = useMemo(() => {
    const allSessions = Object.values(weekSessionsByDate).flat();
    const nonRestSessions = allSessions.filter((session) => session.sport !== 'rest');
    const totalDurationMins = nonRestSessions.reduce((sum, session) => sum + (session.duration_mins ?? 0), 0);
    const hours = Math.floor(totalDurationMins / 60);
    const mins = totalDurationMins % 60;
    const totalTimeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    const swimCount = allSessions.filter((s) => s.sport === 'swim').length;
    const bikeCount = allSessions.filter((s) => s.sport === 'bike').length;
    const runCount = allSessions.filter((s) => s.sport === 'run').length;

    const restCount = weekDates.filter((date) => {
      const daySessions = weekSessionsByDate[date] ?? [];
      if (daySessions.length === 0) return true;
      return daySessions.every((s) => s.sport === 'rest');
    }).length;

    return {
      swimCount,
      bikeCount,
      runCount,
      restCount,
      totalTimeLabel,
    };
  }, [weekDates, weekSessionsByDate]);

  const weekRangeLabel = useMemo(() => {
    const start = weekStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    const end = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6).toLocaleDateString(
      'en-AU',
      { day: 'numeric', month: 'short' }
    );
    return `Mon ${start} - Sun ${end}`;
  }, [weekStart]);

  const goPrevWeek = () => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      return getWeekStartMonday(next);
    });
  };

  const goNextWeek = () => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7);
      return getWeekStartMonday(next);
    });
  };

  const openWeekPicker = () => {
    setWeekPickerDate(new Date(weekStart));
    setWeekPickerOpen(true);
  };

  const closeWeekPicker = () => {
    setWeekPickerOpen(false);
  };

  const applyWeekPickerDate = (date: Date) => {
    setWeekStart(getWeekStartMonday(date));
  };

  /** Omit `targetDate` to default the log sheet to today's date. */
  const openLogSessionSheet = (targetDate?: string) => {
    setLogSheetInitialDate(targetDate);
    setLogSheetOpen(true);
  };

  const handleLoggedSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  }, [queryClient]);

  const openImportSheet = useCallback(
    (opts?: { mode?: 'template' | 'manual'; sessionId?: string | null; date?: string }) => {
      setEditingSessionId(opts?.sessionId ?? null);
      setImportSheetInitialDate(opts?.date);
      setImportSheetOpen(true);
    },
    []
  );

  const handleImportComplete = useCallback(
    (firstDate?: string) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
      ]);
      if (firstDate) {
        setSelectedDate(firstDate);
        const [y, m, d] = firstDate.split('-').map(Number);
        setMonthAnchor(new Date(y, (m ?? 1) - 1, 1));
        const anchor = new Date(y, (m ?? 1) - 1, d ?? 1);
        setWeekStart(getWeekStartMonday(anchor));
      }
      setViewMode('calendar');
    },
    [queryClient]
  );

  const resolveDropDay = (dropY: number): string | null => {
    let nearestDay: string | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const dayIso of weekDates) {
      const layout = dayBucketLayouts.current[dayIso];
      if (!layout) continue;
      if (dropY >= layout.y && dropY <= layout.y + layout.height) {
        return dayIso;
      }
      const center = layout.y + layout.height / 2;
      const distance = Math.abs(dropY - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestDay = dayIso;
      }
    }
    return nearestDay;
  };

  const collectBucketLayouts = () => {
    for (const dayIso of weekDates) {
      const node = dayBucketRefs.current[dayIso];
      if (!node) continue;
      node.measureInWindow((_x, y, _width, height) => {
        dayBucketLayouts.current[dayIso] = { y, height };
      });
    }
  };

  const { promptRemoveSession } = usePromptRemoveSession(athlete?.id, (message) => {
    setWeekError(null);
    showFeedback(message);
  });

  const handleSessionDrop = async (session: WeekSession, dropY: number) => {
    const moveStatus = session.completionStatus ?? session.status;
    if (moveStatus !== 'planned') {
      showFeedback('Only planned sessions can be moved.');
      return;
    }

    if (!session.id) {
      const message = 'Could not move session: missing session id.';
      setWeekError(message);
      showFeedback(message);
      return;
    }

    if (!athlete?.id) {
      const message = 'Could not move session: no active athlete found.';
      setWeekError(message);
      showFeedback('Could not move session because your athlete profile is not loaded.');
      return;
    }

    const targetDate = resolveDropDay(dropY);
    if (!targetDate || targetDate === session.scheduled_date) {
      return;
    }

    const previousDate = session.scheduled_date;
    setWeekError(null);
    setRescheduleNotice(null);

    const weekQueryKey = sessionQueryKeys.week(weekDates[0]);
    const previousWeekState = queryClient.getQueryData<Record<string, WeekSession[]>>(weekQueryKey);
    if (previousWeekState) {
      const sourceItems = [...(previousWeekState[previousDate] ?? [])];
      const movingIndex = sourceItems.findIndex((item) => item.id === session.id);
      if (movingIndex >= 0) {
        const [moving] = sourceItems.splice(movingIndex, 1);
        const targetItems = [...(previousWeekState[targetDate] ?? []), { ...moving, scheduled_date: targetDate }];
        queryClient.setQueryData<Record<string, WeekSession[]>>(weekQueryKey, {
          ...previousWeekState,
          [previousDate]: sourceItems,
          [targetDate]: targetItems,
        });
      }
    }

    const result = await supabase
      .from('sessions')
      .update({ scheduled_date: targetDate })
      .eq('id', session.id)
      .eq('athlete_id', athlete.id)
      .eq('status', 'planned')
      .select('id')
      .maybeSingle();
    if (result.error || !result.data) {
      if (previousWeekState) {
        queryClient.setQueryData(weekQueryKey, previousWeekState);
      }
      const details = result.error?.message ?? 'session was not eligible to move';
      setWeekError(details);
      showFeedback(`Could not move session: ${details}.`);
      return;
    }

    setWeekError(null);
    setRescheduleNotice('Session moved. AI re-optimization will arrive in a future update.');

    const adjustment = {
      sessionId: session.id,
      fromDate: previousDate,
      toDate: targetDate,
      movedAt: new Date().toISOString(),
      source: 'week_drag_drop' as const,
    };
    enqueueAdjustment(adjustment);
    await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    void requestPlanReoptimization(adjustment);
  };

  const updateRacePriority = async (raceId: string, nextPriority: 'a' | 'b' | 'c') => {
    const { error } = await supabase.from('race_goals').update({ priority: nextPriority }).eq('id', raceId);
    if (error) {
      showFeedback(`Could not update race priority: ${error.message}`);
      return;
    }
    if (athlete?.id) {
      await queryClient.invalidateQueries({ queryKey: ['race_goals', athlete.id] });
    }
    await queryClient.invalidateQueries({ queryKey: ['race_goals'] });
  };

  const themed = useMemo(
    () => ({
      screen: { backgroundColor: theme.base },
      refreshTint: theme.primary,
      refreshColors: [theme.primary] as string[],
      icon: theme.primary,
      card: { backgroundColor: theme.surface, borderColor: withAlpha(theme.primary, 0.1) },
      cardMuted: { color: theme.textMuted },
      cardText: { color: theme.text },
      dayTextBase: { color: theme.onSurface },
      subtleText: { color: theme.textMuted },
      heading: { color: theme.primary },
      buttonSurface: { backgroundColor: theme.surface, borderColor: withAlpha(theme.primary, 0.1) },
      toggleWrap: { backgroundColor: theme.base, borderColor: withAlpha(theme.primary, 0.1) },
      togglePillActive: { backgroundColor: theme.surface },
      toggleText: { color: withAlpha(theme.primary, 0.6) },
      toggleTextActive: { color: theme.primary },
      phaseIndicator: { backgroundColor: theme.primary },
      phaseAccent: { backgroundColor: theme.accent },
      phaseOnPrimary: { color: theme.onPrimary },
      phaseMutedOnPrimary: { color: withAlpha(theme.onPrimary, 0.78) },
      phaseTrack: { backgroundColor: withAlpha(theme.onPrimary, 0.22) },
      phaseBorder: { borderTopColor: withAlpha(theme.onPrimary, 0.22) },
      phaseDotMuted: { backgroundColor: withAlpha(theme.onPrimary, 0.4) },
      phaseLabelMuted: { color: withAlpha(theme.onPrimary, 0.74) },
      phaseRangeMuted: { color: withAlpha(theme.onPrimary, 0.64) },
      dayTextSelected: { color: theme.onPrimary },
      calendarCell: { backgroundColor: theme.surface },
      calendarTodayRing: { borderColor: theme.primary, backgroundColor: theme.surface },
      calendarSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
      calendarRaceBorder: { borderColor: theme.primary },
      markerPlanned: { backgroundColor: theme.primary },
      markerCompleted: { backgroundColor: theme.accent },
      weekNotice: { color: theme.accent },
      draggingBorder: { borderColor: withAlpha(theme.accent, 0.35) },
      raceBadge: { borderColor: withAlpha(theme.primary, 0.2), backgroundColor: withAlpha(theme.primary, 0.08) },
      raceFlag: { color: theme.primary },
      weekNavBtn: { borderColor: withAlpha(theme.primary, 0.12), backgroundColor: theme.surface },
      weekPickerBackdrop: { backgroundColor: withAlpha('#000000', 0.42) },
      weekPickerSheet: { borderColor: withAlpha(theme.primary, 0.12), backgroundColor: theme.surface },
      selectedSessionItem: { borderColor: withAlpha(theme.primary, 0.1), backgroundColor: withAlpha(theme.primary, 0.06) },
      raceBadgeText: { color: theme.text },
      raceMeta: { color: theme.textMuted },
      softBg: { backgroundColor: withAlpha(theme.primary, 0.06) },
      accentBg: { backgroundColor: theme.accent },
      accentText: { color: theme.accent },
    }),
    [theme]
  );

  return (
    <SafeAreaView style={[styles.screen, themed.screen]} edges={['top', 'left', 'right']}>
      <StatusAreaFade height={insets.top + 8} />
      <ScrollView
        ref={tabScrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!isDragging}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            tintColor={themed.refreshTint}
            colors={themed.refreshColors}
            refreshing={isRefreshing || ((monthFetching || weekFetching) && !monthLoading && !weekLoading)}
            onRefresh={() => void onRefresh()}
          />
        }>
        <TabHeader
          title="Plan"
          right={
            <>
              <Pressable
                style={[styles.flexButton, themed.buttonSurface]}
                hitSlop={8}
                onPress={() => setIsFlexWeekOpen(true)}>
                <Ionicons name="sparkles-outline" size={18} color={themed.icon} />
              </Pressable>
              <Pressable
                style={[styles.importButton, { borderColor: withAlpha(theme.primary, 0.35), backgroundColor: theme.base }]}
                hitSlop={8}
                onPress={() => openImportSheet({ mode: 'template' })}>
                <Ionicons name="download-outline" size={14} color={theme.primary} />
                <Text style={[styles.importButtonText, { color: theme.primary }]}>Import</Text>
              </Pressable>
              <Pressable
                style={[styles.addButton, themed.buttonSurface]}
                hitSlop={8}
                onPress={() => openLogSessionSheet()}>
                <Ionicons name="add" size={24} color={themed.icon} />
              </Pressable>
            </>
          }
        />

        <View style={[styles.toggleWrap, themed.toggleWrap]}>
          <Pressable
            style={[styles.togglePill, viewMode === 'calendar' ? styles.togglePillActive : null, viewMode === 'calendar' ? themed.togglePillActive : null]}
            onPress={() => setViewMode('calendar')}>
            <Text style={[styles.toggleText, themed.toggleText, viewMode === 'calendar' ? styles.toggleTextActive : null, viewMode === 'calendar' ? themed.toggleTextActive : null]}>Calendar</Text>
          </Pressable>
          <Pressable
            style={[styles.togglePill, viewMode === 'week' ? styles.togglePillActive : null, viewMode === 'week' ? themed.togglePillActive : null]}
            onPress={() => setViewMode('week')}>
            <Text style={[styles.toggleText, themed.toggleText, viewMode === 'week' ? styles.toggleTextActive : null, viewMode === 'week' ? themed.toggleTextActive : null]}>Week</Text>
          </Pressable>
        </View>

        <View style={[styles.phaseIndicator, { backgroundColor: theme.primary }]}>
          <View style={styles.phaseIndicatorHeader}>
            <View style={styles.phaseIndicatorLeft}>
              <View style={[styles.phaseIndicatorDot, { backgroundColor: theme.accent }]} />
              <Text style={[styles.phaseIndicatorLabel, { color: theme.onPrimary }]} numberOfLines={1}>
                {raceFocus.focusText}
              </Text>
            </View>
            <View style={styles.phaseIndicatorRight}>
              <Text style={[styles.phaseIndicatorWeek, { color: withAlpha(theme.onPrimary, 0.78) }]} numberOfLines={1}>
                {mainGoalRace
                  ? `A race · ${daysUntilIsoDate(mainGoalRace.event_date, todayIso)} days`
                  : primaryRace
                    ? `${racePriorityLabel(primaryRace.priority)} race · ${daysUntilIsoDate(primaryRace.event_date, todayIso)} days`
                    : 'Set races to drive focus'}
              </Text>
            </View>
          </View>
        </View>

        {viewMode === 'calendar' ? (
          <View style={[styles.calendarCard, themed.card]}>
            <View style={styles.monthRow}>
              <Text style={[styles.monthTitle, themed.cardText]}>{monthTitle}</Text>
              <View style={styles.monthControls}>
                <Pressable
                  hitSlop={8}
                  onPress={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                  <Ionicons name="chevron-back" size={18} color={theme.primary} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                  <Ionicons name="chevron-forward" size={18} color={theme.primary} />
                </Pressable>
              </View>
            </View>

            <View style={styles.weekdayRow}>
              {weekdayLabels.map((label, idx) => (
                <Text key={`${label}-${idx}`} style={[styles.weekdayText, themed.subtleText]}>
                  {label}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {calendarDays.map((item) => {
                const dots = showCalendarMarkers && item.isoDate ? sessionDotsByDate[item.isoDate] ?? [] : [];
                const races = showCalendarMarkers && item.isoDate ? racesByDate[item.isoDate] ?? [] : [];
                const hasRace = races.length > 0;
                const raceMarker = hasRace ? raceMarkerForPriority(races[0]?.priority) : undefined;
                const isSelected = item.isoDate === selectedDate;
                const isToday = item.isoDate === todayIso;

                return (
                  <Pressable
                    key={item.key}
                    style={[
                      styles.dayCell,
                      themed.calendarCell,
                      !item.isoDate ? styles.emptyCell : null,
                      isSelected ? styles.dayCellSelected : isToday ? styles.dayCellTodayRing : null,
                      isSelected ? themed.calendarSelected : isToday ? themed.calendarTodayRing : null,
                      hasRace && !isSelected && !isToday ? styles.dayCellRace : null,
                      hasRace && !isSelected && !isToday ? themed.calendarRaceBorder : null,
                    ]}
                    disabled={!item.isoDate}
                    onPress={() => {
                      if (!item.isoDate) return;
                      const now = Date.now();
                      setSelectedDate(item.isoDate);
                      if (lastCalendarTapRef.current.iso === item.isoDate && now - lastCalendarTapRef.current.time < 300) {
                        openLogSessionSheet(item.isoDate);
                        lastCalendarTapRef.current = { iso: null, time: 0 };
                      } else {
                        lastCalendarTapRef.current = { iso: item.isoDate, time: now };
                      }
                    }}>
                    <Text
                      style={[
                        styles.dayText,
                        themed.dayTextBase,
                        isSelected ? styles.dayTextSelected : null,
                        isSelected ? themed.dayTextSelected : null,
                        !item.isoDate ? styles.dayTextEmpty : null,
                      ]}>
                      {item.dayNumber ?? ''}
                    </Text>
                    {item.isoDate ? <SessionMarkerRow dots={dots} raceMarker={raceMarker} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.dayDotCompleted, themed.markerCompleted]} />
                <Text style={[styles.legendText, themed.subtleText]}>Completed</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dayDotPlanned, themed.markerPlanned]} />
                <Text style={[styles.legendText, themed.subtleText]}>Planned</Text>
              </View>
              <View style={styles.legendItem}>
                <Ionicons name="flag" size={11} color="#C97E2F" />
                <Text style={[styles.legendText, themed.subtleText]}>A race</Text>
              </View>
              <View style={styles.legendItem}>
                <Ionicons name="flag" size={11} color="#B0B7C3" />
                <Text style={[styles.legendText, themed.subtleText]}>B race</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.racePriorityDot, { backgroundColor: '#B16C3D' }]} />
                <Text style={[styles.legendText, themed.subtleText]}>C race</Text>
              </View>
            </View>

          </View>
        ) : (
          <View style={[styles.weekCard, themed.card]}>
            <WeekSummaryCard
              swimCount={weekSummary.swimCount}
              bikeCount={weekSummary.bikeCount}
              runCount={weekSummary.runCount}
              restCount={weekSummary.restCount}
              totalTimeLabel={weekSummary.totalTimeLabel}
            />
            <View style={styles.weekHeaderRow}>
              <Text style={[styles.weekHeading, themed.cardText]}>Upcoming</Text>
              <View style={styles.weekNavControls}>
                <Pressable hitSlop={10} onPress={goPrevWeek} style={[styles.weekNavBtn, themed.weekNavBtn]}>
                  <Ionicons name="chevron-back" size={14} color={theme.primary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose week"
                  hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                  onPress={openWeekPicker}
                  style={({ pressed }) => [styles.weekNavLabelButton, pressed && styles.weekNavLabelButtonPressed]}>
                  <Text selectable={false} style={[styles.weekNavLabel, themed.subtleText]}>
                    {weekRangeLabel}
                  </Text>
                </Pressable>
                <Pressable hitSlop={10} onPress={goNextWeek} style={[styles.weekNavBtn, themed.weekNavBtn]}>
                  <Ionicons name="chevron-forward" size={14} color={theme.primary} />
                </Pressable>
              </View>
            </View>
            {rescheduleNotice ? <Text style={[styles.weekNotice, themed.weekNotice]}>{rescheduleNotice}</Text> : null}
            {weekError || weekQueryError ? (
              <Text style={styles.errorHint}>
                Couldn&apos;t sync week sessions: {weekError ?? weekQueryError?.message}
              </Text>
            ) : null}

            {(weekLoading
              ? weekDates.map((dayIso) => (
                  <View key={`week-skeleton-${dayIso}`} style={styles.weekDaySection}>
                    <SkeletonBlock style={styles.weekDayLabelSkeleton} />
                    <View style={styles.weekSessionCardOuter}>
                      <View style={styles.weekSessionPressable}>
                        <SkeletonBlock style={styles.weekSessionSkeletonIcon} />
                        <View style={styles.weekSessionSkeletonCopy}>
                          <SkeletonBlock style={styles.weekSessionSkeletonTitle} />
                          <SkeletonBlock style={styles.weekSessionSkeletonMeta} />
                        </View>
                      </View>
                    </View>
                  </View>
                ))
              : weekDates.map((dayIso) => {
              const daySessions = weekSessionsByDate[dayIso] ?? [];
              const hasSessions = daySessions.length > 0;
              const dayRaces = !raceGoalsLoading ? racesByDate[dayIso] ?? [] : [];
              const hasRaces = dayRaces.length > 0;
              const hasDayContent = hasSessions || hasRaces;
              return (
                <View
                  key={dayIso}
                  ref={(node) => {
                    dayBucketRefs.current[dayIso] = node;
                  }}
                  onLayout={collectBucketLayouts}
                  style={[
                    styles.weekDaySection,
                    hasDayContent ? styles.weekDaySectionWithSessions : styles.weekDaySectionRest,
                    hasSessions && isDragging ? styles.weekDaySectionDragging : null,
                    hasSessions && isDragging ? themed.draggingBorder : null,
                  ]}>
                  <Text style={[styles.weekDayLabel, themed.cardText]}>{formatWeekHeader(dayIso)}</Text>
                  {hasRaces ? (
                    <View style={styles.weekRaceList}>
                      {dayRaces.map((event) => (
                        <Pressable
                          key={event.id}
                          style={[styles.weekRaceCardOuter, themed.card]}
                          onPress={() => router.push('/goal-races')}>
                          <View style={styles.weekRaceCardPressable}>
                            <View style={styles.weekRaceIconWrap}>
                              <Ionicons
                                name={event.priority === 'c' ? 'ellipse' : 'flag'}
                                size={16}
                                color={event.priority === 'a' ? '#C97E2F' : event.priority === 'b' ? '#B0B7C3' : '#B16C3D'}
                              />
                            </View>
                            <View style={styles.weekRaceCopy}>
                              <Text style={[styles.weekRaceTitle, themed.cardText]} numberOfLines={2}>
                                {event.name}
                              </Text>
                              <Text style={[styles.weekRaceMeta, themed.subtleText]} numberOfLines={1}>
                                {`${racePriorityLabel(event.priority)} race · ${daysUntilIsoDate(event.date, todayIso)} days`}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={withAlpha(theme.primary, 0.35)} />
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {hasSessions ? (
                    daySessions.map((session) => (
                      <WeekSessionCard
                        key={session.id}
                        session={session}
                        onPress={(sessionId) => router.push(`/SessionDetail?sessionId=${sessionId}`)}
                        onLongPress={(sessionId) => openImportSheet({ mode: 'manual', sessionId })}
                        onRemovePress={promptRemoveSession}
                        onDrop={handleSessionDrop}
                        onDragStateChange={(dragging) => {
                          setIsDragging(dragging);
                          if (dragging) {
                            collectBucketLayouts();
                          }
                        }}
                      />
                    ))
                  ) : !hasRaces ? (
                    <View style={styles.weekRestDayWrap}>
                      <Text style={[styles.weekRestDayText, themed.subtleText]}>No session planned</Text>
                    </View>
                  ) : null}
                </View>
              );
            }))}
          </View>
        )}

            {viewMode === 'calendar' ? (
          <View style={[styles.dayPlanCard, themed.card]}>
            <Text style={[styles.dayPlanHeading, themed.cardText]}>{selectedDateLabel}</Text>
            {!hasScheduledSession && selectedDateRaces.length === 0 ? (
              <Text style={[styles.sessionTitle, themed.cardText]}>No training session planned</Text>
            ) : null}
            {!hasScheduledSession && selectedDateRaces.length > 0 ? (
              <Text style={[styles.sessionTitle, themed.subtleText]}>No training session planned</Text>
            ) : null}

            {selectedDateSessions.length > 0 ? (
              <View style={styles.selectedSessionsList}>
                {selectedDateSessions.map((session) => {
                  const completed = (session.completionStatus ?? session.status) === 'completed';
                  return (
                    <View
                      key={session.id}
                      style={[
                        styles.selectedSessionItem,
                        themed.selectedSessionItem,
                        completed ? { borderColor: withAlpha(theme.accent, 0.55) } : null,
                      ]}>
                      <Pressable
                        style={styles.selectedSessionPressable}
                        onPress={() => router.push(`/SessionDetail?sessionId=${session.id}`)}
                        onLongPress={() => openImportSheet({ mode: 'manual', sessionId: session.id })}>
                        {completed ? (
                          <View style={styles.weekSessionCheckCol}>
                            <View style={[styles.weekSessionCheckBubble, { backgroundColor: theme.accent }]}>
                              <Ionicons name="checkmark" size={14} color={theme.surface} />
                            </View>
                          </View>
                        ) : null}
                        <View style={[styles.weekSessionIconWrap, { backgroundColor: theme.primary }]}>
                          {getSportIcon(session.sport, 16, theme.surface)}
                        </View>
                        <View style={styles.selectedSessionCopy}>
                          <Text style={[styles.selectedSessionTitle, themed.cardText]}>{session.title}</Text>
                          <Text style={[styles.selectedSessionMeta, themed.subtleText]} numberOfLines={1}>
                            {session.duration_mins ?? '-'} min
                            {session.distance ? ` · ${session.distance}${session.distance_unit ?? ''}` : ''}
                            {completed ? (
                              <>
                                {' · '}
                                <Text style={{ color: theme.accent }}>Completed</Text>
                              </>
                            ) : null}
                          </Text>
                        </View>
                      </Pressable>
                      <View style={styles.weekSessionTrailing}>
                        <SessionRemoveIconButton
                          iconColor={withAlpha(theme.primary, 0.45)}
                          onPress={() => promptRemoveSession(session)}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Session details"
                          hitSlop={10}
                          style={styles.weekSessionChevronHit}
                          onPress={() => router.push(`/SessionDetail?sessionId=${session.id}`)}>
                          <Ionicons name="chevron-forward" size={16} color={withAlpha(theme.primary, 0.2)} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {selectedDateRaces.length > 0
              ? selectedDateRaces.map((event) => (
                  <View key={event.id} style={[styles.raceBadge, themed.raceBadge, hasScheduledSession ? styles.raceBadgeAfterSessions : null]}>
                    <View style={styles.raceBadgeHeader}>
                      <Ionicons
                        name={event.priority === 'c' ? 'ellipse' : 'flag'}
                        size={13}
                        color={event.priority === 'a' ? '#C97E2F' : event.priority === 'b' ? '#B0B7C3' : '#B16C3D'}
                      />
                      <Text style={[styles.raceBadgeTitle, themed.raceBadgeText]}>{`${racePriorityLabel(event.priority)} race`}</Text>
                    </View>
                    <Text style={[styles.raceName, themed.raceBadgeText]}>{event.name}</Text>
                    <Text style={[styles.raceMeta, themed.raceMeta]}>
                      {(event.raceType ?? 'event').replace(/-/g, ' ')}
                      {` · ${daysUntilIsoDate(event.date, todayIso)} days`}
                      {event.distance ? ` · ${event.distance}` : ''}
                      {event.notes ? ` · ${event.notes}` : ''}
                    </Text>
                    <View style={styles.racePriorityRow}>
                      {(['a', 'b', 'c'] as const).map((p) => {
                        const selected = event.priority === p;
                        return (
                          <Pressable
                            key={`${event.id}-${p}`}
                            style={[styles.racePriorityChip, selected ? styles.racePriorityChipSelected : null]}
                            onPress={() => void updateRacePriority(event.id, p)}>
                            <Text style={[styles.racePriorityChipText, selected ? styles.racePriorityChipTextSelected : null]}>
                              {racePriorityLabel(p)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))
              : null}

            {monthLoading || raceLoading || raceGoalsLoading ? (
              <Text style={[styles.loadingHint, themed.subtleText]}>Loading calendar data...</Text>
            ) : null}
          </View>
        ) : null}

      </ScrollView>
      <LogSessionSheet
        visible={logSheetOpen}
        onClose={() => setLogSheetOpen(false)}
        initialDate={logSheetInitialDate}
        onLogged={handleLoggedSession}
      />
      <FlexWeekSheet
        visible={isFlexWeekOpen}
        athleteId={athlete?.id}
        weekStartDate={weekDates[0]}
        onClose={() => setIsFlexWeekOpen(false)}
        onManualModeRequested={() => setViewMode('week')}
      />
      <ImportPlanSheet
        visible={importSheetOpen}
        athleteId={athlete?.id}
        editingSessionId={editingSessionId}
        initialDate={importSheetInitialDate ?? selectedDate}
        initialMode={editingSessionId ? 'manual' : 'template'}
        onImported={handleImportComplete}
        onClose={() => {
          setImportSheetOpen(false);
          setEditingSessionId(null);
          setImportSheetInitialDate(undefined);
        }}
      />
      <Modal transparent visible={weekPickerOpen} animationType="fade" onRequestClose={closeWeekPicker}>
        <Pressable style={[styles.weekPickerBackdrop, themed.weekPickerBackdrop]} onPress={closeWeekPicker} />
        <View style={[styles.weekPickerSheet, themed.weekPickerSheet, { paddingBottom: 18 + insets.bottom }]}>
          <Pressable style={styles.weekPickerCloseButton} onPress={closeWeekPicker} hitSlop={8}>
            <Ionicons name="close" size={16} color={theme.primary} />
          </Pressable>
          <Text style={[styles.weekPickerTitle, themed.cardText]}>Choose a week</Text>
          <View style={styles.weekPickerCalendarWrap}>
            <DateTimePicker
              {...datePickerMondayWeekProps()}
              value={weekPickerDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
              themeVariant={weekPickerThemeVariant}
              accentColor={theme.primary}
              textColor={theme.text}
              onChange={(_event, selected) => {
                if (!selected) {
                  if (Platform.OS !== 'ios') closeWeekPicker();
                  return;
                }
                setWeekPickerDate(selected);
                if (Platform.OS !== 'ios') {
                  applyWeekPickerDate(selected);
                  closeWeekPicker();
                }
              }}
            />
          </View>
          {Platform.OS === 'ios' ? (
            <Pressable
              style={styles.weekPickerApply}
              onPress={() => {
                applyWeekPickerDate(weekPickerDate);
                closeWeekPicker();
              }}>
              <Text style={styles.weekPickerApplyText}>Go to week</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
      <FloatingPillNav active="plan" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F3EE',
  },
  content: {
    paddingHorizontal: TAB_SCREEN_PADDING_HORIZONTAL,
    paddingTop: TAB_SCREEN_CONTENT_PADDING_TOP,
    paddingBottom: 130,
    gap: 16,
  },
  compactHeaderText: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 22,
    color: '#0F2840',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButton: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  importButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#0F2840',
  },
  flexButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: '#F6F3EE',
    borderRadius: 14,
    padding: 4,
    marginTop: -6,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
  },
  togglePill: {
    flex: 1,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  togglePillActive: {
    backgroundColor: '#FFFFFF',
  },
  toggleText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: 'rgba(15,40,64,0.6)',
  },
  toggleTextActive: {
    color: '#0F2840',
  },
  phaseIndicator: {
    gap: 10,
    backgroundColor: '#0F2840',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  phaseIndicatorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  phaseIndicatorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  phaseIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C97E2F',
  },
  phaseIndicatorLabel: {
    flexShrink: 1,
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#F6F3EE',
  },
  phaseIndicatorRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phaseIndicatorWeek: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(246,243,238,0.78)',
  },
  phaseProgressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(246,243,238,0.22)',
    overflow: 'hidden',
  },
  phaseProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#C97E2F',
  },
  phaseAccordion: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(246,243,238,0.22)',
    paddingTop: 8,
    gap: 6,
  },
  phaseAccordionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phaseAccordionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(246,243,238,0.4)',
  },
  phaseAccordionDotActive: {
    backgroundColor: '#C97E2F',
  },
  phaseAccordionLabel: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(246,243,238,0.74)',
  },
  phaseAccordionLabelActive: {
    fontFamily: 'DMSans_500Medium',
    color: '#F6F3EE',
  },
  phaseAccordionRange: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    color: 'rgba(246,243,238,0.64)',
  },
  calendarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  monthTitle: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 15,
    color: '#0F2840',
  },
  monthControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayText: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: 'rgba(15,40,64,0.45)',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 4,
    paddingHorizontal: 2,
    paddingVertical: 0,
  },
  emptyCell: {
    width: '13.5%',
    height: 56,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  dayCell: {
    width: '13.5%',
    height: 54,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  dayCellTodayRing: {
    borderColor: '#0F2840',
    backgroundColor: '#FFFFFF',
  },
  dayCellSelected: {
    backgroundColor: '#0F2840',
    borderColor: '#0F2840',
  },
  dayCellRace: {
    borderStyle: 'dashed',
    borderColor: '#0F2840',
  },
  dayText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#0F2840',
    marginBottom: 1,
  },
  dayTextEmpty: {
    color: 'transparent',
  },
  dayTextSelected: {
    color: '#FFFFFF',
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
    gap: 2,
    minHeight: 12,
    maxWidth: '100%',
  },
  racePriorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dayDotPlanned: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#0F2840',
  },
  dayDotCompleted: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C97E2F',
  },
  dotOverflowText: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 8,
    lineHeight: 10,
    color: '#0F2840',
    marginLeft: 1,
  },
  legendRow: {
    marginTop: 4,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    columnGap: 8,
    rowGap: 0,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    color: 'rgba(15,40,64,0.65)',
  },
  dayPlanCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  dayPlanHeading: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 26,
    color: '#0F2840',
    marginBottom: 10,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sessionIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#0F2840',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionCopy: {
    flex: 1,
    gap: 2,
  },
  sessionTitle: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
    color: '#0F2840',
  },
  sessionMeta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(15,40,64,0.55)',
  },
  selectedSessionsList: {
    marginTop: 10,
    gap: 8,
  },
  selectedSessionItem: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    backgroundColor: '#F6F3EE',
    paddingVertical: 0,
    paddingLeft: 10,
    paddingRight: 4,
    gap: 0,
    overflow: 'hidden',
  },
  selectedSessionPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    minWidth: 0,
  },
  selectedSessionCopy: {
    flex: 1,
    minWidth: 0,
  },
  selectedSessionTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#0F2840',
  },
  selectedSessionMeta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(15,40,64,0.55)',
    marginTop: 2,
  },
  weekCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  weekHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  weekHeading: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 16,
    color: '#0F2840',
  },
  weekNavControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weekNavBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.12)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNavLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(15,40,64,0.55)',
  },
  weekNavLabelButton: {
    minHeight: 32,
    minWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    ...Platform.select({
      web: {
        cursor: 'pointer' as const,
        userSelect: 'none' as const,
      },
      default: {},
    }),
  },
  weekNavLabelButtonPressed: {
    opacity: 0.75,
  },
  weekPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,40,64,0.35)',
  },
  weekPickerSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.12)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  weekPickerCloseButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  weekPickerTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 22,
    color: '#0F2840',
  },
  weekPickerCalendarWrap: {
    marginTop: 6,
  },
  weekPickerApply: {
    marginTop: 10,
    borderRadius: 999,
    backgroundColor: '#0F2840',
    paddingVertical: 12,
    alignItems: 'center',
  },
  weekPickerApplyText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#FFFFFF',
  },
  weekNotice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#C97E2F',
  },
  weekSummaryCard: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  weekSummaryMetricsRow: {
    flexDirection: 'row',
    gap: 2,
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  weekSummaryMetricCard: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 2,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekSummaryMetricValue: {
    fontFamily: 'DMSans_800ExtraBold',
    fontSize: 14,
    lineHeight: 16,
    color: '#0F2840',
  },
  weekSummaryMetricLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 8,
    color: 'rgba(15,40,64,0.55)',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weekDaySection: {
    gap: 8,
    paddingVertical: 4,
  },
  weekDaySectionWithSessions: {
    paddingHorizontal: 0,
  },
  weekDaySectionRest: {
    paddingBottom: 4,
  },
  weekDaySectionDragging: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(201,126,47,0.35)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  weekDayLabel: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 13,
    color: '#0F2840',
  },
  weekRestDayWrap: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRestDayText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    fontStyle: 'italic',
    color: 'rgba(15,40,64,0.3)',
    textAlign: 'center',
  },
  weekSessionCardOuter: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    backgroundColor: '#FFFFFF',
    overflow: 'visible',
  },
  weekSessionCardDragging: {
    zIndex: 20,
    elevation: 8,
  },
  weekSessionCheckCol: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  weekSessionCheckBubble: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#C97E2F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekSessionCardInner: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  weekSessionPressableMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    minWidth: 0,
  },
  weekSessionTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 6,
    gap: 0,
  },
  weekSessionChevronHit: {
    justifyContent: 'center',
    paddingVertical: 8,
    paddingLeft: 2,
  },
  weekSessionPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  weekSessionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0F2840',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    position: 'relative',
  },
  weekSessionIconAccentDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#C97E2F',
    position: 'absolute',
    right: 6,
    top: 6,
  },
  weekSessionCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  weekSessionTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#0F2840',
  },
  weekSessionMeta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: 'rgba(15,40,64,0.4)',
  },
  weekDayLabelSkeleton: {
    width: 110,
    height: 13,
    borderRadius: 8,
  },
  weekSessionSkeletonIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    marginRight: 10,
  },
  weekSessionSkeletonCopy: {
    flex: 1,
    gap: 8,
  },
  weekSessionSkeletonTitle: {
    width: '56%',
    height: 14,
    borderRadius: 8,
  },
  weekSessionSkeletonMeta: {
    width: '72%',
    height: 11,
    borderRadius: 8,
  },
  weekSessionDragHandle: {
    justifyContent: 'center',
    gap: 3,
    marginLeft: 6,
    paddingVertical: 4,
    paddingLeft: 6,
  },
  weekSessionDragHandleLine: {
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  raceBadge: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.2)',
    backgroundColor: 'rgba(15,40,64,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  raceBadgeAfterSessions: {
    marginTop: 18,
  },
  weekRaceList: {
    gap: 8,
    marginBottom: 4,
  },
  weekRaceCardOuter: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'visible',
  },
  weekRaceCardPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  weekRaceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(15,40,64,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  weekRaceCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  weekRaceTitle: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 15,
  },
  weekRaceMeta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
  },
  raceBadgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  raceBadgeTitle: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 10,
    color: '#0F2840',
  },
  raceName: {
    marginTop: 4,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 13,
    color: '#0F2840',
  },
  raceMeta: {
    marginTop: 2,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(15,40,64,0.65)',
  },
  racePriorityRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 6,
  },
  racePriorityChip: {
    minHeight: 24,
    minWidth: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  racePriorityChipSelected: {
    backgroundColor: '#0F2840',
    borderColor: '#0F2840',
  },
  racePriorityChipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#0F2840',
  },
  racePriorityChipTextSelected: {
    color: '#FFFFFF',
  },
  noRaceText: {
    marginTop: 10,
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(15,40,64,0.55)',
  },
  loadingHint: {
    marginTop: 6,
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    color: 'rgba(15,40,64,0.5)',
  },
  errorHint: {
    marginTop: 4,
    fontFamily: 'DMSans_400Regular',
    fontSize: 10,
    color: '#C97E2F',
  },
});

