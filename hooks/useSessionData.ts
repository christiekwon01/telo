import { useEffect, useMemo, useRef } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { readAthleteId } from '@/lib/athlete-session';
import { localCalendarRangeToUtcIsoBounds, toLocalIsoDate } from '@/lib/dates';
import { ensureAthleteRowExists } from '@/lib/supabase-auth';
import { supabase } from '@/lib/supabase';
import {
  fetchSessionLogsForPersonalBests,
  migrateLegacyPersonalBestsIfNeeded,
  pickCelebrationImprovement,
  syncPersonalBestsAfterSessionLogsChange,
} from '@/services/personalBests';
import { usePersonalBestCelebrationStore } from '@/store/personal-best-celebration-store';
import type { Database, Json } from '@/types/supabase';
import {
  getAppleCalendarPrefs,
  removeCompletedFromCalendar,
  syncAppleCalendarIfEnabled,
} from '@/services/appleCalendarSync';

type SessionRow = Database['public']['Tables']['sessions']['Row'];
type SessionLogRow = Database['public']['Tables']['session_logs']['Row'];
type SessionBlockRow = Database['public']['Tables']['session_blocks']['Row'];
type SessionStepRow = Database['public']['Tables']['session_steps']['Row'];
type AthleteRow = Database['public']['Tables']['athletes']['Row'];
type PlanRow = Database['public']['Tables']['plans']['Row'];
type RaceGoalRow = Database['public']['Tables']['race_goals']['Row'];
type PersonalBestRow = Database['public']['Tables']['personal_bests']['Row'];

export type SportType = 'swim' | 'bike' | 'run' | 'brick' | 'gym' | 'rest';
export type SessionStatus = 'planned' | 'completed' | 'skipped';
export type AthleteLevelTier = 'fara' | 'orka' | 'vinna';

export type SessionWithCompletion = SessionRow & {
  completionStatus: SessionStatus;
  session_logs?: Pick<SessionLogRow, 'id' | 'completed_at'>[] | null;
};

export type SessionDetailData = SessionRow & {
  completionStatus: SessionStatus;
  session_logs: SessionLogRow[];
  session_blocks: (SessionBlockRow & { session_steps: SessionStepRow[] })[];
};

export type CompleteSessionPayload = {
  sessionId: string;
  athleteId: string;
  /** Session scheduled day; used to invalidate the correct today/week/month caches. */
  scheduledDateIso: string;
  notes?: string;
  mediaUris?: string[];
  actualDurationMins?: number;
  actualDistance?: number;
  avgHeartRate?: number;
  rpe?: number | null;
};

const SPORT_ORDER: SportType[] = ['swim', 'bike', 'run', 'gym', 'brick', 'rest'];

function toIsoDate(value: Date) {
  return toLocalIsoDate(value);
}

async function resolveAthleteIdForQueries(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user?.id) return session.user.id;
  return readAthleteId();
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function parseIsoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Week starts Monday (same as completion invalidation / plan views). */
function weekStartMondayForDate(day: Date): Date {
  return startOfDay(addDays(day, day.getDay() === 0 ? -6 : 1 - day.getDay()));
}

function normalizeSport(value: string): SportType {
  return SPORT_ORDER.includes(value as SportType) ? (value as SportType) : 'rest';
}

export function normalizeCompletionStatus(
  status: string | null,
  logs?: Pick<SessionLogRow, 'id' | 'completed_at'> | Pick<SessionLogRow, 'id' | 'completed_at'>[] | null
): SessionStatus {
  if (status === 'completed' || status === 'skipped') return status;
  const logCount = Array.isArray(logs) ? logs.length : logs ? 1 : 0;
  if (logCount > 0) return 'completed';
  return 'planned';
}

function sortBySportThenDate<T extends { sport: string; scheduled_date: string }>(sessions: T[]) {
  return [...sessions].sort((a, b) => {
    const sportDelta = SPORT_ORDER.indexOf(normalizeSport(a.sport)) - SPORT_ORDER.indexOf(normalizeSport(b.sport));
    if (sportDelta !== 0) return sportDelta;
    return a.scheduled_date.localeCompare(b.scheduled_date);
  });
}

export const sessionQueryKeys = {
  all: ['sessions'] as const,
  today: (iso: string) => [...sessionQueryKeys.all, 'today', iso] as const,
  upcoming: (fromIso: string, limit: number) => [...sessionQueryKeys.all, 'upcoming', fromIso, limit] as const,
  week: (startIso: string) => [...sessionQueryKeys.all, 'week', startIso] as const,
  month: (year: number, month: number) => [...sessionQueryKeys.all, 'month', `${year}-${month}`] as const,
  detail: (sessionId: string) => [...sessionQueryKeys.all, 'detail', sessionId] as const,
  activeAthlete: () => ['athlete', 'active'] as const,
  activePlan: (athleteId: string | null) => ['plan', 'active', athleteId ?? 'none'] as const,
  completedLogs: (athleteKey: string, fromIso: string, toIso: string, trainingType: string) =>
    ['session_logs', 'range', athleteKey, fromIso, toIso, trainingType] as const,
  raceGoals: (athleteId: string | null) => ['race_goals', athleteId ?? 'none'] as const,
  personalBests: (athleteId: string | null) => ['personal_bests', athleteId ?? 'none'] as const,
};

export async function invalidateSessionRelatedQueries(
  queryClient: QueryClient,
  opts: {
    sessionId: string;
    athleteId?: string | null;
    /** YYYY-MM-DD — session's scheduled_date; drives today/week/month keys. */
    scheduledDateIso: string;
  }
) {
  const cal = parseIsoToLocalDate(opts.scheduledDateIso);
  const weekStart = weekStartMondayForDate(cal);
  const monthYear = cal.getFullYear();
  const monthIndex = cal.getMonth();

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: sessionQueryKeys.today(opts.scheduledDateIso) }),
    queryClient.invalidateQueries({ queryKey: sessionQueryKeys.week(toIsoDate(weekStart)) }),
    queryClient.invalidateQueries({ queryKey: sessionQueryKeys.month(monthYear, monthIndex) }),
    queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(opts.sessionId) }),
    queryClient.invalidateQueries({ queryKey: ['session_logs'] }),
    queryClient.invalidateQueries({ queryKey: ['rova_challenges'] }),
  ]);

  if (opts.athleteId) {
    await queryClient.invalidateQueries({ queryKey: ['session_logs', 'count', opts.athleteId] });
    await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.personalBests(opts.athleteId) });
    await queryClient.invalidateQueries({ queryKey: ['personal_bests', 'session_logs', opts.athleteId] });
  }
}

export function useActiveAthlete() {
  return useQuery({
    queryKey: sessionQueryKeys.activeAthlete(),
    queryFn: async () => {
      await supabase.auth.getSession();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;

      if (uid) {
        const { data, error } = await supabase.from('athletes').select('*').eq('id', uid).maybeSingle();
        if (error) throw new Error(error.message);
        if (data) return data as AthleteRow;

        await ensureAthleteRowExists(uid);
        const { data: bootstrapped, error: bootstrapError } = await supabase
          .from('athletes')
          .select('*')
          .eq('id', uid)
          .maybeSingle();
        if (bootstrapError) throw new Error(bootstrapError.message);
        if (bootstrapped) return bootstrapped as AthleteRow;

        // Authenticated session but no row — never fall through to legacy stored/first-athlete ids.
        return null;
      }

      const storedId = await readAthleteId();
      if (storedId) {
        const { data, error } = await supabase.from('athletes').select('*').eq('id', storedId).maybeSingle();
        if (error) throw new Error(error.message);
        if (data) return data as AthleteRow;
      }

      const { data: legacy, error: legacyError } = await supabase
        .from('athletes')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (legacyError) throw new Error(legacyError.message);
      return (legacy ?? null) as AthleteRow | null;
    },
  });
}

export function useActivePlan(athleteId: string | null | undefined) {
  return useQuery({
    queryKey: sessionQueryKeys.activePlan(athleteId ?? null),
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return null;
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('status', 'active')
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as PlanRow | null;
    },
  });
}

export function useRaceGoals(athleteId: string | null | undefined) {
  return useQuery({
    queryKey: sessionQueryKeys.raceGoals(athleteId ?? null),
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return [] as RaceGoalRow[];
      const { data, error } = await supabase
        .from('race_goals')
        .select('*')
        .eq('athlete_id', athleteId)
        .order('event_date', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as RaceGoalRow[];
    },
  });
}

export function usePersonalBests(athleteId: string | null | undefined) {
  return useQuery({
    queryKey: sessionQueryKeys.personalBests(athleteId ?? null),
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return [] as PersonalBestRow[];
      await migrateLegacyPersonalBestsIfNeeded(athleteId);
      const { data, error } = await supabase
        .from('personal_bests')
        .select('*')
        .eq('athlete_id', athleteId)
        .order('sport')
        .order('distance');
      if (error) throw new Error(error.message);
      return (data ?? []) as PersonalBestRow[];
    },
  });
}

export function usePersonalBestSessionLogs(athleteId: string | null | undefined) {
  return useQuery({
    queryKey: ['personal_bests', 'session_logs', athleteId ?? 'none'] as const,
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return [];
      return fetchSessionLogsForPersonalBests(athleteId);
    },
  });
}

export function useCompletedSessionLogs({
  athleteId,
  fromIso,
  toIso,
  trainingType,
}: {
  athleteId: string | null | undefined;
  fromIso: string;
  toIso: string;
  trainingType: 'overall' | 'swim' | 'bike' | 'run';
}) {
  const athleteKey = athleteId ?? 'none';
  const { gte, lte } = localCalendarRangeToUtcIsoBounds(fromIso, toIso);

  return useQuery({
    queryKey: sessionQueryKeys.completedLogs(athleteKey, fromIso, toIso, trainingType),
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return [];
      const query = supabase
        .from('session_logs')
        .select(
          'id,session_id,athlete_id,completed_at,actual_duration_mins,actual_distance,avg_heart_rate,rpe,notes,media_uris,sessions!inner(id,title,sport,duration_mins,distance,distance_unit,scheduled_date)'
        )
        .eq('athlete_id', athleteId)
        .gte('completed_at', gte)
        .lte('completed_at', lte)
        .order('completed_at', { ascending: false });

      const filtered = trainingType === 'overall' ? query : query.eq('sessions.sport', trainingType);
      const { data, error } = await filtered;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useCompletedSessionCount(athleteId: string | null | undefined) {
  return useQuery({
    queryKey: ['session_logs', 'count', athleteId ?? 'none'] as const,
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return 0;
      const { count, error } = await supabase
        .from('session_logs')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

const FARA_TO_ORKA_SESSIONS = 50;
const ORKA_TO_VINNA_SESSIONS = 100;

function normalizeAthleteLevel(level: string | null | undefined): AthleteLevelTier {
  const normalized = (level ?? 'fara').toLowerCase();
  if (normalized === 'orka' || normalized === 'vinna') return normalized;
  return 'fara';
}

function nextAthleteLevel(level: AthleteLevelTier): AthleteLevelTier {
  if (level === 'fara') return 'orka';
  if (level === 'orka') return 'vinna';
  return 'vinna';
}

function sessionsNeededForCurrentTier(level: AthleteLevelTier): number {
  if (level === 'fara') return FARA_TO_ORKA_SESSIONS;
  if (level === 'orka') return ORKA_TO_VINNA_SESSIONS;
  return 0;
}

function sessionsCompletedWithinTier(level: AthleteLevelTier, completedCount: number): number {
  if (level === 'fara') return Math.max(0, Math.min(FARA_TO_ORKA_SESSIONS, completedCount));
  if (level === 'orka') return Math.max(0, Math.min(ORKA_TO_VINNA_SESSIONS, completedCount - FARA_TO_ORKA_SESSIONS));
  return 0;
}

function thresholdForNextLevel(level: AthleteLevelTier): number {
  if (level === 'fara') return FARA_TO_ORKA_SESSIONS;
  if (level === 'orka') return FARA_TO_ORKA_SESSIONS + ORKA_TO_VINNA_SESSIONS;
  return Number.MAX_SAFE_INTEGER;
}

function isMondayLocal(date: Date) {
  return date.getDay() === 1;
}

export function getLevelProgress(completedCount: number, currentLevelRaw: string | null | undefined) {
  const currentLevel = normalizeAthleteLevel(currentLevelRaw);
  if (currentLevel === 'vinna') {
    return {
      currentLevel,
      nextLevel: 'vinna' as const,
      percent: 100,
      remaining: 0,
      completedTowardNext: ORKA_TO_VINNA_SESSIONS,
      neededForNext: ORKA_TO_VINNA_SESSIONS,
      atPeakTier: true,
    };
  }

  const neededForNext = sessionsNeededForCurrentTier(currentLevel);
  const completedTowardNext = sessionsCompletedWithinTier(currentLevel, completedCount);
  const remaining = Math.max(0, neededForNext - completedTowardNext);

  return {
    currentLevel,
    nextLevel: nextAthleteLevel(currentLevel),
    percent: neededForNext > 0 ? Math.min(100, (completedTowardNext / neededForNext) * 100) : 100,
    remaining,
    completedTowardNext,
    neededForNext,
    atPeakTier: false,
  };
}

export function useLevelProgress(
  athleteId: string | null | undefined,
  currentLevelRaw: string | null | undefined
) {
  const queryClient = useQueryClient();
  const { data: completedCount = 0, ...rest } = useCompletedSessionCount(athleteId);
  const level = normalizeAthleteLevel(currentLevelRaw);
  const isAutoPromotingRef = useRef(false);

  useEffect(() => {
    if (!athleteId || level === 'vinna') return;
    if (!isMondayLocal(new Date())) return;
    if (isAutoPromotingRef.current) return;

    const nextThreshold = thresholdForNextLevel(level);
    if (completedCount < nextThreshold) return;

    isAutoPromotingRef.current = true;
    const promote = async () => {
      const { error } = await supabase
        .from('athletes')
        .update({ level: nextAthleteLevel(level) })
        .eq('id', athleteId);

      if (error) {
        if (__DEV__) {
          console.warn('[level_progress] auto-promotion failed', error.message);
        }
      } else {
        await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() });
      }
      isAutoPromotingRef.current = false;
    };
    void promote();
  }, [athleteId, completedCount, level, queryClient]);

  return {
    completedCount,
    ...getLevelProgress(completedCount, level),
    ...rest,
  };
}

async function fetchTodaysSessions(todayIso: string, athleteId: string): Promise<SessionWithCompletion[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, session_logs(id, completed_at)')
    .eq('scheduled_date', todayIso)
    .eq('athlete_id', athleteId);

  if (error) throw new Error(error.message);

  const rows = sortBySportThenDate((data ?? []) as unknown as SessionWithCompletion[]).map((session) => ({
    ...session,
    sport: normalizeSport(session.sport),
    completionStatus: normalizeCompletionStatus(session.status, session.session_logs),
  }));

  return rows;
}

export function useTodaysSessions() {
  const queryClient = useQueryClient();
  const todayIso = toIsoDate(new Date());
  const realtimeChannelName = useMemo(() => `today-sessions-${todayIso}`, [todayIso]);

  useEffect(() => {
    const channel = supabase
      .channel(realtimeChannelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => {
        void queryClient.invalidateQueries({ queryKey: sessionQueryKeys.today(todayIso) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_logs' }, () => {
        void queryClient.invalidateQueries({ queryKey: sessionQueryKeys.today(todayIso) });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, todayIso, realtimeChannelName]);

  return useQuery({
    queryKey: sessionQueryKeys.today(todayIso),
    queryFn: async () => {
      const athleteId = await resolveAthleteIdForQueries();
      if (!athleteId) return [];
      return fetchTodaysSessions(todayIso, athleteId);
    },
  });
}

export function useUpcomingSessions(limit = 30) {
  const fromDate = startOfDay(new Date());
  const fromIso = toIsoDate(fromDate);
  const safeLimit = Math.max(1, limit);

  return useQuery({
    queryKey: sessionQueryKeys.upcoming(fromIso, safeLimit),
    queryFn: async () => {
      const athleteId = await resolveAthleteIdForQueries();
      if (!athleteId) return [];
      const { data, error } = await supabase
        .from('sessions')
        .select('*, session_logs(id, completed_at)')
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', fromIso)
        .order('scheduled_date', { ascending: true })
        .limit(safeLimit);

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as SessionWithCompletion[];
      return rows
        .map((session) => ({
          ...session,
          sport: normalizeSport(session.sport),
          completionStatus: normalizeCompletionStatus(session.status, session.session_logs),
        }))
        .sort((a, b) => {
          const dateDelta = a.scheduled_date.localeCompare(b.scheduled_date);
          if (dateDelta !== 0) return dateDelta;
          return SPORT_ORDER.indexOf(normalizeSport(a.sport)) - SPORT_ORDER.indexOf(normalizeSport(b.sport));
        });
    },
  });
}

export function useWeekSessions(weekStart: Date) {
  const weekStartDate = startOfDay(weekStart);
  const fromIso = toIsoDate(weekStartDate);
  const toIso = toIsoDate(addDays(weekStartDate, 6));

  return useQuery({
    queryKey: sessionQueryKeys.week(fromIso),
    queryFn: async () => {
      const athleteId = await resolveAthleteIdForQueries();
      const grouped: Record<string, SessionWithCompletion[]> = {};
      for (let i = 0; i < 7; i += 1) {
        grouped[toIsoDate(addDays(weekStartDate, i))] = [];
      }
      if (!athleteId) return grouped;

      const { data, error } = await supabase
        .from('sessions')
        .select('*, session_logs(id, completed_at)')
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', fromIso)
        .lte('scheduled_date', toIso)
        .order('scheduled_date', { ascending: true });

      if (error) throw new Error(error.message);

      for (const row of sortBySportThenDate((data ?? []) as unknown as SessionWithCompletion[])) {
        const scheduled = row.scheduled_date;
        if (!grouped[scheduled]) grouped[scheduled] = [];
        grouped[scheduled].push({
          ...row,
          sport: normalizeSport(row.sport),
          completionStatus: normalizeCompletionStatus(row.status, row.session_logs),
        });
      }

      return grouped;
    },
  });
}

export function useMonthSessions(year: number, month: number) {
  const fromDate = new Date(year, month, 1);
  const toDate = new Date(year, month + 1, 0);
  const fromIso = toIsoDate(fromDate);
  const toIso = toIsoDate(toDate);

  return useQuery({
    queryKey: sessionQueryKeys.month(year, month),
    queryFn: async () => {
      const athleteId = await resolveAthleteIdForQueries();
      if (!athleteId) return [];
      const { data, error } = await supabase
        .from('sessions')
        .select('*, session_logs(id, completed_at)')
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', fromIso)
        .lte('scheduled_date', toIso)
        .order('scheduled_date', { ascending: true });

      if (error) throw new Error(error.message);

      return ((data ?? []) as unknown as SessionWithCompletion[]).map((row) => ({
        ...row,
        sport: normalizeSport(row.sport),
        completionStatus: normalizeCompletionStatus(row.status, row.session_logs),
      }));
    },
  });
}

export function useSessionDetail(sessionId: string | undefined): UseQueryResult<SessionDetailData | null, Error> {
  return useQuery({
    queryKey: sessionQueryKeys.detail(sessionId ?? 'missing'),
    enabled: Boolean(sessionId),
    queryFn: async () => {
      if (!sessionId) return null;
      const { data, error } = await supabase
        .from('sessions')
        .select('*, session_blocks(*, session_steps(*)), session_logs(*)')
        .eq('id', sessionId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;

      const detail = data as unknown as SessionDetailData;
      return {
        ...detail,
        sport: normalizeSport(detail.sport),
        completionStatus: normalizeCompletionStatus(detail.status, detail.session_logs),
        session_blocks: [...(detail.session_blocks ?? [])]
          .sort((a, b) => a.order_index - b.order_index)
          .map((block) => ({
            ...block,
            session_steps: [...(block.session_steps ?? [])].sort((a, b) => a.order_index - b.order_index),
          })),
        session_logs: [...(detail.session_logs ?? [])].sort((a, b) => b.completed_at.localeCompare(a.completed_at)),
      };
    },
  });
}

export function useCompleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CompleteSessionPayload) => {
      const now = new Date().toISOString();
      const { error: insertError } = await supabase.from('session_logs').insert({
        session_id: payload.sessionId,
        athlete_id: payload.athleteId,
        completed_at: now,
        notes: payload.notes ?? null,
        media_uris: ((payload.mediaUris ?? null) as Json | null) ?? null,
        actual_duration_mins: payload.actualDurationMins ?? null,
        actual_distance: payload.actualDistance ?? null,
        avg_heart_rate: payload.avgHeartRate ?? null,
        rpe: payload.rpe ?? null,
      });

      if (insertError) throw new Error(insertError.message);

      const { error: updateError } = await supabase
        .from('sessions')
        .update({ status: 'completed', completed_at: now })
        .eq('id', payload.sessionId);

      if (updateError) throw new Error(updateError.message);

      return { completedAt: now };
    },
    onSuccess: async (_result, variables) => {
      await invalidateSessionRelatedQueries(queryClient, {
        sessionId: variables.sessionId,
        athleteId: variables.athleteId,
        scheduledDateIso: variables.scheduledDateIso,
      });
      void syncAppleCalendarIfEnabled(variables.athleteId, parseIsoToLocalDate(variables.scheduledDateIso));
      try {
        const prefs = await getAppleCalendarPrefs();
        if (prefs.enabled && prefs.removeCompleted && prefs.calendarId) {
          await removeCompletedFromCalendar(variables.sessionId, prefs.calendarId);
        }
      } catch (e) {
        if (__DEV__) {
          console.warn('[calendar] remove completed event failed', e);
        }
      }
      try {
        const improvements = await syncPersonalBestsAfterSessionLogsChange(queryClient, variables.athleteId);
        const top = pickCelebrationImprovement(improvements);
        if (top) usePersonalBestCelebrationStore.getState().show(top);
      } catch (e) {
        if (__DEV__) {
          console.warn('[personal_bests] sync after session complete failed', e);
        }
      }
    },
  });
}

export type UncompleteSessionPayload = {
  sessionId: string;
  athleteId: string;
  scheduledDateIso: string;
};

export function useUncompleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UncompleteSessionPayload) => {
      const { error: deleteError } = await supabase.from('session_logs').delete().eq('session_id', payload.sessionId);
      if (deleteError) throw new Error(deleteError.message);
      const { error: updateError } = await supabase
        .from('sessions')
        .update({ status: 'planned', completed_at: null })
        .eq('id', payload.sessionId);
      if (updateError) throw new Error(updateError.message);
    },
    onSuccess: async (_result, variables) => {
      await invalidateSessionRelatedQueries(queryClient, {
        sessionId: variables.sessionId,
        athleteId: variables.athleteId,
        scheduledDateIso: variables.scheduledDateIso,
      });
      try {
        await syncPersonalBestsAfterSessionLogsChange(queryClient, variables.athleteId);
      } catch (e) {
        if (__DEV__) {
          console.warn('[personal_bests] sync after session uncomplete failed', e);
        }
      }
    },
  });
}

export function useToggleSessionStepChecked() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, isChecked }: { stepId: string; isChecked: boolean }) => {
      const { error } = await supabase.from('session_steps').update({ is_checked: isChecked }).eq('id', stepId);
      if (error) throw new Error(error.message);
      return { stepId, isChecked };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKeys.all });
    },
  });
}
