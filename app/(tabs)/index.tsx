import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlexWeekSheet } from '@/components/FlexWeekSheet';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import { DailyReflectionSheet } from '@/components/DailyReflectionSheet';
import { SkeletonBlock } from '@/components/loading-ui';
import { getSportIcon } from '@/components/sport-icon';
import { TabHeader } from '@/components/tab-header';
import { useTheme } from '@/contexts/ThemeContext';
import { journalQueryKeys } from '@/hooks/useJournalAndHabits';
import { useScrollToTopTabRef } from '@/hooks/useScrollToTopTabRef';
import { useActiveAthlete, useLevelProgress, useRaceGoals, useUpcomingSessions, useTodaysSessions, useWeekSessions } from '@/hooks/useSessionData';
import { useWeeklyChallenges } from '@/hooks/useWeeklyChallenges';
import { isAnthropicEnabled } from '@/lib/anthropic';
import { toLocalIsoDate } from '@/lib/dates';
import { withAlpha } from '@/lib/theme-utils';
import { supabase } from '@/lib/supabase';
import { fetchTodayCoachDirective } from '@/services/rovaIntelligence';
import {
  daysUntilIsoDate,
  getMainGoalRaceForPlanning,
  getPrimaryRaceForPlanning,
  toIsoDateLocal,
} from '@/services/racePriority';

function getWeekStartMonday(anchor: Date) {
  const day = anchor.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

const WEEKLY_INTENTION_EXAMPLES = [
  'Protect sleep this week and keep easy days truly easy.',
  'Nail consistency: complete planned sessions before adding extras.',
  'Travel week: prioritize short quality sessions and mobility.',
];

/** When Rova API is unavailable, keep the card conversational from local cues. */
function buildCoachDirectiveFallback(
  sessions: { sport: string; title: string; completionStatus: string }[],
  weekDone: number,
  weekTotal: number
): string {
  const actionable = sessions.filter((s) => s.sport !== 'rest');
  const planned = actionable.filter((s) => s.completionStatus === 'planned');
  const done = actionable.filter((s) => s.completionStatus === 'completed');

  if (planned.length > 0) {
    const first = planned[0];
    const weekBit =
      weekTotal > 0
        ? ` This week you've banked ${weekDone}/${weekTotal} sessions — protect energy on the extras.`
        : '';
    return `Your headline today is "${first.title}" — keep effort honest to the prescribed intent.${weekBit}`;
  }

  if (actionable.length > 0 && done.length === actionable.length) {
    return `Everything slated for today is logged — hydrate, mobilise lightly, and let adaptation happen. Week tally: ${weekDone}/${weekTotal} sessions wrapped.`;
  }

  if (actionable.length === 0) {
    return weekTotal > 0
      ? `Open day on paper — bias recovery, errands-easy movement, or a gentle aerobic flush if sleep is solid. You've ticked ${weekDone}/${weekTotal} sessions across the rolling week so far.`
      : `Quiet diary today — savour the recharge or add optional easy aerobic work without chasing numbers.`;
  }

  return 'Tap through to chat with Rova when you want a sharper read on workload and timing.';
}

export default function HomeScreen() {
  const router = useRouter();
  const tabScrollRef = useScrollToTopTabRef();
  const { theme } = useTheme();
  const {
    data: todaySessions = [],
    isLoading: sessionsLoading,
    isFetching: sessionsFetching,
    error: sessionsError,
    refetch: refetchToday,
  } = useTodaysSessions();
  const { data: upcomingSessions = [], isLoading: upcomingSessionsLoading, refetch: refetchUpcoming } = useUpcomingSessions(120);
  const { data: athlete } = useActiveAthlete();
  const { data: raceGoals = [] } = useRaceGoals(athlete?.id);
  const levelProgress = useLevelProgress(athlete?.id, athlete?.level);
  const queryClient = useQueryClient();
  const athleteLevel = levelProgress.currentLevel;
  const nextLevel = levelProgress.nextLevel;
  const atPeakTier = levelProgress.atPeakTier;
  const weekStart = useMemo(() => getWeekStartMonday(new Date()), []);
  const weekStartIso = useMemo(() => toLocalIsoDate(weekStart), [weekStart]);
  const intentionStorageKey = useMemo(() => `weekly_intention:${weekStartIso}`, [weekStartIso]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toLocalIsoDate(addDays(weekStart, i))), [weekStart]);
  const { data: weekSessionsByDate = {}, isLoading: weekLoading } = useWeekSessions(weekStart);
  const [isIntentionsOpen, setIsIntentionsOpen] = useState(false);
  const [weeklyIntention, setWeeklyIntention] = useState('');
  const [intentionDraft, setIntentionDraft] = useState('');
  const [isFlexWeekOpen, setIsFlexWeekOpen] = useState(false);
  const [flexInitialReason, setFlexInitialReason] = useState<'Catch up' | undefined>(undefined);
  const [showCatchupNudge, setShowCatchupNudge] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reflectTodayOpen, setReflectTodayOpen] = useState(false);
  const intentionSheetY = useRef(new Animated.Value(420)).current;
  const { todaysChallenge, maybeGenerateForWeek } = useWeeklyChallenges(athlete?.id);

  const todayDate = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }, []);
  const headerGreeting = useMemo(() => {
    const rawName = (athlete?.name ?? '').trim();
    if (!rawName) return 'Welcome';
    const firstName = rawName.split(/\s+/)[0];
    return `Hi ${firstName}`;
  }, [athlete?.name]);
  const headerSubtitle = useMemo(() => {
    const todayLocalIso = toIsoDateLocal(new Date());
    const mainGoal = getMainGoalRaceForPlanning(raceGoals, todayLocalIso);
    const anchor = mainGoal ?? getPrimaryRaceForPlanning(raceGoals, todayLocalIso);
    if (!anchor) return todayDate;
    const daysOut = daysUntilIsoDate(anchor.event_date, todayLocalIso);
    if (daysOut > 0) return `${todayDate} · D-${daysOut}`;
    if (daysOut === 0) return `${todayDate} · Race day`;
    return todayDate;
  }, [raceGoals, todayDate]);
  const todayIso = useMemo(() => toLocalIsoDate(new Date()), []);
  const weekStats = useMemo(() => {
    const sessionsAll = weekDates.flatMap((date) => weekSessionsByDate[date] ?? []);
    const nonRest = sessionsAll.filter((s) => s.sport !== 'rest');
    const done = nonRest.filter((s) => s.completionStatus === 'completed');
    const totalDurationMins = nonRest.reduce((sum, s) => sum + (s.duration_mins ?? 0), 0);
    const hours = Math.floor(totalDurationMins / 60);
    const mins = totalDurationMins % 60;
    const totalTimeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    let longestStreak = 0;
    let current = 0;
    for (const date of weekDates) {
      const daySessions = (weekSessionsByDate[date] ?? []).filter((s) => s.sport !== 'rest');
      const dayCompleted = daySessions.length > 0 && daySessions.every((s) => s.completionStatus === 'completed');
      if (dayCompleted) {
        current += 1;
        longestStreak = Math.max(longestStreak, current);
      } else {
        current = 0;
      }
    }

    return {
      doneCount: done.length,
      totalCount: nonRest.length,
      totalTimeLabel,
      longestStreakLabel: `${longestStreak} day${longestStreak === 1 ? '' : 's'}`,
    };
  }, [weekDates, weekSessionsByDate]);

  const anthropicConfigured =
    isAnthropicEnabled() &&
    typeof process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY === 'string' &&
    process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY.length > 0;

  const todayScheduleSummary = useMemo(() => {
    const nonRest = todaySessions.filter((s) => s.sport !== 'rest');
    if (nonRest.length === 0) {
      const hasRest = todaySessions.some((s) => s.sport === 'rest');
      return hasRest
        ? 'Rest / recovery day scheduled — no swim, bike, or run sessions listed.'
        : 'No swim, bike, or run sessions on the calendar for today.';
    }
    return nonRest
      .map((s) => {
        return `- ${s.sport}: "${s.title}" · ${s.duration_mins ?? '?'} min planned · status: ${s.completionStatus}`;
      })
      .join('\n');
  }, [todaySessions]);

  const coachDirectiveKey = useMemo(
    () =>
      `${todayIso}|${todaySessions.map((s) => `${s.id}:${s.completionStatus}`).join('|')}|${weekStats.doneCount}/${weekStats.totalCount}`,
    [todayIso, todaySessions, weekStats.doneCount, weekStats.totalCount]
  );

  const coachDirectiveQuery = useQuery({
    queryKey: ['rova_coach_directive', athlete?.id ?? '', coachDirectiveKey] as const,
    enabled: Boolean(athlete?.id && anthropicConfigured),
    staleTime: 20 * 60 * 1000,
    retry: 1,
    queryFn: () =>
      fetchTodayCoachDirective({
        athleteId: athlete!.id,
        todayScheduleSummary,
      }),
  });

  const coachBodyText = useMemo(() => {
    const fallback = buildCoachDirectiveFallback(todaySessions, weekStats.doneCount, weekStats.totalCount);
    if (!anthropicConfigured || coachDirectiveQuery.isError) return fallback;
    if (coachDirectiveQuery.isLoading && !coachDirectiveQuery.data) {
      return 'Rova is reading your week…';
    }
    const t = coachDirectiveQuery.data?.trim();
    return t && t.length > 0 ? t : fallback;
  }, [
    anthropicConfigured,
    coachDirectiveQuery.data,
    coachDirectiveQuery.isError,
    coachDirectiveQuery.isLoading,
    todaySessions,
    weekStats.doneCount,
    weekStats.totalCount,
  ]);

  const openIntentionsSheet = () => {
    setIsIntentionsOpen(true);
    Animated.spring(intentionSheetY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 180,
      mass: 0.9,
    }).start();
  };

  const closeIntentionsSheet = () => {
    Animated.timing(intentionSheetY, {
      toValue: 420,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsIntentionsOpen(false);
      }
    });
  };

  const openIntentionsEditor = () => {
    setIntentionDraft(weeklyIntention);
    openIntentionsSheet();
  };

  const saveWeeklyIntention = async () => {
    const trimmed = intentionDraft.trim();
    try {
      await AsyncStorage.setItem(intentionStorageKey, trimmed);
      setWeeklyIntention(trimmed);
      if (Platform.OS === 'android') {
        ToastAndroid.show('Weekly intention saved', ToastAndroid.SHORT);
      } else {
        Alert.alert('Saved', 'Weekly intention updated.');
      }
      closeIntentionsSheet();
    } catch {
      Alert.alert('Could not save', 'Please try again.');
    }
  };

  const openFlexWeekSheet = (presetReason?: 'Catch up') => {
    setFlexInitialReason(presetReason);
    setIsFlexWeekOpen(true);
  };

  const closeFlexWeekSheet = () => {
    setIsFlexWeekOpen(false);
  };

  const todaySessionCards = todaySessions.map((session) => ({
    id: session.id,
    sport: session.sport,
    title: session.title,
    coachNote: session.coach_note,
    meta: `${session.sport.toUpperCase()} · ${session.duration_mins ?? '-'} min · ${
      session.distance ?? '-'
    }${session.distance_unit ?? ''} · ${session.intensity ?? 'Steady'}`,
    status: session.completionStatus,
    completedAt: session.completed_at,
  }));

  type UpcomingCard = Pick<
    (typeof todaySessionCards)[number],
    'id' | 'sport' | 'title' | 'meta' | 'status' | 'completedAt'
  >;

  const nextUpcomingSessions = useMemo(
    () =>
      upcomingSessions
        .filter((session) => {
          if (session.completionStatus !== 'planned') return false;
          const rawStatus = typeof session.status === 'string' ? session.status.toLowerCase() : '';
          return rawStatus !== 'cancelled';
        })
        .slice(0, 3),
    [upcomingSessions]
  );

  const upcomingSessionGroups = useMemo(() => {
    const groups = new Map<string, { label: string; sessions: UpcomingCard[] }>();

    for (const session of nextUpcomingSessions) {
      const key = session.scheduled_date;
      if (!groups.has(key)) {
        const date = new Date(`${key}T00:00:00`);
        groups.set(key, {
          label: date.toLocaleDateString('en-AU', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
          sessions: [],
        });
      }

      groups.get(key)?.sessions.push({
        id: session.id,
        sport: session.sport,
        title: session.title,
        meta: `${session.sport.toUpperCase()} · ${session.duration_mins ?? '-'} min · ${
          session.distance ?? '-'
        }${session.distance_unit ?? ''} · ${session.intensity ?? 'Steady'}`,
        status: session.completionStatus,
        completedAt: session.completed_at,
      });
    }

    return Array.from(groups.entries())
      .filter(([, value]) => value.sessions.length > 0)
      .map(([date, value]) => ({
        date,
        ...value,
      }));
  }, [nextUpcomingSessions]);


  useEffect(() => {
    if (__DEV__) {
      console.log(`[${new Date().toISOString()}] [Today] useTodaysSessions localCalendar=${todayIso}`);
    }
  }, [todayIso]);

  useEffect(() => {
    if (sessionsLoading) return;
    if (__DEV__) {
      console.log(
        `[${new Date().toISOString()}] [Today] useTodaysSessions returned ${todaySessionCards.length} sessions`
      );
      console.log(
        `[${new Date().toISOString()}] [Today] sessions`,
        todaySessionCards.map((s) => ({ title: s.title, sport: s.sport }))
      );
    }
  }, [todaySessionCards, sessionsLoading]);

  useEffect(() => {
    void maybeGenerateForWeek();
  }, [maybeGenerateForWeek]);

  useEffect(() => {
    if (!athlete?.id) return;
    const checkMissedStreak = async () => {
      const fromIso = toLocalIsoDate(addDays(new Date(), -14));
      const toIso = toLocalIsoDate(new Date());
      const { data, error } = await supabase
        .from('sessions')
        .select('scheduled_date,status')
        .eq('athlete_id', athlete.id)
        .gte('scheduled_date', fromIso)
        .lte('scheduled_date', toIso)
        .neq('sport', 'rest')
        .order('scheduled_date', { ascending: false });
      if (error) return;
      let missedStreak = 0;
      for (const session of data ?? []) {
        if (session.status === 'planned' || session.status === 'skipped') {
          missedStreak += 1;
        } else if (session.status === 'completed') {
          break;
        }
      }
      setShowCatchupNudge(missedStreak >= 2);
    };
    void checkMissedStreak();
  }, [athlete?.id, todayIso]);

  useEffect(() => {
    let active = true;
    const loadWeeklyIntention = async () => {
      try {
        const stored = await AsyncStorage.getItem(intentionStorageKey);
        if (!active) return;
        const value = stored?.trim() ?? '';
        setWeeklyIntention(value);
        setIntentionDraft(value);
      } catch {
        if (!active) return;
        setWeeklyIntention('');
        setIntentionDraft('');
      }
    };
    void loadWeeklyIntention();
    return () => {
      active = false;
    };
  }, [intentionStorageKey]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      refetchToday(),
      refetchUpcoming(),
      todaysChallenge.refetch(),
      queryClient.invalidateQueries({ queryKey: ['rova_coach_directive'] }),
      queryClient.invalidateQueries({ queryKey: ['sessions'] }),
      queryClient.invalidateQueries({ queryKey: journalQueryKeys.all }),
    ]);
    setIsRefreshing(false);
  };

  const themeStyles = useMemo(
    () => ({
      screen: { backgroundColor: theme.base },
      refresh: { tintColor: theme.primary, colors: [theme.primary] as string[] },
      headerTitle: { color: theme.primary },
      headerDate: { color: theme.accent },
      headerActionButton: { backgroundColor: theme.surface, borderColor: withAlpha(theme.primary, 0.12) },
      coachCard: { backgroundColor: theme.primary },
      onPrimaryText: { color: theme.onPrimary },
      onPrimaryMutedText: { color: withAlpha(theme.onPrimary, 0.86) },
      coachDot: { backgroundColor: theme.accent },
      cardSurface: { backgroundColor: theme.surface, borderColor: withAlpha(theme.primary, 0.1) },
      cardText: { color: theme.primary },
      mutedText: { color: theme.textMuted },
      accentText: { color: theme.accent },
      primaryButton: { backgroundColor: theme.primary },
      primaryButtonText: { color: theme.onPrimary },
      modalSheet: { backgroundColor: theme.base },
      modalHandle: { backgroundColor: withAlpha(theme.primary, 0.2) },
      iconWrap: { backgroundColor: theme.primary },
      accentDot: { backgroundColor: theme.accent },
      subtleText: { color: withAlpha(theme.primary, 0.4) },
      levelName: { color: theme.primary },
      levelAccentDot: { backgroundColor: theme.accent },
      levelTrack: { backgroundColor: withAlpha(theme.primary, 0.1) },
      levelFill: { backgroundColor: theme.accent },
      levelMarker: { backgroundColor: theme.primary },
      levelHint: { color: withAlpha(theme.primary, 0.4) },
      weeklyHeading: { color: theme.primary },
      dayLabel: { color: withAlpha(theme.primary, 0.4) },
      dayLabelToday: { color: theme.accent },
      dayDotDone: { backgroundColor: theme.accent },
      dayDotPlanned: { backgroundColor: theme.primary },
      dayDotRest: { backgroundColor: withAlpha(theme.primary, 0.2) },
      todayRing: { borderColor: theme.accent },
      todayInner: { backgroundColor: theme.primary },
      intentionsBanner: { backgroundColor: withAlpha(theme.accent, 0.12) },
      intentionsIcon: { color: theme.accent },
      intentionsText: { color: theme.primary },
      weeklyDivider: { backgroundColor: withAlpha(theme.primary, 0.12) },
      statValue: { color: theme.primary },
      sessionsError: { color: theme.accent },
      cardDoneBadge: { backgroundColor: theme.accent, borderColor: theme.base },
      modalOverlay: { backgroundColor: withAlpha('#000000', 0.42) },
      sheetIcon: { color: theme.onPrimary },
      flagCircle: { borderColor: theme.primary },
      flexNudge: { borderColor: withAlpha(theme.accent, 0.26), backgroundColor: withAlpha(theme.accent, 0.12) },
      flexNudgeText: { color: theme.primary },
    }),
    [theme]
  );

  return (
    <SafeAreaView style={[styles.screen, themeStyles.screen]}>
      <ScrollView
        ref={tabScrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            tintColor={themeStyles.refresh.tintColor}
            colors={themeStyles.refresh.colors}
            refreshing={isRefreshing || (sessionsFetching && !sessionsLoading)}
            onRefresh={() => void onRefresh()}
          />
        }>
        <TabHeader
          title={headerGreeting}
          subtitle={headerSubtitle}
          paddingHorizontal={0}
          right={
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.headerActionButton, themeStyles.headerActionButton]}
              onPress={() => openFlexWeekSheet()}>
              <Ionicons name="sparkles-outline" size={18} color={theme.primary} />
            </TouchableOpacity>
          }
        />

        <View style={styles.levelProgressSection}>
          <View style={styles.levelHeaderRow}>
            <View style={styles.levelLeft}>
              <Text style={[styles.levelName, themeStyles.levelName]}>{athleteLevel}</Text>
              <View style={[styles.levelAmberDot, themeStyles.levelAccentDot]} />
            </View>
            <Text style={atPeakTier ? styles.levelPeakEmoji : [styles.levelNext, themeStyles.levelHint]}>
              {atPeakTier ? '🏆' : `${nextLevel} →`}
            </Text>
          </View>

          <View style={[styles.levelBarTrack, themeStyles.levelTrack]}>
            <View style={[styles.levelBarFill, themeStyles.levelFill, { width: `${levelProgress.percent}%` }]} />
            <View style={[styles.levelMarker, themeStyles.levelMarker, { left: `${levelProgress.percent}%` }]} />
          </View>

          <Text style={[styles.levelHint, themeStyles.levelHint]}>
            {atPeakTier
              ? 'Champion tier unlocked.'
              : `${levelProgress.remaining} sessions to ${nextLevel}`}
          </Text>
        </View>

        <View style={[styles.coachCard, themeStyles.coachCard]}>
          <View style={styles.coachRow}>
            <View style={styles.coachLabelRow}>
              <View style={[styles.amberDot, themeStyles.coachDot]} />
              <Text style={[styles.coachLabel, themeStyles.accentText]}>Coach directive</Text>
            </View>
          </View>
          <Text style={[styles.coachTitle, themeStyles.onPrimaryText]}>Rova for today</Text>
          <Text style={[styles.coachNote, themeStyles.onPrimaryMutedText]}>{coachBodyText}</Text>
        </View>

        <Pressable
          style={[styles.reflectTodayBtn, { borderColor: withAlpha(theme.primary, 0.14), backgroundColor: theme.surface }]}
          onPress={() => setReflectTodayOpen(true)}
          disabled={!athlete?.id}>
          <Ionicons name="book-outline" size={18} color={theme.accent} />
          <Text style={[styles.reflectTodayLabel, { color: theme.primary }]}>Reflect on today</Text>
        </Pressable>

        {showCatchupNudge ? (
          <Pressable style={[styles.flexNudge, themeStyles.flexNudge]} onPress={() => openFlexWeekSheet('Catch up')}>
            <Text style={[styles.flexNudgeText, themeStyles.flexNudgeText]}>Behind on your plan? Rova can help reshuffle.</Text>
          </Pressable>
        ) : null}

        <View style={[styles.weeklyCard, themeStyles.cardSurface]}>
          <View style={styles.weeklyHeaderRow}>
            <Text style={[styles.weeklyHeading, themeStyles.weeklyHeading]}>This week</Text>
          </View>

          <View style={styles.dayStrip}>
            {[
              { label: 'Mon', iso: weekDates[0] },
              { label: 'Tue', iso: weekDates[1] },
              { label: 'Wed', iso: weekDates[2] },
              { label: 'Thu', iso: weekDates[3] },
              { label: 'Fri', iso: weekDates[4] },
              { label: 'Sat', iso: weekDates[5] },
              { label: 'Sun', iso: weekDates[6] },
            ].map((day) => {
              const daySessions = (weekSessionsByDate[day.iso] ?? []).filter((s) => s.sport !== 'rest');
              const hasAny = daySessions.length > 0;
              const allDone = hasAny && daySessions.every((s) => s.completionStatus === 'completed');
              const isToday = day.iso === todayIso;
              return (
                <View key={day.label} style={styles.dayCol}>
                  <Text
                    style={[
                      styles.dayLabel,
                      themeStyles.dayLabel,
                      isToday ? styles.dayLabelToday : null,
                      isToday ? themeStyles.dayLabelToday : null,
                    ]}>
                    {day.label}
                  </Text>
                  {isToday ? (
                    <View style={[styles.todayRing, themeStyles.todayRing]}>
                      <View style={[styles.todayInner, themeStyles.todayInner]} />
                    </View>
                  ) : allDone ? (
                    <View style={[styles.dayDotDone, themeStyles.dayDotDone]} />
                  ) : hasAny ? (
                    <View style={[styles.dayDotPlanned, themeStyles.dayDotPlanned]} />
                  ) : (
                    <View style={[styles.dayDotRest, themeStyles.dayDotRest]} />
                  )}
                </View>
              );
            })}
          </View>

          <Pressable style={[styles.intentionsBanner, themeStyles.intentionsBanner]} onPress={openIntentionsEditor}>
            <Ionicons name="pencil" size={14} color={themeStyles.intentionsIcon.color} />
            <Text style={[styles.intentionsBannerText, themeStyles.intentionsText]}>
              {weeklyIntention ? 'Edit weekly intention' : 'Set weekly intention'}
            </Text>
          </Pressable>
          {weeklyIntention ? (
            <Text style={[styles.intentionSummaryText, themeStyles.mutedText]} numberOfLines={3}>
              {weeklyIntention}
            </Text>
          ) : (
            <Text style={[styles.intentionSummaryPlaceholder, themeStyles.subtleText]}>
              Add a weekly intention to keep your training focused.
            </Text>
          )}

          <View style={[styles.weeklyDivider, themeStyles.weeklyDivider]} />
          <View style={styles.statsRow}>
            {[
              { value: weekLoading ? '—' : `${weekStats.doneCount} / ${weekStats.totalCount}`, label: 'Sessions done' },
              { value: weekLoading ? '—' : weekStats.totalTimeLabel, label: 'Total time' },
              { value: weekLoading ? '—' : weekStats.longestStreakLabel, label: 'Longest streak' },
            ].map((stat) => (
              <View key={stat.label} style={styles.statCol}>
                <Text style={[styles.statValue, themeStyles.statValue]}>{stat.value}</Text>
                <Text style={[styles.statLabel, themeStyles.subtleText]}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sessionsSection}>
          <Text style={[styles.sessionsHeading, themeStyles.cardText]}>Upcoming</Text>
          {sessionsError ? (
            <Text style={[styles.sessionsError, themeStyles.sessionsError]}>Couldn&apos;t load today&apos;s sessions. Pull to refresh.</Text>
          ) : null}
          {upcomingSessionsLoading ? <Text style={[styles.sessionsLoading, themeStyles.subtleText]}>Loading upcoming sessions...</Text> : null}
          {!upcomingSessionsLoading && upcomingSessionGroups.length === 0 ? (
            <Text style={[styles.sessionsLoading, themeStyles.subtleText]}>
              No upcoming sessions scheduled. Check your plan or log a session manually.
            </Text>
          ) : null}
          {sessionsLoading ? (
            <View style={styles.skeletonList}>
              {Array.from({ length: 3 }, (_, idx) => (
                <View key={`today-skeleton-${idx}`} style={styles.skeletonCard}>
                  <SkeletonBlock style={styles.skeletonIcon} />
                  <View style={styles.skeletonTextWrap}>
                    <SkeletonBlock style={styles.skeletonLinePrimary} />
                    <SkeletonBlock style={styles.skeletonLineSecondary} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {!sessionsLoading &&
            upcomingSessionGroups.map((group) => (
            <View key={group.date} style={styles.upcomingGroup}>
              <Text style={[styles.upcomingDateLabel, { color: withAlpha(theme.primary, 0.5) }]}>{group.label}</Text>
              {group.sessions.map((session) => (
                <Pressable
                  key={session.id}
                  style={[styles.workoutCard, themeStyles.cardSurface]}
                  onPress={() => router.push(`/SessionDetail?sessionId=${session.id}`)}>
                  <View style={[styles.workoutIconWrap, themeStyles.iconWrap]}>
                    {session.status === 'completed' ? (
                      <View style={[styles.cardDoneBadge, themeStyles.cardDoneBadge]}>
                        <Ionicons name="checkmark" size={9} color={theme.onAccent} />
                      </View>
                    ) : null}
                    {getSportIcon(session.sport, 16, theme.surface)}
                    <View style={[styles.iconAccentDot, themeStyles.accentDot]} />
                  </View>
                  <View style={styles.workoutTextWrap}>
                    <Text
                      style={[
                        styles.workoutTitle,
                        themeStyles.cardText,
                        session.status === 'completed' ? styles.workoutTitleDone : null,
                      ]}>
                      {session.title}
                    </Text>
                    {session.status === 'completed' ? (
                      <Text style={[styles.workoutSubtitleDone, themeStyles.accentText]}>
                        Completed ·{' '}
                        {new Date(
                          session.completedAt ?? new Date().toISOString()
                        ).toLocaleTimeString('en-AU', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Text>
                    ) : (
                      <Text style={[styles.workoutSubtitle, themeStyles.mutedText]}>{session.meta}</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={withAlpha(theme.primary, 0.2)} />
                </Pressable>
              ))}
            </View>
          ))}
        </View>

      </ScrollView>

      <FloatingPillNav active="today" />

      {athlete?.id && reflectTodayOpen ? (
        <DailyReflectionSheet
          visible
          athleteId={athlete.id}
          entryDateIso={todayIso}
          onClose={() => setReflectTodayOpen(false)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: journalQueryKeys.all });
          }}
        />
      ) : null}

      <Modal transparent visible={isIntentionsOpen} animationType="none" onRequestClose={closeIntentionsSheet}>
        <View style={styles.modalRoot}>
          <Pressable style={[styles.modalOverlay, themeStyles.modalOverlay]} onPress={closeIntentionsSheet} />
          <Animated.View style={[styles.sheet, themeStyles.modalSheet, { transform: [{ translateY: intentionSheetY }] }]}>
            <View style={[styles.sheetHandle, themeStyles.modalHandle]} />
            <Pressable style={styles.sheetCloseButton} onPress={closeIntentionsSheet} hitSlop={8}>
              <Ionicons name="close" size={16} color={theme.primary} />
            </Pressable>
            <Text style={[styles.sheetTitle, themeStyles.cardText]}>Weekly intentions</Text>
            <Text style={[styles.sheetDescription, themeStyles.mutedText]}>
              Write your focus for the week. This saves for the current week and can be updated anytime.
            </Text>
            <TextInput
              value={intentionDraft}
              onChangeText={setIntentionDraft}
              multiline
              placeholder={`Examples:\n- ${WEEKLY_INTENTION_EXAMPLES.join('\n- ')}`}
              placeholderTextColor={withAlpha(theme.text, 0.4)}
              style={[styles.intentionInput, { color: theme.text, borderColor: withAlpha(theme.primary, 0.14), backgroundColor: theme.surface }]}
            />
            <View style={styles.examplePills}>
              {WEEKLY_INTENTION_EXAMPLES.map((item) => (
                <Pressable
                  key={item}
                  style={[styles.examplePill, { borderColor: withAlpha(theme.primary, 0.12), backgroundColor: withAlpha(theme.primary, 0.04) }]}
                  onPress={() => setIntentionDraft(item)}>
                  <Text style={[styles.examplePillText, themeStyles.cardText]} numberOfLines={1}>
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TouchableOpacity
              activeOpacity={0.9}
              style={[styles.sheetPrimaryButton, themeStyles.primaryButton]}
              onPress={() => void saveWeeklyIntention()}>
              <Text style={[styles.sheetPrimaryButtonText, themeStyles.primaryButtonText]}>Save intentions</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <FlexWeekSheet
        visible={isFlexWeekOpen}
        athleteId={athlete?.id}
        weekStartDate={weekDates[0]}
        initialReason={flexInitialReason}
        onClose={closeFlexWeekSheet}
        onManualModeRequested={() => {
          closeFlexWeekSheet();
          router.push('/(tabs)/plan');
          if (Platform.OS === 'android') {
            ToastAndroid.show('Manual mode: use Plan > Week drag-and-drop', ToastAndroid.SHORT);
          }
        }}
      />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F3EE',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 150,
    gap: 16,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  headerActionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C97E2F',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.12)',
  },
  coachCard: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderRadius: 14,
    backgroundColor: '#0F2840',
  },
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  amberDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C97E2F',
  },
  coachLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coachLabel: {
    fontFamily: 'DMSans-SemiBold',
    fontSize: 13,
    color: '#C97E2F',
  },
  coachBadge: {
    paddingHorizontal: 2,
  },
  coachBadgeText: {
    color: 'rgba(255,255,255,0.35)',
    fontFamily: 'DMSans-SemiBold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  coachTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 24,
    lineHeight: 28,
    color: '#FFFFFF',
    marginBottom: 10,
  },
  coachNote: {
    fontFamily: 'DMSans-Regular',
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.7)',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  reflectTodayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  reflectTodayLabel: {
    fontFamily: 'DMSans-SemiBold',
    fontSize: 14,
  },
  sessionsSection: {
    marginTop: 4,
    gap: 10,
  },
  weeklyCard: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    padding: 16,
  },
  weeklyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  weeklyHeading: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 18,
    color: '#0F2840',
  },
  weeklyDateRange: {
    fontFamily: 'DMSans-Regular',
    fontSize: 11,
    color: 'rgba(15,40,64,0.4)',
  },
  dayStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  dayCol: {
    alignItems: 'center',
    gap: 6,
    minWidth: 34,
  },
  dayLabel: {
    fontFamily: 'DMSans-Regular',
    fontSize: 10,
    color: 'rgba(15,40,64,0.4)',
  },
  dayLabelToday: {
    color: '#C97E2F',
    fontFamily: 'DMSans-Medium',
  },
  dayDotDone: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#C97E2F',
  },
  dayDotPlanned: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#0F2840',
  },
  dayDotRest: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(15,40,64,0.2)',
    marginTop: 3,
  },
  todayRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#C97E2F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0F2840',
  },
  intentionsBanner: {
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(201,126,47,0.12)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  intentionsBannerText: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: '#0F2840',
  },
  intentionSummaryText: {
    marginTop: 8,
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    lineHeight: 17,
    color: '#0F2840',
  },
  intentionSummaryPlaceholder: {
    marginTop: 8,
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: 'rgba(15,40,64,0.45)',
  },
  weeklyDivider: {
    marginTop: 10,
    marginBottom: 10,
    height: 1,
    backgroundColor: 'rgba(15,40,64,0.12)',
  },
  statsRow: {
    flexDirection: 'row',
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 20,
    color: '#0F2840',
  },
  statLabel: {
    fontFamily: 'DMSans-Regular',
    fontSize: 10,
    color: 'rgba(15,40,64,0.4)',
  },
  levelProgressSection: {
    paddingHorizontal: 2,
    paddingTop: 2,
  },
  levelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  levelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  levelName: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 16,
    color: '#0F2840',
  },
  levelAmberDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C97E2F',
  },
  levelNext: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: 'rgba(15,40,64,0.4)',
  },
  levelPeakEmoji: {
    fontSize: 22,
    lineHeight: 26,
    textAlign: 'right',
  },
  levelBarTrack: {
    width: '100%',
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15,40,64,0.1)',
    position: 'relative',
    marginBottom: 8,
  },
  levelBarFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#C97E2F',
  },
  levelMarker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0F2840',
    position: 'absolute',
    marginLeft: -4,
    top: -2,
  },
  levelHint: {
    textAlign: 'right',
    fontFamily: 'DMSans-Regular',
    fontSize: 11,
    color: 'rgba(15,40,64,0.4)',
  },
  sessionsHeading: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 30,
    color: '#0F2840',
  },
  sessionsLoading: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: 'rgba(15,40,64,0.4)',
  },
  sessionsError: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: '#C97E2F',
  },
  skeletonList: {
    gap: 8,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    padding: 12,
  },
  skeletonIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    marginRight: 10,
  },
  skeletonTextWrap: {
    flex: 1,
    gap: 8,
  },
  skeletonLinePrimary: {
    height: 14,
    width: '58%',
    borderRadius: 8,
  },
  skeletonLineSecondary: {
    height: 11,
    width: '76%',
    borderRadius: 8,
  },
  upcomingGroup: {
    gap: 8,
    marginTop: 2,
  },
  upcomingDateLabel: {
    fontFamily: 'DMSans-SemiBold',
    fontSize: 11,
    color: 'rgba(15,40,64,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 2,
  },
  workoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    padding: 12,
  },
  workoutIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0F2840',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    position: 'relative',
  },
  iconAccentDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#C97E2F',
    position: 'absolute',
    right: 6,
    top: 6,
  },
  workoutTextWrap: {
    flex: 1,
  },
  workoutTitle: {
    fontFamily: 'DMSans-Medium',
    fontSize: 15,
    color: '#0F2840',
    marginBottom: 2,
  },
  workoutTitleDone: {
    opacity: 0.6,
  },
  workoutSubtitle: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: 'rgba(15,40,64,0.4)',
  },
  workoutSubtitleDone: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: '#C97E2F',
  },
  cardDoneBadge: {
    position: 'absolute',
    left: -5,
    top: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#C97E2F',
    borderWidth: 1,
    borderColor: '#F6F3EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    backgroundColor: '#F6F3EE',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 34,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15,40,64,0.2)',
    marginBottom: 16,
  },
  sheetCloseButton: {
    position: 'absolute',
    top: 10,
    right: 14,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  sheetIconWrap: {
    alignItems: 'center',
    marginBottom: 10,
  },
  sheetIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#0F2840',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetLabel: {
    textAlign: 'center',
    fontFamily: 'DMSans-SemiBold',
    fontSize: 11,
    color: '#C97E2F',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  sheetTitle: {
    textAlign: 'center',
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 36,
    color: '#0F2840',
    marginBottom: 8,
  },
  sheetDescription: {
    textAlign: 'center',
    fontFamily: 'DMSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(15,40,64,0.55)',
    marginBottom: 16,
  },
  intentionInput: {
    minHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'DMSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  examplePills: {
    gap: 8,
    marginBottom: 12,
  },
  examplePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  examplePillText: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
  },
  sheetPrimaryButton: {
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#0F2840',
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  sheetPrimaryButtonText: {
    fontFamily: 'DMSans-Medium',
    color: '#F6F3EE',
    fontSize: 15,
  },
  sheetSkipText: {
    textAlign: 'center',
    fontFamily: 'DMSans-Medium',
    color: 'rgba(15,40,64,0.4)',
    fontSize: 14,
  },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  flagCircle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.3,
    borderColor: '#0F2840',
  },
  flagText: {
    fontFamily: 'DMSans-Regular',
    fontSize: 14,
    color: '#0F2840',
  },
  flexNudge: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(201,126,47,0.26)',
    backgroundColor: 'rgba(201,126,47,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flexNudgeText: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: '#0F2840',
  },
});
