import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import { StatusAreaFade } from '@/components/status-area-fade';
import { TabHeader } from '@/components/tab-header';
import { useTheme } from '@/contexts/ThemeContext';
import { useScrollToTopTabRef } from '@/hooks/useScrollToTopTabRef';
import { ensureAthleteRowExists, ensureSupabaseAuthUser } from '@/lib/supabase-auth';
import {
  sessionQueryKeys,
  useActiveAthlete,
  useCompletedSessionLogs,
  useLevelProgress,
  usePersonalBests,
  usePersonalBestSessionLogs,
  useWeekSessions,
} from '@/hooks/useSessionData';
import { withAlpha } from '@/lib/theme-utils';
import { datePickerAndroidMondayOpenProps, datePickerMondayWeekProps } from '@/lib/dates';
import { supabase } from '@/lib/supabase';
import {
  PERSONAL_BEST_CATALOG,
  catalogDistanceMatches,
  catalogRowKey,
  findWinnerForAdhocDistance,
  findWinnerForCatalogEntry,
  formatMinutesAsMmSs,
  isCollapsedPersonalBestPreview,
  parseMmSsToMinutes,
  upsertManualPersonalBestCustom,
  upsertManualPersonalBestFromSessionsWinner,
  type PersonalBestCatalogEntry,
  type PersonalBestSport,
} from '@/services/personalBests';
import type { Database } from '@/types/supabase';

type PersonalBestRow = Database['public']['Tables']['personal_bests']['Row'];

type PeriodKey = 'week' | 'month' | 'twelveWeeks' | 'all';
type Sport = 'swim' | 'bike' | 'run';

type PbSheetTarget =
  | { mode: 'catalog'; entry: PersonalBestCatalogEntry }
  | { mode: 'custom'; row: PersonalBestRow }
  | { mode: 'new_custom' };

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'twelveWeeks', label: '12 weeks' },
  { key: 'all', label: 'All time' },
];

const SHEET_SPORTS: { key: PersonalBestSport; label: string }[] = [
  { key: 'swim', label: 'Swim' },
  { key: 'bike', label: 'Bike' },
  { key: 'run', label: 'Run' },
];

function getWeekStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIsoDate(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getPeriodStart(now: Date, period: PeriodKey) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'week') return getWeekStart(now);
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'twelveWeeks') {
    d.setDate(d.getDate() - 7 * 12);
    return d;
  }
  return new Date(0);
}

function formatDuration(mins: number) {
  if (!Number.isFinite(mins) || mins <= 0) return '0m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const rem = Math.round(mins % 60);
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function formatDistance(km: number) {
  if (!Number.isFinite(km) || km <= 0) return '0 km';
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function matchesCatalog(row: PersonalBestRow, entry: PersonalBestCatalogEntry): boolean {
  return (
    row.sport === entry.sport &&
    catalogDistanceMatches(row.distance, entry.distance) &&
    row.distance_unit === entry.distance_unit
  );
}

function customRowLabel(row: PersonalBestRow): string {
  const u = row.distance_unit === 'm' ? 'm' : 'km';
  const n = Number(row.distance);
  const dist =
    row.distance_unit === 'km' && !Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 10) / 10);
  return `${row.sport} ${dist}${u}`;
}

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tabScrollRef = useScrollToTopTabRef();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>('week');
  const [pbTarget, setPbTarget] = useState<PbSheetTarget | null>(null);
  const [manualTimeDraft, setManualTimeDraft] = useState('');
  const [achievedDateIso, setAchievedDateIso] = useState(toIsoDate(new Date()));
  const [iosDatePickerOpen, setIosDatePickerOpen] = useState(false);
  const [highlightsExpanded, setHighlightsExpanded] = useState(false);

  const [newCustomSport, setNewCustomSport] = useState<PersonalBestSport>('run');
  const [newCustomDistance, setNewCustomDistance] = useState('');
  const [newCustomUnit, setNewCustomUnit] = useState<'m' | 'km'>('km');
  const [saveAction, setSaveAction] = useState<'from_sessions' | 'manual' | 'new_custom' | null>(null);

  const now = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => getWeekStart(new Date()), []);
  const weekDates = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return toIsoDate(d);
      }),
    [weekStart]
  );
  const { data: weekSessionsByDate = {} } = useWeekSessions(weekStart);
  const { data: athlete } = useActiveAthlete();
  const [authAthleteId, setAuthAthleteId] = useState<string | null>(null);
  /** Align with canonical athlete from DB (auth uid) so PB reads/writes use the same id as RLS. */
  const athleteId = athlete?.id ?? authAthleteId ?? null;
  const levelProgress = useLevelProgress(athleteId, athlete?.level);
  const athleteLevel = levelProgress.currentLevel;
  const nextLevel = levelProgress.nextLevel;
  const atPeakTier = levelProgress.atPeakTier;

  useEffect(() => {
    let mounted = true;
    const primeSessionAndAthlete = async () => {
      try {
        const authUser = await ensureSupabaseAuthUser();
        await ensureAthleteRowExists(authUser.id);
        if (!mounted) return;
        setAuthAthleteId(authUser.id);
        await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() });
      } catch {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!mounted) return;
        const sid = session?.user?.id ?? null;
        setAuthAthleteId(sid);
        if (sid) {
          try {
            await ensureAthleteRowExists(sid);
            if (!mounted) return;
            await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() });
          } catch {
            /* ignore */
          }
        }
      }
    };
    void primeSessionAndAthlete();
    return () => {
      mounted = false;
    };
  }, [queryClient]);

  const periodStart = useMemo(() => getPeriodStart(now, selectedPeriod), [now, selectedPeriod]);
  const fromIso = useMemo(() => toIsoDate(periodStart), [periodStart]);
  const toIso = useMemo(() => toIsoDate(now), [now]);
  const { data: logs = [], isLoading: logsLoading } = useCompletedSessionLogs({
    athleteId,
    fromIso,
    toIso,
    trainingType: 'overall',
  });

  const { data: pbRows = [] } = usePersonalBests(athleteId);
  const { data: pbLogs = [] } = usePersonalBestSessionLogs(athleteId);

  const { data: wildCards = [] } = useQuery({
    queryKey: ['rova_challenges', 'counts', athleteId ?? 'none', fromIso, toIso] as const,
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return [];
      const { data, error } = await supabase
        .from('rova_challenges')
        .select('status')
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', fromIso)
        .lte('scheduled_date', toIso);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const weeklyMomentum = useMemo(() => {
    const sessions = weekDates.flatMap((date) => weekSessionsByDate[date] ?? []);
    const nonRest = sessions.filter((s) => s.sport !== 'rest');
    const completed = nonRest.filter((s) => s.completionStatus === 'completed').length;

    let currentStreakDays = 0;
    for (let i = weekDates.length - 1; i >= 0; i -= 1) {
      const day = weekDates[i];
      const daySessions = (weekSessionsByDate[day] ?? []).filter((s) => s.sport !== 'rest');
      if (daySessions.length === 0) break;
      const allDone = daySessions.every((s) => s.completionStatus === 'completed');
      if (!allDone) break;
      currentStreakDays += 1;
    }
    return {
      done: completed,
      total: nonRest.length,
      percent: nonRest.length > 0 ? Math.round((completed / nonRest.length) * 100) : 0,
      streakDays: currentStreakDays,
      streakWeeks: (currentStreakDays / 7).toFixed(1),
    };
  }, [weekDates, weekSessionsByDate]);

  const performance = useMemo(() => {
    type Row = {
      sport: Sport | null;
      duration: number;
      distanceKm: number;
      hr: number | null;
      rpe: number | null;
      title: string;
      completedAt: string;
      sessionId: string;
    };
    const rows: Row[] = logs.map((row: any) => {
      const sport = row.sessions?.sport;
      const rawDistance = typeof row.actual_distance === 'number' ? row.actual_distance : 0;
      const unit = row.sessions?.distance_unit ?? 'km';
      const distanceKm = unit === 'm' ? rawDistance / 1000 : rawDistance;
      return {
        sport: sport === 'swim' || sport === 'bike' || sport === 'run' ? sport : null,
        duration: typeof row.actual_duration_mins === 'number' ? row.actual_duration_mins : 0,
        distanceKm,
        hr: typeof row.avg_heart_rate === 'number' ? row.avg_heart_rate : null,
        rpe: typeof row.rpe === 'number' ? row.rpe : null,
        title: row.sessions?.title ?? 'Session',
        completedAt: row.completed_at,
        sessionId: row.session_id,
      };
    });

    const totalDuration = rows.reduce((sum, r) => sum + r.duration, 0);
    const totalDistance = rows.reduce((sum, r) => sum + r.distanceKm, 0);
    const bySport = rows.reduce<Record<Sport, number>>(
      (acc, r) => {
        if (r.sport) acc[r.sport] += r.duration;
        return acc;
      },
      { swim: 0, bike: 0, run: 0 }
    );
    const totalSport = bySport.swim + bySport.bike + bySport.run;
    const sportPercent: Record<Sport, number> = {
      swim: totalSport > 0 ? Math.round((bySport.swim / totalSport) * 100) : 0,
      bike: totalSport > 0 ? Math.round((bySport.bike / totalSport) * 100) : 0,
      run: totalSport > 0 ? Math.round((bySport.run / totalSport) * 100) : 0,
    };

    const hrs = rows.map((r) => r.hr).filter((n): n is number => typeof n === 'number' && n > 0);
    const rpes = rows.map((r) => r.rpe).filter((n): n is number => typeof n === 'number' && n > 0);

    const recent = rows.slice(0, 3);
    return {
      totalDuration,
      totalDistance,
      sportPercent,
      avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      avgRpe: rpes.length ? (rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1) : null,
      recent,
    };
  }, [logs]);

  const wildStats = useMemo(() => {
    const total = wildCards.length;
    const done = wildCards.filter((c: any) => c.status === 'completed').length;
    return { done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [wildCards]);

  const customPbRows = useMemo(
    () => pbRows.filter((row) => !PERSONAL_BEST_CATALOG.some((e) => matchesCatalog(row, e))),
    [pbRows]
  );

  const milestoneRows = useMemo(() => {
    const catalogSlice = highlightsExpanded
      ? [...PERSONAL_BEST_CATALOG]
      : PERSONAL_BEST_CATALOG.filter((e) => isCollapsedPersonalBestPreview(e));
    const catalogMapped = catalogSlice.map((entry) => ({
      kind: 'catalog' as const,
      entry,
      stored: pbRows.find((r) => matchesCatalog(r, entry)),
    }));
    const extras =
      highlightsExpanded && customPbRows.length > 0
        ? customPbRows.map((row) => ({ kind: 'custom' as const, row, stored: row }))
        : [];
    return [...catalogMapped, ...extras];
  }, [customPbRows, highlightsExpanded, pbRows]);

  const sheetTitle = useMemo(() => {
    if (!pbTarget) return '';
    if (pbTarget.mode === 'catalog') return pbTarget.entry.label;
    if (pbTarget.mode === 'custom') return customRowLabel(pbTarget.row);
    return 'Custom distance PB';
  }, [pbTarget]);

  const previewWinner = useMemo(() => {
    if (!pbTarget) return null;
    if (pbTarget.mode === 'catalog') return findWinnerForCatalogEntry(pbLogs, pbTarget.entry);
    if (pbTarget.mode === 'custom')
      return findWinnerForAdhocDistance(
        pbLogs,
        pbTarget.row.sport as PersonalBestSport,
        Number(pbTarget.row.distance),
        pbTarget.row.distance_unit as 'm' | 'km'
      );
    return null;
  }, [pbTarget, pbLogs]);

  const openPbSheet = (target: PbSheetTarget) => {
    setPbTarget(target);
    setManualTimeDraft('');
    setAchievedDateIso(toIsoDate(new Date()));
    if (target.mode === 'new_custom') {
      setNewCustomSport('run');
      setNewCustomDistance('');
      setNewCustomUnit('km');
      return;
    }
    if (target.mode === 'custom') {
      const t = Number(target.row.time_mins);
      if (Number.isFinite(t)) setManualTimeDraft(formatMinutesAsMmSs(t));
      setAchievedDateIso(target.row.achieved_date);
    }
    if (target.mode === 'catalog') {
      const stored = pbRows.find((r) => matchesCatalog(r, target.entry));
      if (stored) {
        const t = Number(stored.time_mins);
        if (Number.isFinite(t)) setManualTimeDraft(formatMinutesAsMmSs(t));
        setAchievedDateIso(stored.achieved_date);
      }
    }
  };

  const closePbSheet = () => {
    setPbTarget(null);
    setManualTimeDraft('');
    setIosDatePickerOpen(false);
    setSaveAction(null);
  };

  const invalidatePersonalBests = async () => {
    await queryClient.invalidateQueries({ queryKey: ['personal_bests'] });
    await queryClient.refetchQueries({ queryKey: ['personal_bests'] });
  };

  const parsedNewCustomDistance = useMemo(() => Number(newCustomDistance.replace(',', '.').trim()), [newCustomDistance]);
  const isNewCustomDistanceValid = Number.isFinite(parsedNewCustomDistance) && parsedNewCustomDistance > 0;
  const parsedManualTime = useMemo(() => parseMmSsToMinutes(manualTimeDraft), [manualTimeDraft]);
  const isManualTimeValid = parsedManualTime != null;
  const isAchievedDateValid = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(achievedDateIso)) return false;
    const parsed = new Date(`${achievedDateIso}T12:00:00`);
    return !Number.isNaN(parsed.getTime());
  }, [achievedDateIso]);
  const canSaveNewCustom =
    !!athleteId && pbTarget?.mode === 'new_custom' && isNewCustomDistanceValid && isManualTimeValid && isAchievedDateValid;
  const canSaveManual = !!athleteId && !!pbTarget && pbTarget.mode !== 'new_custom' && isManualTimeValid && isAchievedDateValid;

  const handleUseBestFromSessions = async () => {
    if (!athleteId || !pbTarget || pbTarget.mode === 'new_custom' || !previewWinner || saveAction) return;
    setSaveAction('from_sessions');
    try {
      if (pbTarget.mode === 'catalog') {
        await upsertManualPersonalBestFromSessionsWinner({
          athleteId,
          entry: pbTarget.entry,
          winner: previewWinner,
        });
      } else {
        await upsertManualPersonalBestCustom({
          athleteId,
          sport: pbTarget.row.sport as PersonalBestSport,
          distance: Number(pbTarget.row.distance),
          distance_unit: pbTarget.row.distance_unit as 'm' | 'km',
          time_mins: previewWinner.actual_duration_mins,
          achieved_date_iso: previewWinner.achieved_date_iso,
        });
      }
      await invalidatePersonalBests();
      Alert.alert('Saved', 'Milestone saved successfully.');
      closePbSheet();
    } catch (e: any) {
      Alert.alert('Could not save PB', e?.message ?? 'Unknown error');
    } finally {
      setSaveAction(null);
    }
  };

  const handleSaveManual = async () => {
    if (!athleteId || !pbTarget || pbTarget.mode === 'new_custom' || saveAction) return;
    if (!isAchievedDateValid) {
      Alert.alert('Check date', 'Please choose a valid achieved date.');
      return;
    }
    if (!isManualTimeValid || parsedManualTime == null) {
      Alert.alert('Check time', 'Use MM:SS (e.g. 42:30) or minutes.');
      return;
    }
    setSaveAction('manual');
    try {
      if (pbTarget.mode === 'catalog') {
        await upsertManualPersonalBestCustom({
          athleteId,
          sport: pbTarget.entry.sport,
          distance: pbTarget.entry.distance,
          distance_unit: pbTarget.entry.distance_unit,
          time_mins: parsedManualTime,
          achieved_date_iso: achievedDateIso,
        });
      } else {
        await upsertManualPersonalBestCustom({
          athleteId,
          sport: pbTarget.row.sport as PersonalBestSport,
          distance: Number(pbTarget.row.distance),
          distance_unit: pbTarget.row.distance_unit as 'm' | 'km',
          time_mins: parsedManualTime,
          achieved_date_iso: achievedDateIso,
        });
      }
      await invalidatePersonalBests();
      Alert.alert('Saved', 'Milestone saved successfully.');
      closePbSheet();
    } catch (e: any) {
      Alert.alert('Could not save PB', e?.message ?? 'Unknown error');
    } finally {
      setSaveAction(null);
    }
  };

  const handleSaveNewCustom = async () => {
    if (!athleteId || pbTarget?.mode !== 'new_custom' || saveAction) return;
    if (!isAchievedDateValid) {
      Alert.alert('Check date', 'Please choose a valid achieved date.');
      return;
    }
    if (!isNewCustomDistanceValid) {
      Alert.alert('Distance', 'Enter a positive distance.');
      return;
    }
    if (!isManualTimeValid || parsedManualTime == null) {
      Alert.alert('Check time', 'Use MM:SS (e.g. 42:30) or minutes.');
      return;
    }
    setSaveAction('new_custom');
    try {
      await upsertManualPersonalBestCustom({
        athleteId,
        sport: newCustomSport,
        distance: parsedNewCustomDistance,
        distance_unit: newCustomUnit,
        time_mins: parsedManualTime,
        achieved_date_iso: achievedDateIso,
      });
      await invalidatePersonalBests();
      Alert.alert('Saved', 'Milestone saved successfully.');
      closePbSheet();
    } catch (e: any) {
      Alert.alert('Could not save PB', e?.message ?? 'Unknown error');
    } finally {
      setSaveAction(null);
    }
  };

  const openAchievedDatePicker = () => {
    Keyboard.dismiss();
    const value = new Date(`${achievedDateIso}T12:00:00`);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        ...datePickerAndroidMondayOpenProps(),
        value,
        mode: 'date',
        onChange: (event, selected) => {
          if (event.type !== 'set') return;
          if (!selected) return;
          setAchievedDateIso(toIsoDate(selected));
        },
      });
      return;
    }
    setIosDatePickerOpen(true);
  };

  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusAreaFade height={insets.top + 8} />
      <ScrollView
        ref={tabScrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}>
        <TabHeader title="Progress" paddingHorizontal={0} />

        <View style={styles.levelProgressSection}>
          <View style={styles.levelHeaderRow}>
            <View style={styles.levelLeft}>
              <Text style={styles.levelName}>{athleteLevel}</Text>
              <View style={styles.levelAmberDot} />
            </View>
            <Text style={atPeakTier ? styles.levelPeakEmoji : styles.levelNext}>
              {atPeakTier ? '🏆' : `${nextLevel} →`}
            </Text>
          </View>
          <View style={styles.levelBarTrack}>
            <View style={[styles.levelBarFill, { width: `${levelProgress.percent}%` }]} />
            <View style={[styles.levelMarker, { left: `${levelProgress.percent}%` }]} />
          </View>
          <Text style={styles.levelHint}>
            {atPeakTier
              ? 'Champion tier unlocked.'
              : `${levelProgress.remaining} sessions to ${nextLevel}`}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Current momentum</Text>
          <View style={styles.rowSpread}>
            <Text style={styles.metricTitle}>This week&apos;s completion</Text>
            <Text style={styles.metricValue}>
              {weeklyMomentum.done}/{weeklyMomentum.total} ({weeklyMomentum.percent}%)
            </Text>
          </View>
          <View style={styles.rowSpread}>
            <Text style={styles.metricTitle}>Current streak</Text>
            <Text style={styles.metricValue}>
              {weeklyMomentum.streakDays} days ({weeklyMomentum.streakWeeks} weeks)
            </Text>
          </View>
          <View style={styles.weekDotsRow}>
            {weekDates.map((date) => {
              const daySessions = (weekSessionsByDate[date] ?? []).filter((s) => s.sport !== 'rest');
              const allDone = daySessions.length > 0 && daySessions.every((s) => s.completionStatus === 'completed');
              const hasPlan = daySessions.length > 0;
              return (
                <View
                  key={date}
                  style={[
                    styles.weekDot,
                    allDone ? styles.weekDotDone : hasPlan ? styles.weekDotPlanned : styles.weekDotEmpty,
                  ]}
                />
              );
            })}
          </View>
        </View>

        <View style={styles.segmentWrap}>
          {PERIOD_OPTIONS.map((option) => {
            const active = selectedPeriod === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                style={[styles.segmentChip, active ? styles.segmentChipActive : null]}
                onPress={() => setSelectedPeriod(option.key)}>
                <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Performance trends</Text>
          <Text style={styles.blockValue}>
            {formatDuration(performance.totalDuration)} · {formatDistance(performance.totalDistance)}
          </Text>
          <Text style={styles.blockCaption}>Total time and distance ({PERIOD_OPTIONS.find((p) => p.key === selectedPeriod)?.label})</Text>
          <View style={styles.breakdownStack}>
            {(['swim', 'bike', 'run'] as Sport[]).map((sport) => (
              <View key={sport} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{sport}</Text>
                <View style={styles.breakdownTrack}>
                  <View style={[styles.breakdownFill, { width: `${performance.sportPercent[sport]}%` }]} />
                </View>
                <Text style={styles.breakdownPct}>{performance.sportPercent[sport]}%</Text>
              </View>
            ))}
          </View>
          {performance.avgHr !== null || performance.avgRpe !== null ? (
            <View style={styles.avgRow}>
              {performance.avgHr !== null ? <Text style={styles.avgText}>Avg HR {performance.avgHr} bpm</Text> : null}
              {performance.avgRpe !== null ? <Text style={styles.avgText}>Avg RPE {performance.avgRpe}/10</Text> : null}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle highlights"
            style={styles.rowSpread}
            onPress={() => setHighlightsExpanded((prev) => !prev)}>
            <Text style={styles.sectionTitle}>Highlights</Text>
            <Ionicons name={highlightsExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textMuted} />
          </Pressable>
          {highlightsExpanded ? (
            <>
              {!athleteId ? <Text style={styles.blockCaption}>Sign in or load an athlete profile to track PBs.</Text> : null}
              {athleteId
                ? milestoneRows.map((item) => {
                    const label = item.kind === 'catalog' ? item.entry.label : customRowLabel(item.row);
                    const stored = item.stored;
                    const displayTime = stored ? formatMinutesAsMmSs(Number(stored.time_mins)) : 'Not set';
                    const badge = stored?.source === 'auto' ? 'Auto' : stored?.source === 'manual' ? 'Manual' : null;
                    const dateLabel =
                      stored?.achieved_date &&
                      new Date(`${stored.achieved_date}T12:00:00`).toLocaleDateString('en-AU', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      });
                    return (
                      <Pressable
                        key={item.kind === 'catalog' ? catalogRowKey(item.entry) : item.row.id}
                        style={styles.pbRow}
                        onPress={() =>
                          openPbSheet(
                            item.kind === 'catalog'
                              ? { mode: 'catalog', entry: item.entry }
                              : { mode: 'custom', row: item.row }
                          )
                        }>
                        <View style={styles.pbLeft}>
                          <Text style={styles.pbLabel}>{label}</Text>
                          {dateLabel ? <Text style={styles.pbDate}>{dateLabel}</Text> : null}
                        </View>
                        <View style={styles.pbRight}>
                          {badge ? (
                            <View style={styles.pbBadge}>
                              <Text style={styles.pbBadgeText}>{badge}</Text>
                            </View>
                          ) : null}
                          <Text style={styles.pbValue}>{displayTime}</Text>
                        </View>
                      </Pressable>
                    );
                  })
                : null}
              {athleteId ? (
                <Pressable style={styles.addCustomPb} onPress={() => openPbSheet({ mode: 'new_custom' })}>
                  <Text style={styles.addCustomPbText}>+ Add custom distance</Text>
                </Pressable>
              ) : null}

              <View style={styles.rowSpread}>
                <Text style={styles.metricTitle}>Rova wild cards completed</Text>
                <Text style={styles.metricValue}>
                  {wildStats.done} ({wildStats.percent}%)
                </Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.rowSpread}>
            <Text style={styles.sectionTitle}>Recent activity</Text>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/progress-history',
                  params: { fromIso, toIso, period: selectedPeriod },
                })
              }>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </Pressable>
          </View>
          {logsLoading ? <Text style={styles.blockCaption}>Loading...</Text> : null}
          {!logsLoading && performance.recent.length === 0 ? <Text style={styles.blockCaption}>No sessions in this period.</Text> : null}
          {performance.recent.map((session) => (
            <Pressable
              key={`${session.sessionId}-${session.completedAt}`}
              style={styles.activityRow}
              onPress={() => router.push(`/SessionDetail?sessionId=${session.sessionId}`)}>
              <View>
                <Text style={styles.activityTitle}>{session.title}</Text>
                <Text style={styles.activityMeta}>
                  {new Date(session.completedAt).toLocaleDateString('en-AU')} · {session.sport ?? 'other'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal transparent visible={pbTarget !== null} animationType="none" onRequestClose={closePbSheet}>
        <KeyboardAvoidingView style={styles.keyboardRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheetModalInner}>
            <Pressable style={styles.sheetBackdrop} onPress={closePbSheet} />
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
              <View style={styles.sheetHandle} />
              <Pressable style={styles.sheetClose} onPress={closePbSheet} hitSlop={8}>
                <Ionicons name="close" size={16} color={theme.primary} />
              </Pressable>
              <Text style={styles.sheetTitle}>{sheetTitle}</Text>

              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
                {pbTarget?.mode === 'new_custom' ? (
                  <>
                    <Text style={styles.fieldLabel}>SPORT</Text>
                    <View style={styles.pillRow}>
                      {SHEET_SPORTS.map(({ key, label }) => {
                        const active = newCustomSport === key;
                        return (
                          <Pressable
                            key={key}
                            onPress={() => setNewCustomSport(key)}
                            style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}>
                            <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextIdle]}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.fieldLabel}>DISTANCE</Text>
                    <View style={styles.distanceInlineRow}>
                      <TextInput
                        value={newCustomDistance}
                        onChangeText={setNewCustomDistance}
                        keyboardType="decimal-pad"
                        placeholder="e.g. 15"
                        placeholderTextColor={withAlpha(theme.primary, 0.35)}
                        style={[styles.sheetInput, styles.distanceInput]}
                      />
                      <View style={styles.unitRow}>
                        {(['km', 'm'] as const).map((u) => {
                          const active = newCustomUnit === u;
                          return (
                            <Pressable
                              key={u}
                              onPress={() => setNewCustomUnit(u)}
                              style={[styles.unitChip, active ? styles.unitChipOn : styles.unitChipOff]}>
                              <Text style={[styles.unitChipText, active ? styles.unitChipTextOn : styles.unitChipTextOff]}>{u}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </>
                ) : null}

                {pbTarget && pbTarget.mode !== 'new_custom' ? (
                  <>
                    <Text style={styles.fieldLabel}>FROM SESSIONS</Text>
                    <Text style={styles.previewBody}>
                      {previewWinner
                        ? `Best logged time: ${formatMinutesAsMmSs(previewWinner.actual_duration_mins)}`
                        : 'No qualifying completed sessions yet for this distance.'}
                    </Text>
                    <Pressable
                      style={[styles.primaryBtn, !previewWinner || saveAction !== null ? styles.primaryBtnDisabled : null]}
                      disabled={!previewWinner || saveAction !== null}
                      onPress={() => void handleUseBestFromSessions()}>
                      {saveAction === 'from_sessions' ? (
                        <ActivityIndicator size="small" color={theme.onPrimary} />
                      ) : (
                        <Text style={styles.primaryBtnText}>Use best from sessions</Text>
                      )}
                    </Pressable>
                  </>
                ) : null}

                <Text style={styles.fieldLabel}>{pbTarget?.mode === 'new_custom' ? 'TIME (MM:SS)' : 'ENTER MANUALLY (MM:SS)'}</Text>
                <TextInput
                  value={manualTimeDraft}
                  onChangeText={setManualTimeDraft}
                  placeholder="e.g. 42:15"
                  placeholderTextColor={withAlpha(theme.primary, 0.35)}
                  style={styles.sheetInput}
                />

                <Text style={styles.fieldLabel}>ACHIEVED DATE</Text>
                <Pressable style={styles.dateRow} onPress={openAchievedDatePicker}>
                  <Text style={styles.dateRowText}>
                    {new Date(`${achievedDateIso}T12:00:00`).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color={theme.primary} />
                </Pressable>
                {iosDatePickerOpen && Platform.OS === 'ios' ? (
                  <View style={styles.datePickerInlineWrap}>
                    <DateTimePicker
                      {...datePickerMondayWeekProps()}
                      value={new Date(`${achievedDateIso}T12:00:00`)}
                      mode="date"
                      display="inline"
                      onChange={(_e, selected) => {
                        if (!selected) return;
                        setAchievedDateIso(toIsoDate(selected));
                      }}
                    />
                    <Pressable style={styles.iosPickerDoneInline} onPress={() => setIosDatePickerOpen(false)}>
                      <Text style={styles.iosPickerDoneText}>Done</Text>
                    </Pressable>
                  </View>
                ) : null}

                {pbTarget?.mode === 'new_custom' ? (
                  <Pressable
                    style={[styles.primaryBtn, !canSaveNewCustom || saveAction !== null ? styles.primaryBtnDisabled : null]}
                    disabled={!canSaveNewCustom || saveAction !== null}
                    onPress={() => void handleSaveNewCustom()}>
                    {saveAction === 'new_custom' ? (
                      <ActivityIndicator size="small" color={theme.onPrimary} />
                    ) : (
                      <Text style={styles.primaryBtnText}>Save milestone</Text>
                    )}
                  </Pressable>
                ) : (
                  <Pressable
                    style={[styles.primaryBtn, !canSaveManual || saveAction !== null ? styles.primaryBtnDisabled : null]}
                    disabled={!canSaveManual || saveAction !== null}
                    onPress={() => void handleSaveManual()}>
                    {saveAction === 'manual' ? (
                      <ActivityIndicator size="small" color={theme.onPrimary} />
                    ) : (
                      <Text style={styles.primaryBtnText}>Save manual PB</Text>
                    )}
                  </Pressable>
                )}
                <Pressable onPress={closePbSheet} hitSlop={12}>
                  <Text style={styles.cancelLink}>Cancel</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <FloatingPillNav active="progress" />
    </SafeAreaView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.base },
    content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 140, gap: 14 },
    segmentWrap: {
      marginTop: -2,
      flexDirection: 'row',
      padding: 2,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      backgroundColor: theme.base,
    },
    segmentChip: { flex: 1, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    segmentChipActive: { backgroundColor: theme.surface },
    segmentText: { fontFamily: 'DMSans-Medium', fontSize: 13, color: theme.textMuted },
    segmentTextActive: { color: theme.text },
    card: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      borderRadius: 14,
      padding: 14,
      gap: 8,
    },
    levelProgressSection: {
      paddingHorizontal: 2,
      paddingTop: 2,
      gap: 0,
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
      color: theme.primary,
    },
    levelAmberDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.accent,
    },
    levelNext: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: withAlpha(theme.primary, 0.4),
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
      backgroundColor: withAlpha(theme.primary, 0.1),
      position: 'relative',
      marginBottom: 8,
    },
    levelBarFill: {
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.accent,
    },
    levelMarker: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.primary,
      position: 'absolute',
      marginLeft: -4,
      top: -2,
    },
    sectionTitle: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 24, color: theme.primary },
    rowSpread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    metricTitle: { fontFamily: 'DMSans-Medium', fontSize: 13, color: theme.text },
    metricValue: { fontFamily: 'DMSans-Bold', fontSize: 13, color: theme.primary },
    weekDotsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 4 },
    weekDot: { width: 12, height: 12, borderRadius: 6 },
    weekDotDone: { backgroundColor: theme.accent },
    weekDotPlanned: { backgroundColor: theme.primary },
    weekDotEmpty: { backgroundColor: withAlpha(theme.primary, 0.2) },
    blockValue: { fontFamily: 'DMSans-Bold', fontSize: 22, color: theme.primary },
    blockCaption: { fontFamily: 'DMSans-Regular', fontSize: 12, color: theme.textMuted },
    breakdownStack: { gap: 6, marginTop: 4 },
    breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    breakdownLabel: { width: 40, fontFamily: 'DMSans-Medium', fontSize: 12, color: theme.textMuted, textTransform: 'capitalize' },
    breakdownTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: withAlpha(theme.primary, 0.12), overflow: 'hidden' },
    breakdownFill: { height: '100%', borderRadius: 999, backgroundColor: theme.accent },
    breakdownPct: { width: 36, textAlign: 'right', fontFamily: 'DMSans-Medium', fontSize: 12, color: theme.textMuted },
    avgRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
    avgText: { fontFamily: 'DMSans-Medium', fontSize: 12, color: theme.textMuted },
    levelHint: { textAlign: 'right', fontFamily: 'DMSans-Regular', fontSize: 11, color: withAlpha(theme.primary, 0.4) },
    pbRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 8,
      gap: 10,
    },
    pbLeft: { flex: 1, gap: 2 },
    pbRight: { alignItems: 'flex-end', gap: 4 },
    pbLabel: { fontFamily: 'DMSans-Medium', fontSize: 13, color: theme.text },
    pbDate: { fontFamily: 'DMSans-Regular', fontSize: 11, color: theme.textMuted },
    pbValue: { fontFamily: 'DMSans-Medium', fontSize: 14, color: theme.primary },
    pbBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: withAlpha(theme.accent, 0.15),
      borderWidth: 1,
      borderColor: withAlpha(theme.accent, 0.35),
    },
    pbBadgeText: { fontFamily: 'DMSans-SemiBold', fontSize: 9, color: theme.primary, letterSpacing: 0.4 },
    addCustomPb: { paddingVertical: 10, alignItems: 'center' },
    addCustomPbText: { fontFamily: 'DMSans-Medium', fontSize: 13, color: theme.accent },
    activityRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: withAlpha(theme.primary, 0.08),
    },
    activityTitle: { fontFamily: 'DMSans-Medium', fontSize: 13, color: theme.text },
    activityMeta: { fontFamily: 'DMSans-Regular', fontSize: 12, color: theme.textMuted, marginTop: 2 },
    keyboardRoot: { flex: 1 },
    sheetModalInner: { flex: 1, justifyContent: 'flex-end' },
    sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
    sheet: {
      backgroundColor: theme.base,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 22,
      paddingTop: 8,
      maxHeight: '92%',
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 42,
      height: 5,
      borderRadius: 999,
      backgroundColor: withAlpha(theme.primary, 0.2),
      marginBottom: 14,
    },
    sheetClose: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    sheetTitle: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 24, color: theme.primary, marginBottom: 10 },
    sheetScroll: { gap: 12, paddingBottom: 12 },
    fieldLabel: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 10,
      letterSpacing: 0.6,
      color: theme.accent,
      textTransform: 'uppercase',
    },
    previewBody: { fontFamily: 'DMSans-Regular', fontSize: 13, color: theme.text },
    sheetInput: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.15),
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontFamily: 'DMSans-Regular',
      fontSize: 14,
      color: theme.primary,
    },
    primaryBtn: {
      marginTop: 4,
      borderRadius: 999,
      backgroundColor: theme.primary,
      paddingVertical: 14,
      alignItems: 'center',
    },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { fontFamily: 'DMSans-Medium', fontSize: 15, color: theme.onPrimary },
    cancelLink: {
      textAlign: 'center',
      fontFamily: 'DMSans-Medium',
      fontSize: 14,
      color: withAlpha(theme.primary, 0.4),
      marginTop: 8,
      marginBottom: 4,
    },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    pillIdle: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.primary },
    pillActive: { backgroundColor: theme.primary, borderWidth: 1, borderColor: theme.primary },
    pillText: { fontFamily: 'DMSans-Medium', fontSize: 12 },
    pillTextIdle: { color: theme.primary },
    pillTextActive: { color: theme.onPrimary },
    distanceInlineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    distanceInput: { flex: 1 },
    unitRow: { flexDirection: 'row', gap: 8, flexShrink: 0 },
    unitChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, minWidth: 46, alignItems: 'center' },
    unitChipOn: { backgroundColor: theme.primary },
    unitChipOff: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.primary },
    unitChipText: { fontFamily: 'DMSans-Medium', fontSize: 12 },
    unitChipTextOn: { color: theme.onPrimary },
    unitChipTextOff: { color: theme.primary },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.15),
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    dateRowText: { fontFamily: 'DMSans-Medium', fontSize: 14, color: theme.primary },
    datePickerInlineWrap: {
      marginTop: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      backgroundColor: theme.surface,
      padding: 8,
    },
    iosPickerDoneInline: {
      alignSelf: 'stretch',
      marginTop: 8,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: theme.primary,
      alignItems: 'center',
    },
    iosPickerRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
    iosPickerCard: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      padding: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
    },
    iosPickerDone: {
      alignSelf: 'stretch',
      marginTop: 10,
      paddingVertical: 12,
      borderRadius: 999,
      backgroundColor: theme.primary,
      alignItems: 'center',
    },
    iosPickerDoneText: { fontFamily: 'DMSans-Medium', fontSize: 14, color: theme.onPrimary },
  });
