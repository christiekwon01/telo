import { supabase } from '@/lib/supabase';
import { isAnthropicEnabled } from '@/lib/anthropic';
import { buildAthleteContext } from '@/services/buildAthleteContext';
import {
  daysUntilIsoDate,
  normalizeRacePriority,
  racePriorityLabel,
  sortRacesByPriorityThenDate,
  toIsoDateLocal,
} from '@/services/racePriority';
import type { AthleteContext } from '@/services/rovaTemplates';
import { matchTemplate } from '@/services/rovaTemplateMatcher';
import type { Database } from '@/types/supabase';

export type RovaMessageTurn = { role: 'user' | 'assistant'; message: string };

type SessionLogWithSession = {
  id: string;
  completed_at: string;
  actual_duration_mins: number | null;
  actual_distance: number | null;
  avg_heart_rate: number | null;
  rpe: number | null;
  notes: string | null;
  sessions: {
    title: string;
    sport: string;
    duration_mins: number | null;
    scheduled_date: string;
  } | null;
};

type SessionRow = Database['public']['Tables']['sessions']['Row'];
type SessionLogMini = { id: string; completed_at: string | null; actual_duration_mins: number | null };
type WeekSessionRow = Pick<SessionRow, 'id' | 'title' | 'sport' | 'scheduled_date' | 'duration_mins' | 'status'> & {
  session_logs?: SessionLogMini | SessionLogMini[] | null;
};

const SESSIONS_PER_LEVEL = 50;
const LEVEL_ORDER = ['fara', 'orka', 'vinna'] as const;

/** Local calendar date YYYY-MM-DD (same pattern as session scheduling / Log Session). */
export function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROVA_SPORTS = new Set(['run', 'swim', 'bike']);

function isMissingFlexHistoryTable(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the table 'public.flex_history'") ||
    m.includes('relation "public.flex_history" does not exist') ||
    m.includes('relation "flex_history" does not exist')
  );
}

function isMissingTableError(message: string) {
  const m = message.toLowerCase();
  return m.includes('schema cache') || m.includes('does not exist') || m.includes('could not find the table');
}

export type RovaLogSessionPayload = {
  sport: 'run' | 'swim' | 'bike';
  title: string;
  durationMins: number | null;
  distance: number | null;
  distanceUnit: 'm' | 'km' | null;
  intensity: string;
  estimatedRPE: number | null;
  notes: string | null;
  date: string;
};

export type ParsedRova =
  | { kind: 'chat'; message: string }
  | { kind: 'log_session'; message: string; sessionData: RovaLogSessionPayload; needsConfirmation: boolean };

/** Strip optional markdown fences and trim for JSON.parse. */
export function parseRovaResponse(rawText: string): ParsedRova {
  const trimmed = rawText.trim();
  let candidate = trimmed;
  const fenceOpen = /^```(?:json)?\s*\n?/i;
  const fenceClose = /\n?```\s*$/;
  if (fenceOpen.test(candidate) && fenceClose.test(candidate)) {
    candidate = candidate.replace(fenceOpen, '').replace(fenceClose, '').trim();
  }

  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return { kind: 'chat', message: trimmed || '…' };
  }

  if (!obj || typeof obj !== 'object') {
    return { kind: 'chat', message: trimmed };
  }

  const rec = obj as Record<string, unknown>;
  const messageRaw = rec.message;
  const parsedMessage = typeof messageRaw === 'string' ? messageRaw.trim() : '';
  const message = parsedMessage.length > 0 ? parsedMessage : 'I hear you. Can you share a bit more detail?';

  if (rec.action === 'log_session') {
    const sd = rec.sessionData;
    if (!sd || typeof sd !== 'object') {
      return { kind: 'chat', message };
    }
    const d = sd as Record<string, unknown>;
    const sportNorm = normalizeRovaSport(d.sport);
    const dateStr = typeof d.date === 'string' ? d.date.trim() : '';
    const date = ISO_DATE_RE.test(dateStr) ? dateStr : toIsoDate(new Date());

    if (!sportNorm) {
      return { kind: 'chat', message };
    }

    const title =
      typeof d.title === 'string' && d.title.trim().length > 0
        ? d.title.trim()
        : `${sportNorm.charAt(0).toUpperCase() + sportNorm.slice(1)} session`;

    const durationMins = coerceNullableNumber(d.durationMins);
    const distance = coerceNullableNumber(d.distance);
    let distanceUnit: 'm' | 'km' | null = null;
    if (distance != null) {
      if (d.distanceUnit === 'm' || d.distanceUnit === 'km') distanceUnit = d.distanceUnit;
      else distanceUnit = 'km';
    }

    const intensity = typeof d.intensity === 'string' && d.intensity.trim() ? d.intensity.trim() : 'Steady';
    const estimatedRPE = coerceNullableNumber(d.estimatedRPE);
    const notes =
      d.notes === null || d.notes === undefined
        ? null
        : typeof d.notes === 'string'
          ? d.notes.trim() || null
          : null;

    const needsConfirmation = rec.needsConfirmation !== false;

    const sessionData: RovaLogSessionPayload = {
      sport: sportNorm,
      title,
      durationMins,
      distance,
      distanceUnit,
      intensity,
      estimatedRPE: estimatedRPE != null ? clampRpe(estimatedRPE) : null,
      notes,
      date,
    };

    return { kind: 'log_session', message, sessionData, needsConfirmation };
  }

  return { kind: 'chat', message };
}

function coerceNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clampRpe(n: number) {
  return Math.min(10, Math.max(1, Math.round(n)));
}

function normalizeRovaSport(value: unknown): 'run' | 'swim' | 'bike' | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if (ROVA_SPORTS.has(s)) return s as 'run' | 'swim' | 'bike';
  if (s === 'cycled' || s === 'cycle' || s === 'cycling' || s === 'biked' || s === 'biking') return 'bike';
  if (s === 'swam' || s === 'pool') return 'swim';
  if (s === 'jog' || s === 'jogged' || s === 'running') return 'run';
  return null;
}

function getWeekStartMonday(anchor: Date) {
  const day = anchor.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDaysIso(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day);
  return new Date(utcMs + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetweenTodayAnd(isoDate: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function getLevelProgress(completedCount: number) {
  const inLevel = completedCount % SESSIONS_PER_LEVEL;
  return {
    remainingToNext: inLevel === 0 && completedCount > 0 ? SESSIONS_PER_LEVEL : SESSIONS_PER_LEVEL - inLevel,
  };
}

function nextLevelName(current: string) {
  const normalized = current.toLowerCase();
  const idx = LEVEL_ORDER.indexOf(normalized as (typeof LEVEL_ORDER)[number]);
  if (idx < 0) return 'orka';
  if (idx >= LEVEL_ORDER.length - 1) return null;
  return LEVEL_ORDER[idx + 1];
}

function isCompletedSession(row: WeekSessionRow) {
  if (row.status === 'completed' || row.status === 'skipped') return row.status === 'completed';
  return Array.isArray(row.session_logs) ? row.session_logs.length > 0 : Boolean(row.session_logs);
}

function firstSessionLog(logs: WeekSessionRow['session_logs']): SessionLogMini | null {
  if (!logs) return null;
  return Array.isArray(logs) ? logs[0] ?? null : logs;
}

function extractAnthropicText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as { content?: { type?: string; text?: string }[]; output_text?: string };
  const fromContent = (record.content ?? [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (fromContent) return fromContent;
  if (typeof record.output_text === 'string' && record.output_text.trim()) return record.output_text.trim();
  return '';
}

async function safeContext<T>(label: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[RovaIntelligence] failed: context ${label}: ${message}`);
  }
}

function sanitizeAnthropicFailure(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { error?: { type?: string; message?: string } };
    const type = parsed?.error?.type;
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim()) {
      return type ? `${type}: ${message.trim()}` : message.trim();
    }
  } catch {
    // Non-JSON payloads are fine; fall through.
  }
  return trimmed.slice(0, 400);
}

async function fetchUpcomingRaces(athleteId: string) {
  const { data: goals, error } = await supabase
    .from('race_goals')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('event_date', { ascending: true });
  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }
  const todayIso = toIsoDateLocal(new Date());
  const list = (goals ?? []).filter((goal) => goal.event_date >= todayIso);
  return sortRacesByPriorityThenDate(list);
}

async function fetchLast30DayLogs(athleteId: string): Promise<SessionLogWithSession[]> {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fromIso = toIsoDate(from);
  const { data, error } = await supabase
    .from('session_logs')
    .select(
      'id, completed_at, actual_duration_mins, actual_distance, avg_heart_rate, rpe, notes, sessions(title, sport, duration_mins, scheduled_date)'
    )
    .eq('athlete_id', athleteId)
    .gte('completed_at', `${fromIso}T00:00:00.000Z`)
    .order('completed_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as SessionLogWithSession[];
}

async function fetchWeekSessions(athleteId: string, weekStartIso: string) {
  const endIso = addDaysIso(weekStartIso, 6);
  const { data, error } = await supabase
    .from('sessions')
    .select('id, title, sport, scheduled_date, duration_mins, status, session_logs(id, completed_at, actual_duration_mins)')
    .eq('athlete_id', athleteId)
    .gte('scheduled_date', weekStartIso)
    .lte('scheduled_date', endIso)
    .order('scheduled_date', { ascending: true });
  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as WeekSessionRow[];
}

async function fetchCompletedCount(athleteId: string) {
  const { count, error } = await supabase
    .from('session_logs')
    .select('id', { count: 'exact', head: true })
    .eq('athlete_id', athleteId);
  if (error) {
    if (isMissingTableError(error.message)) return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function fetchFlexSnippets(athleteId: string) {
  const { data, error } = await supabase
    .from('flex_history')
    .select('week_start_date, reason, reason_detail, moved_count, dropped_count, created_at, ai_status')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) {
    // Flex history is optional context; missing table should not block all Rova prompts.
    if (isMissingFlexHistoryTable(error.message)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export type RovaShortcutKind = 'week' | 'last7' | 'planCompare';

async function safeReadResponseText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.length > 2_000 ? `${t.slice(0, 2_000)}…` : t;
  } catch {
    return '';
  }
}

/** Formatted block the user can attach to their next question. */
export async function buildRovaShortcutContext(athleteId: string, kind: RovaShortcutKind): Promise<string> {
  const weekStartIso = toIsoDate(getWeekStartMonday(new Date()));
  const sessions = await fetchWeekSessions(athleteId, weekStartIso);
  const nonRest = sessions.filter((s) => (s.sport ?? '').toLowerCase() !== 'rest');

  if (kind === 'week') {
    const done = nonRest.filter(isCompletedSession);
    const planned = nonRest.length;
    const minutes = done.reduce((sum, s) => {
      const log = firstSessionLog(s.session_logs);
      return sum + (log?.actual_duration_mins ?? s.duration_mins ?? 0);
    }, 0);
    const bySport: Record<string, number> = {};
    for (const s of done) {
      const sp = (s.sport ?? 'other').toLowerCase();
      bySport[sp] = (bySport[sp] ?? 0) + 1;
    }
    const sportLine = Object.entries(bySport)
      .map(([k, v]) => `${k}: ${v} session(s)`)
      .join(', ');
    return `[This week's data — ${weekStartIso}]\nPlanned non-rest sessions: ${planned}\nCompleted: ${done.length}\nApprox. planned volume (scheduled duration): ${minutes} min from completed session rows\nSport mix (completed): ${sportLine || 'none yet'}`;
  }

  if (kind === 'last7') {
    const end = toIsoDate(new Date());
    const start = addDaysIso(end, -6);
    const { data, error } = await supabase
      .from('session_logs')
      .select('completed_at, rpe, notes, sessions(title, sport, duration_mins, scheduled_date)')
      .eq('athlete_id', athleteId)
      .gte('completed_at', `${start}T00:00:00.000Z`)
      .lte('completed_at', `${end}T23:59:59.999Z`)
      .order('completed_at', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SessionLogWithSession[];
    const lines = rows.map((row) => {
      const sess = row.sessions;
      const dur = sess?.duration_mins ?? row.actual_duration_mins ?? '?';
      const iso = sess?.scheduled_date ?? row.completed_at.slice(0, 10);
      return `${iso}: ${sess?.sport ?? '?'} "${sess?.title ?? 'Session'}" — ${dur} min, RPE ${row.rpe ?? 'n/a'}`;
    });
    return `[Last 7 days completed sessions (${start} → ${end})]\n${lines.join('\n') || 'No completed sessions in this window.'}`;
  }

  const done = nonRest.filter(isCompletedSession).length;
  const pending = nonRest.filter((s) => !isCompletedSession(s));
  const pendLines = pending
    .map((s) => `${s.scheduled_date}: ${s.sport} — ${s.title} (${s.duration_mins ?? '?'} min planned)`)
    .join('\n');
  return `[Plan vs completion — week of ${weekStartIso}]\nCompleted non-rest: ${done} / ${nonRest.length}\nRemaining / not logged:\n${pendLines || 'None — nice work.'}`;
}

async function buildAthleteContextBlock(athleteId: string) {
  const { data: athlete, error: athleteErr } = await supabase
    .from('athletes')
    .select('*')
    .eq('id', athleteId)
    .maybeSingle();
  if (athleteErr) throw new Error(athleteErr.message);
  if (!athlete) throw new Error('Athlete not found.');

  const raceRows = await safeContext('race_goals', () => fetchUpcomingRaces(athleteId));
  const topRace = raceRows[0] ?? null;
  const nextARace = raceRows.find((race) => normalizeRacePriority(race.priority) === 'a') ?? topRace;
  const raceName = nextARace?.title ?? athlete.goal_race_name ?? 'goal race';
  const raceDate = nextARace?.event_date ?? athlete.goal_race_date;
  const raceTiming =
    raceDate != null
      ? `with about ${daysUntilIsoDate(raceDate, toIsoDateLocal(new Date()))} days until race day`
      : '— encourage them to set a goal race in the app for sharper timing advice';
  const raceStackLines =
    raceRows.length > 0
      ? raceRows
          .slice(0, 6)
          .map((race) => {
            const priority = racePriorityLabel(race.priority);
            const type = race.race_type ?? 'event';
            return `${race.title} (${type}, ${priority} race) - ${race.event_date} (${daysBetweenTodayAnd(race.event_date)} days)`;
          })
          .join('\n')
      : 'No upcoming races.';

  const recentLogs = await safeContext('session_logs_30d', () => fetchLast30DayLogs(athleteId));
  const weekStartIso = toIsoDate(getWeekStartMonday(new Date()));
  const weekSessions = await safeContext('sessions_week', () => fetchWeekSessions(athleteId, weekStartIso));
  const nonRestWeek = weekSessions.filter((s) => (s.sport ?? '').toLowerCase() !== 'rest');
  const weekSessionsCompleted = nonRestWeek.filter(isCompletedSession).length;
  const weekSessionsPlanned = nonRestWeek.length;

  let weekTotalMinutes = 0;
  const sportMinutes: Record<string, number> = {};
  for (const s of nonRestWeek) {
    if (!isCompletedSession(s)) continue;
    const log = firstSessionLog(s.session_logs);
    const mins = log?.actual_duration_mins ?? s.duration_mins ?? 0;
    weekTotalMinutes += mins;
    const sp = (s.sport ?? 'other').toLowerCase();
    sportMinutes[sp] = (sportMinutes[sp] ?? 0) + mins;
  }

  const sportBreakdown = Object.entries(sportMinutes)
    .map(([sp, m]) => `${sp} ${m}m`)
    .join(', ');

  const remaining = nonRestWeek.filter((s) => !isCompletedSession(s));
  const remainingLines = remaining
    .map((s) => `${s.scheduled_date}: ${s.sport} ${s.title} (${s.duration_mins ?? '?'} min)`)
    .join('\n');

  const flexRows = await safeContext('flex_history', () => fetchFlexSnippets(athleteId));

  const totalCompleted = await safeContext('session_logs_count', () => fetchCompletedCount(athleteId));
  const { remainingToNext } = getLevelProgress(totalCompleted);
  const nextLvl = nextLevelName(athlete.level);
  const levelProgressLine =
    nextLvl == null
      ? `Peak tier (vinna) — ${totalCompleted} completed sessions logged.`
      : `About ${remainingToNext} more completed sessions to reach the ${nextLvl} tier (50 sessions per level band). Total completed: ${totalCompleted}.`;
  const flexLines =
    flexRows.length === 0
      ? 'None on file.'
      : flexRows
          .map(
            (f) =>
              `${f.created_at?.slice(0, 10) ?? '?'}: ${f.reason}${f.reason_detail ? ` (${f.reason_detail})` : ''} — moved ${f.moved_count}, dropped ${f.dropped_count} (${f.ai_status})`
          )
          .join('\n');

  const recentSessionLines = recentLogs.slice(0, 20).map((s) => {
    const sess = s.sessions;
    const date = sess?.scheduled_date ?? s.completed_at.slice(0, 10);
    const dur = s.actual_duration_mins ?? sess?.duration_mins ?? '?';
    const title = sess?.title ?? 'Session';
    const sport = sess?.sport ?? '?';
    const metrics = [
      s.avg_heart_rate != null ? `HR ${s.avg_heart_rate}` : null,
      s.actual_distance != null ? `dist ${s.actual_distance}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    const note = s.notes?.trim() ? ` — note: ${s.notes.trim().slice(0, 120)}` : '';
    return `${date}: ${sport} ${title} - ${dur}min, RPE: ${s.rpe ?? 'not logged'}${metrics ? `; ${metrics}` : ''}${note}`;
  });

  return {
    athleteName: athlete.name,
    level: athlete.level,
    raceName,
    raceDate,
    raceTiming,
    raceStackLines,
    completedSessionsCount: recentLogs.length,
    completedSessionsLines: recentSessionLines.join('\n'),
    weekSessionsCompleted,
    weekSessionsPlanned,
    weekTotalMinutes,
    sportBreakdown: sportBreakdown || 'no completed volume yet this week',
    remainingSessionsBlock: remainingLines || 'None — all planned sessions logged or rest days only.',
    flexLines,
    levelProgressLine,
  };
}

/**
 * Short AI blurb for the Today tab "Coach directive" card (performance + plan aware; not tied to one session row).
 */
export async function fetchTodayCoachDirective(args: {
  athleteId: string;
  /** Lines describing today's scheduled sessions & completion state (built client-side). */
  todayScheduleSummary: string;
}): Promise<string> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing EXPO_PUBLIC_ANTHROPIC_API_KEY. Add it to your .env file.');
  }
  if (!isAnthropicEnabled()) {
    return 'Dial in intention for today - check your Plan when you are ready, and log honestly.';
  }

  const ctx = await buildAthleteContextBlock(args.athleteId);
  const raceDateLine = ctx.raceDate != null ? ctx.raceDate : 'not set';
  const todayIso = toIsoDate(new Date());

  const briefing = `
TODAY (${todayIso})
What's on today's calendar:
${args.todayScheduleSummary.trim() || 'Nothing listed — recovery or unstructured day.'}

ATHLETE (${ctx.level}): ${ctx.athleteName}
Goal race: ${ctx.raceName} (${raceDateLine}). ${ctx.raceTiming}.
Upcoming race stack (priority-aware):
${ctx.raceStackLines}

This week: ${ctx.weekSessionsCompleted}/${ctx.weekSessionsPlanned} sessions completed (non-rest). Completed volume logged so far ~${ctx.weekTotalMinutes} min. Sport spread: ${ctx.sportBreakdown}.

Still planned this week:
${ctx.remainingSessionsBlock}

Recent completions (snippet):
${ctx.completedSessionsLines || 'none yet'}

Training adjustments (flex): ${ctx.flexLines}

Level path: ${ctx.levelProgressLine}
`.trim();

  const systemPrompt = `You are Rova — Telo's triathlon coach voice. Produce the body copy for Today's home-screen "coach directive".

Rules:
- 2–4 short sentences total, plain text only (no JSON, bullets, markdown, or title line).
- Second person ("you"). Ground every claim in the briefing; infer lightly from load patterns (fatigue cues from RPE, consistency, imbalance across sports).
- Does NOT need to match a single session ID — it's holistic advice for *today*.
- Mention goal race timeline only when it adds clarity. Never medical advice or injury diagnosis.
- Respect race priority in guidance:
  - A race: protect freshness and taper intent
  - B race: checkpoint effort with moderate caution
  - C race: train-through framing unless immediate A-race conflict

Today is ${todayIso}.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 320,
      system: systemPrompt,
      messages: [{ role: 'user', content: briefing }],
    }),
  });

  if (!response.ok) {
    const failure = await safeReadResponseText(response);
    if (response.status === 401 || response.status === 403) {
      throw new Error(`[RovaIntelligence] failed: coach directive auth ${response.status} ${failure}`);
    }
    if (response.status === 429) throw new Error('Rova is busy. Please try again.');
    if (response.status >= 500) throw new Error('Rova is having trouble. Please try again.');
    throw new Error(`[RovaIntelligence] failed: coach directive ${response.status} ${failure}`);
  }

  const payload = await response.json();
  const text = extractAnthropicText(payload);
  return text.trim() || 'Dial in intention for today — check your Plan when you\'re ready, and log honestly.';
}

export async function askRova(params: {
  athleteId: string;
  question: string;
  conversationHistory: RovaMessageTurn[];
}): Promise<{ text: string; parsed: ParsedRova; source: 'template' | 'claude' }> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing EXPO_PUBLIC_ANTHROPIC_API_KEY. Add it to your .env file.');
  }
  const combinedFallback = "I'm having trouble connecting right now. Check your network and try again.";

  const shouldForceClaudeRoute = (question: string) => {
    const q = question.toLowerCase();
    const looksLikeSessionLogIntent =
      /\b(log|record|add)\b/.test(q) ||
      /\b(i ran|i run|i rode|i biked|i cycled|i swam|i completed|i finished|just trained)\b/.test(q);
    const looksComplex = question.length > 220 || question.includes('\n') || (question.match(/\?/g) ?? []).length > 1;
    return looksLikeSessionLogIntent || looksComplex;
  };

  let athleteContext: AthleteContext;
  try {
    athleteContext = await buildAthleteContext(params.athleteId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[RovaIntelligence] failed: ${message}`);
  }

  let templateText: string | null = null;
  if (!shouldForceClaudeRoute(params.question)) {
    try {
      templateText = matchTemplate(params.question, athleteContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[RovaIntelligence] failed: ${message}`);
    }
  }

  if (templateText) {
    return {
      text: templateText,
      parsed: { kind: 'chat', message: templateText },
      source: 'template',
    };
  }

  if (!isAnthropicEnabled()) {
    return {
      text: combinedFallback,
      parsed: { kind: 'chat', message: combinedFallback },
      source: 'template',
    };
  }

  let ctx: Awaited<ReturnType<typeof buildAthleteContextBlock>>;
  try {
    ctx = await buildAthleteContextBlock(params.athleteId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[RovaIntelligence] failed: ${message}`);
  }
  const raceDateLine = ctx.raceDate != null ? ctx.raceDate : 'not set';
  const todayIso = toIsoDate(new Date());
  const systemPrompt = `You are Rova, an intelligent and supportive triathlon coach for ${ctx.athleteName}, a ${ctx.level}-level athlete training for ${ctx.raceName} ${ctx.raceTiming}.

ATHLETE DATA:
- Current level: ${ctx.level}
- Goal race: ${ctx.raceName} on ${raceDateLine}
- Upcoming race stack (priority-aware):
${ctx.raceStackLines}
- Last 30 days: ${ctx.completedSessionsCount} sessions completed
- Recent sessions:
${ctx.completedSessionsLines || 'No sessions logged in window.'}

- This week: ${ctx.weekSessionsCompleted}/${ctx.weekSessionsPlanned} sessions done
- Weekly load: ${ctx.weekTotalMinutes} minutes (completed session durations this week where logged)
- Sport balance (minutes completed this week): ${ctx.sportBreakdown}
- Remaining planned sessions this week:
${ctx.remainingSessionsBlock}

- Recent plan flex/adjustments:
${ctx.flexLines}

- Level progress: ${ctx.levelProgressLine}

COACHING PHILOSOPHY:
- Be direct, supportive, and data-informed
- Reference specific sessions when relevant
- If asked about fatigue, look at RPE trends and recent load
- If asked about readiness, consider time until race and consistency
- If asked for advice, consider their level and constraints
- Prioritize race intent:
  - A race = peak event, taper-protecting decisions
  - B race = important benchmark, no full taper
  - C race = training stimulus, usually train-through
- Never give medical advice or diagnose injuries
- Encourage rest and recovery when needed
- Celebrate progress and consistency

SESSION LOGGING (detection):
- If the user describes a completed workout in past tense (e.g. ran, jogged, swam, biked, cycled, rode, completed, finished, did, crushed) and gives or implies duration and/or distance, treat that as intent to log a session (also when they explicitly ask to log or record a workout).
- Infer sport as run, swim, or bike only (indoor bike / Zwift / cycle → bike). Title: short friendly label from their words.
- Default session date: ${todayIso} (athlete local / app calendar date — same YYYY-MM-DD rule as training sessions; use another date only if they clearly mean a different day).
- Map effort to intensity (one of Easy, Steady, Tempo, Threshold, Sprint) and estimatedRPE (1–10 integers): recovery/easy/Z1–Z2 → Easy + RPE 3–4; steady/aerobic → Steady + 5–6; moderate/marathon/tempo → Tempo + 6–7; hard/threshold → Threshold + 8; sprint/max/VO2 → Sprint + 9–10.
- durationMins: minutes as a number or null if unknown. distance + distanceUnit (m or km) or nulls if unknown. notes: extra context or null.

OUTPUT CONTRACT — CRITICAL:
- Reply with ONLY one JSON object. No markdown, no code fences, no text before or after.
- If NOT logging a session: {"message":"<conversational reply, max 3-4 short sentences unless they asked for detail>","action":"none"}
- If logging a session: {"message":"<brief natural confirmation>","action":"log_session","sessionData":{...},"needsConfirmation":true}
- sessionData shape exactly:
  {"sport":"run"|"swim"|"bike","title":string,"durationMins":number|null,"distance":number|null,"distanceUnit":"m"|"km"|null,"intensity":string,"estimatedRPE":number|null,"notes":string|null,"date":"YYYY-MM-DD"}`;

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          ...params.conversationHistory.map((m) => ({
            role: m.role,
            content: m.message,
          })),
          {
            role: 'user',
            content: params.question,
          },
        ],
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[RovaIntelligence] failed: ${message}`);
  }

  if (!response.ok) {
    const failure = await safeReadResponseText(response);
    const detail = sanitizeAnthropicFailure(failure);
    if (response.status === 401 || response.status === 403) {
      throw new Error('Rova authentication failed. Check EXPO_PUBLIC_ANTHROPIC_API_KEY.');
    }
    if (response.status === 429) throw new Error('Rova is busy. Please try again.');
    if (response.status >= 500) throw new Error('Rova is having trouble. Please try again.');
    if (response.status === 400) {
      throw new Error(detail ? `Rova request rejected: ${detail}` : 'Rova request rejected by provider.');
    }
    throw new Error(detail ? `Rova request failed (${response.status}): ${detail}` : `Rova request failed (${response.status}).`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      text: combinedFallback,
      parsed: { kind: 'chat', message: combinedFallback },
      source: 'claude',
    };
  }
  const text = extractAnthropicText(payload);
  if (!text) {
    const emptyFallback = "I didn't quite catch that. Try rephrasing your question.";
    return {
      text: emptyFallback,
      parsed: { kind: 'chat', message: emptyFallback },
      source: 'claude',
    };
  }
  const parsed = parseRovaResponse(text);
  return { text, parsed, source: 'claude' };
}
