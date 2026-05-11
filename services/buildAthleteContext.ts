import { supabase } from '@/lib/supabase';
import { daysUntilIsoDate, toIsoDateLocal } from '@/services/racePriority';
import type { AthleteContext } from '@/services/rovaTemplates';

type SessionWithLogs = {
  scheduled_date: string;
  sport: string | null;
  status: string | null;
  duration_mins: number | null;
  session_logs?:
    | {
        completed_at: string | null;
        actual_duration_mins: number | null;
        rpe: number | null;
      }
    | {
        completed_at: string | null;
        actual_duration_mins: number | null;
        rpe: number | null;
      }[]
    | null;
};

type SessionLogWithSport = {
  completed_at: string;
  actual_duration_mins: number | null;
  rpe: number | null;
  sessions?: { sport: string | null } | null;
};

function isMissingTableError(message: string) {
  const m = message.toLowerCase();
  return m.includes('schema cache') || m.includes('does not exist') || m.includes('could not find the table');
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysIso(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day);
  return new Date(utcMs + days * 86_400_000).toISOString().slice(0, 10);
}

function weekStartMonday(anchor: Date) {
  const day = anchor.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function isCompleted(status: string | null, logsCount: number) {
  if (status === 'completed') return true;
  if (status === 'skipped') return false;
  return logsCount > 0;
}

async function safeRead<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (__DEV__) {
      console.warn(`[Rova] ${label} unavailable`, error);
    }
    return fallback;
  }
}

function computeCurrentStreak(completedDateSet: Set<string>) {
  let streak = 0;
  let cursor = toIsoDateLocal(new Date());
  for (;;) {
    if (!completedDateSet.has(cursor)) break;
    streak += 1;
    cursor = addDaysIso(cursor, -1);
  }
  return streak;
}

async function fetchAthlete(athleteId: string) {
  const { data, error } = await supabase
    .from('athletes')
    .select('id, name, level, goal_race_name, goal_race_date')
    .eq('id', athleteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function fetchRaceInfo(athleteId: string) {
  const todayIso = toIsoDateLocal(new Date());
  const { data, error } = await supabase
    .from('race_goals')
    .select('title, event_date')
    .eq('athlete_id', athleteId)
    .gte('event_date', todayIso)
    .order('event_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(error.message);
  }
  return data;
}

async function fetchThisWeekSessions(athleteId: string) {
  const startIso = toIsoDate(weekStartMonday(new Date()));
  const endIso = addDaysIso(startIso, 6);
  const { data, error } = await supabase
    .from('sessions')
    .select('scheduled_date, sport, status, duration_mins, session_logs(completed_at, actual_duration_mins, rpe)')
    .eq('athlete_id', athleteId)
    .gte('scheduled_date', startIso)
    .lte('scheduled_date', endIso)
    .order('scheduled_date', { ascending: true });
  if (error) {
    if (isMissingTableError(error.message)) return [] as SessionWithLogs[];
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as SessionWithLogs[];
}

async function fetchLast7DaysSessions(athleteId: string) {
  const todayIso = toIsoDateLocal(new Date());
  const startIso = addDaysIso(todayIso, -6);
  const { data, error } = await supabase
    .from('sessions')
    .select('scheduled_date, sport, status, duration_mins, session_logs(completed_at, actual_duration_mins, rpe)')
    .eq('athlete_id', athleteId)
    .gte('scheduled_date', startIso)
    .lte('scheduled_date', todayIso)
    .order('scheduled_date', { ascending: true });
  if (error) {
    if (isMissingTableError(error.message)) return [] as SessionWithLogs[];
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as SessionWithLogs[];
}

async function fetchLast30SessionLogs(athleteId: string) {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fromIso = toIsoDate(from);
  const { data, error } = await supabase
    .from('session_logs')
    .select('completed_at, actual_duration_mins, rpe, sessions(sport)')
    .eq('athlete_id', athleteId)
    .gte('completed_at', `${fromIso}T00:00:00.000Z`)
    .order('completed_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error.message)) return [] as SessionLogWithSport[];
    throw new Error(error.message);
  }
  return (data ?? []) as SessionLogWithSport[];
}

export async function buildAthleteContext(athleteId: string): Promise<AthleteContext> {
  const fallback: AthleteContext = {
    athleteName: 'athlete',
    athleteLevel: 'fara',
    goalRaceName: null,
    goalRaceDate: null,
    daysUntilRace: null,
    thisWeekPlanned: 0,
    thisWeekCompleted: 0,
    completionRate: 0,
    last7Days: [],
    last30DaysSportBreakdown: {},
    currentStreakDays: 0,
    longestSessionMins: 0,
    avgRpeLast14d: null,
  };

  const athlete = await safeRead('athlete profile', () => fetchAthlete(athleteId), null);
  const race = await safeRead('race info', () => fetchRaceInfo(athleteId), null);
  const weekSessions = await safeRead('this week sessions', () => fetchThisWeekSessions(athleteId), [] as SessionWithLogs[]);
  const last7Sessions = await safeRead('last 7 sessions', () => fetchLast7DaysSessions(athleteId), [] as SessionWithLogs[]);
  const last30Logs = await safeRead('last 30 session logs', () => fetchLast30SessionLogs(athleteId), [] as SessionLogWithSport[]);

  const logCount = (logs: SessionWithLogs['session_logs']) => (Array.isArray(logs) ? logs.length : logs ? 1 : 0);
  const firstLog = (logs: SessionWithLogs['session_logs']) => (Array.isArray(logs) ? logs[0] ?? null : logs ?? null);

  const nonRestWeek = weekSessions.filter((s) => (s.sport ?? '').toLowerCase() !== 'rest');
  const thisWeekPlanned = nonRestWeek.length;
  const thisWeekCompleted = nonRestWeek.filter((s) => isCompleted(s.status, logCount(s.session_logs))).length;
  const completionRate = thisWeekPlanned > 0 ? Math.round((thisWeekCompleted / thisWeekPlanned) * 100) : 0;

  const last7Days = last7Sessions.map((s) => {
    const first = firstLog(s.session_logs);
    return {
      date: s.scheduled_date,
      sport: (s.sport ?? 'other').toLowerCase(),
      status: isCompleted(s.status, logCount(s.session_logs)) ? 'completed' : (s.status ?? 'planned'),
      durationMins: first?.actual_duration_mins ?? s.duration_mins ?? null,
      rpe: first?.rpe ?? null,
    };
  });

  const last30DaysSportBreakdown: Record<string, number> = {};
  for (const log of last30Logs) {
    const sport = (log.sessions?.sport ?? 'other').toLowerCase();
    last30DaysSportBreakdown[sport] = (last30DaysSportBreakdown[sport] ?? 0) + 1;
  }

  const completedDateSet = new Set(
    last30Logs
      .map((l) => l.completed_at?.slice(0, 10))
      .filter((d): d is string => typeof d === 'string' && d.length === 10)
  );
  const currentStreakDays = computeCurrentStreak(completedDateSet);

  const longestSessionMins = Math.max(
    0,
    ...last30Logs.map((l) => (l.actual_duration_mins != null && Number.isFinite(l.actual_duration_mins) ? l.actual_duration_mins : 0))
  );

  const todayIso = toIsoDateLocal(new Date());
  const rpeWindowStart = addDaysIso(todayIso, -13);
  const rpes = last30Logs
    .filter((l) => l.completed_at?.slice(0, 10) >= rpeWindowStart)
    .map((l) => l.rpe)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const avgRpeLast14d = rpes.length > 0 ? round1(rpes.reduce((sum, rpe) => sum + rpe, 0) / rpes.length) : null;

  const goalRaceName = race?.title ?? athlete?.goal_race_name ?? fallback.goalRaceName;
  const goalRaceDate = race?.event_date ?? athlete?.goal_race_date ?? fallback.goalRaceDate;
  const daysUntilRace = goalRaceDate ? daysUntilIsoDate(goalRaceDate, toIsoDateLocal(new Date())) : null;

  return {
    athleteName: athlete?.name ?? fallback.athleteName,
    athleteLevel: athlete?.level ?? fallback.athleteLevel,
    goalRaceName: goalRaceName ?? fallback.goalRaceName,
    goalRaceDate: goalRaceDate ?? fallback.goalRaceDate,
    daysUntilRace: daysUntilRace ?? fallback.daysUntilRace,
    thisWeekPlanned,
    thisWeekCompleted,
    completionRate,
    last7Days,
    last30DaysSportBreakdown,
    currentStreakDays,
    longestSessionMins,
    avgRpeLast14d,
  };
}
