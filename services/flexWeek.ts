import { supabase } from '@/lib/supabase';
import { isAnthropicEnabled } from '@/lib/anthropic';

export type FlexReason = 'Catch up' | 'Travel' | 'Busy week' | 'Low energy' | 'Minor niggle' | 'Other';

export type FlexConstraints = {
  travelDays?: string[];
  busyDays?: string[];
  tiredness?: number;
  otherNotes?: string;
};

export type FlexSession = {
  id: string;
  title: string;
  sport: string;
  scheduledDate: string;
  durationMins: number | null;
  intensity: string | null;
  status: string | null;
  reason?: string;
};

export type ReshuffledPlan = {
  summary: string;
  weekStartDate: string;
  aiStatus: 'success' | 'fallback' | 'manual';
  movedSessions: {
    sessionId: string;
    fromDate: string;
    toDate: string;
    reason: string;
  }[];
  droppedSessions: {
    sessionId: string;
    date: string;
    reason: string;
  }[];
  unchangedSessions: {
    sessionId: string;
    date: string;
  }[];
  before: FlexSession[];
  after: FlexSession[];
};

export type ReshuffleWeekParams = {
  athleteId: string;
  weekStartDate: string;
  reason: FlexReason;
  constraints: FlexConstraints;
};

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function stripCodeFences(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return trimmed;
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day);
  return new Date(utcMs + days * DAY_MS).toISOString().slice(0, 10);
}

function toLocalIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function datesBetween(startIso: string, endIso: string) {
  const dates: string[] = [];
  let current = startIso;
  while (current <= endIso) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

function normalizeDate(value: unknown, fallback: string) {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) return value;
  return fallback;
}

function normalizeMoves(
  moves: unknown,
  sessionsById: Map<string, FlexSession>,
  allowedDates: string[]
): ReshuffledPlan['movedSessions'] {
  if (!Array.isArray(moves)) return [];
  const weekDates = new Set(allowedDates);
  return moves
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => entry as Record<string, unknown>)
    .map((entry) => {
      const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : '';
      const session = sessionsById.get(sessionId);
      if (!session) return null;
      const fromDate = normalizeDate(entry.fromDate, session.scheduledDate);
      const toDateRaw = normalizeDate(entry.toDate, fromDate);
      const toDate = weekDates.has(toDateRaw) ? toDateRaw : fromDate;
      if (toDate === fromDate) return null;
      return {
        sessionId,
        fromDate,
        toDate,
        reason: typeof entry.reason === 'string' && entry.reason.trim().length > 0 ? entry.reason.trim() : 'Rebalanced training load',
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeDrops(
  drops: unknown,
  sessionsById: Map<string, FlexSession>
): ReshuffledPlan['droppedSessions'] {
  if (!Array.isArray(drops)) return [];
  return drops
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => entry as Record<string, unknown>)
    .map((entry) => {
      const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : '';
      const session = sessionsById.get(sessionId);
      if (!session) return null;
      return {
        sessionId,
        date: session.scheduledDate,
        reason: typeof entry.reason === 'string' && entry.reason.trim().length > 0 ? entry.reason.trim() : 'Dropped to protect recovery',
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function buildAfterSnapshot(
  before: FlexSession[],
  moved: ReshuffledPlan['movedSessions'],
  dropped: ReshuffledPlan['droppedSessions']
) {
  const moveMap = new Map(moved.map((m) => [m.sessionId, m]));
  const dropMap = new Map(dropped.map((d) => [d.sessionId, d]));
  return before.map((session) => {
    const movedSession = moveMap.get(session.id);
    if (movedSession) {
      return { ...session, scheduledDate: movedSession.toDate, reason: movedSession.reason };
    }
    const droppedSession = dropMap.get(session.id);
    if (droppedSession) {
      return { ...session, status: 'skipped', reason: droppedSession.reason };
    }
    return session;
  });
}

function buildHeuristicFallback(
  sessions: FlexSession[],
  weekStartDate: string,
  windowDates: string[],
  reason: FlexReason,
  constraints?: FlexConstraints
): ReshuffledPlan {
  const movable = sessions.filter((s) => s.sport !== 'rest');
  const movedSessions: ReshuffledPlan['movedSessions'] = [];
  const droppedSessions: ReshuffledPlan['droppedSessions'] = [];
  const weekDateSet = new Set(windowDates);
  const blockedWeekdays = new Set<string>();
  for (const day of constraints?.travelDays ?? []) blockedWeekdays.add(day);
  for (const day of constraints?.busyDays ?? []) blockedWeekdays.add(day);

  const countsByDate = new Map<string, number>();
  for (const date of windowDates) countsByDate.set(date, 0);
  for (const session of sessions) {
    if (!weekDateSet.has(session.scheduledDate)) continue;
    countsByDate.set(session.scheduledDate, (countsByDate.get(session.scheduledDate) ?? 0) + 1);
  }

  if (movable.length > 0) {
    const first = movable[0];
    const candidates = windowDates
      .filter((date) => date !== first.scheduledDate)
      .filter((date) => {
        const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' });
        return !blockedWeekdays.has(weekday);
      })
      .sort((a, b) => (countsByDate.get(a) ?? 0) - (countsByDate.get(b) ?? 0));
    const proposedDate = candidates[0];
    if (proposedDate && weekDateSet.has(proposedDate)) {
      movedSessions.push({
        sessionId: first.id,
        fromDate: first.scheduledDate,
        toDate: proposedDate,
        reason: 'Shifted one key session to keep momentum without overload',
      });
    }
  }

  if (reason === 'Low energy' && movable.length > 1) {
    const last = movable[movable.length - 1];
    droppedSessions.push({
      sessionId: last.id,
      date: last.scheduledDate,
      reason: 'Dropped one lower-priority session for recovery',
    });
  }

  const after = buildAfterSnapshot(sessions, movedSessions, droppedSessions);
  const touchedIds = new Set([...movedSessions.map((m) => m.sessionId), ...droppedSessions.map((d) => d.sessionId)]);
  const unchangedSessions = sessions
    .filter((session) => !touchedIds.has(session.id))
    .map((session) => ({ sessionId: session.id, date: session.scheduledDate }));

  return {
    summary: 'Rova applied a lightweight fallback reshuffle based on your week load.',
    weekStartDate,
    aiStatus: 'fallback',
    movedSessions,
    droppedSessions,
    unchangedSessions,
    before: sessions,
    after,
  };
}

function validateReshuffledPlanShape(value: unknown): asserts value is Omit<ReshuffledPlan, 'before' | 'after' | 'aiStatus'> {
  if (!value || typeof value !== 'object') throw new Error('Flex payload is not an object.');
  const maybe = value as Record<string, unknown>;
  if (typeof maybe.summary !== 'string') throw new Error('Missing summary in flex payload.');
}

export async function reshuffleWeek(params: ReshuffleWeekParams): Promise<ReshuffledPlan> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing EXPO_PUBLIC_ANTHROPIC_API_KEY. Add it to your .env file.');
  }
  const todayIso = toLocalIsoDate();
  const windowStartDate = todayIso;
  const windowEndDate = addDays(todayIso, 6);
  const windowDates = datesBetween(windowStartDate, windowEndDate);

  const { data, error } = await supabase
    .from('sessions')
    .select('id,title,sport,scheduled_date,duration_mins,intensity,status')
    .eq('athlete_id', params.athleteId)
    .gte('scheduled_date', windowStartDate)
    .lte('scheduled_date', windowEndDate)
    .eq('status', 'planned')
    .order('scheduled_date', { ascending: true });

  if (error) throw new Error(error.message);

  const beforeSessions: FlexSession[] = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    sport: row.sport,
    scheduledDate: row.scheduled_date,
    durationMins: row.duration_mins,
    intensity: row.intensity,
    status: row.status,
  }));

  if (beforeSessions.length === 0) {
    return {
      summary: 'No planned sessions in the next 7 days to reshuffle.',
      weekStartDate: params.weekStartDate,
      aiStatus: 'manual',
      movedSessions: [],
      droppedSessions: [],
      unchangedSessions: [],
      before: [],
      after: [],
    };
  }

  const sessionsById = new Map(beforeSessions.map((session) => [session.id, session]));
  if (!isAnthropicEnabled() || apiKey === 'your_api_key_here') {
    return buildHeuristicFallback(beforeSessions, params.weekStartDate, windowDates, params.reason, params.constraints);
  }

  const prompt = `You are Rova Flex, an expert triathlon plan reshuffler.
Reshuffle this athlete's next 7 days only (from today).

Week start: ${params.weekStartDate}
Window start: ${windowStartDate}
Window end: ${windowEndDate}
Reason: ${params.reason}
Constraints:
- travelDays: ${(params.constraints.travelDays ?? []).join(', ') || 'none'}
- busyDays: ${(params.constraints.busyDays ?? []).join(', ') || 'none'}
- tiredness (1-5): ${params.constraints.tiredness ?? 'not provided'}
- notes: ${params.constraints.otherNotes ?? 'none'}

Rules:
- Only reference sessions by exact sessionId from input.
- Move sessions within the active window only (${windowStartDate} to ${windowEndDate}).
- Keep swim/bike/run balance where practical.
- Avoid stacking two hard days back-to-back.
- Prefer dropping at most one lower-priority session.

Input sessions JSON:
${JSON.stringify(beforeSessions)}

Return ONLY JSON:
{
  "summary": "short explanation",
  "movedSessions": [
    { "sessionId": "uuid", "fromDate": "YYYY-MM-DD", "toDate": "YYYY-MM-DD", "reason": "why moved" }
  ],
  "droppedSessions": [
    { "sessionId": "uuid", "reason": "why dropped" }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 5000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return buildHeuristicFallback(beforeSessions, params.weekStartDate, windowDates, params.reason, params.constraints);
    const payload = await response.json();
    const text = payload?.content?.find((part: { type?: string }) => part.type === 'text')?.text ?? '';
    if (!text) return buildHeuristicFallback(beforeSessions, params.weekStartDate, windowDates, params.reason, params.constraints);

    const parsed = JSON.parse(stripCodeFences(text));
    validateReshuffledPlanShape(parsed);
    const movedSessions = normalizeMoves((parsed as any).movedSessions, sessionsById, windowDates);
    const movedIds = new Set(movedSessions.map((m) => m.sessionId));
    const droppedSessions = normalizeDrops((parsed as any).droppedSessions, sessionsById).filter(
      (drop) => !movedIds.has(drop.sessionId)
    );
    const touchedIds = new Set([...movedSessions.map((m) => m.sessionId), ...droppedSessions.map((d) => d.sessionId)]);
    const unchangedSessions = beforeSessions
      .filter((session) => !touchedIds.has(session.id))
      .map((session) => ({ sessionId: session.id, date: session.scheduledDate }));
    const after = buildAfterSnapshot(beforeSessions, movedSessions, droppedSessions);
    return {
      summary: (parsed as any).summary,
      weekStartDate: params.weekStartDate,
      aiStatus: 'success',
      movedSessions,
      droppedSessions,
      unchangedSessions,
      before: beforeSessions,
      after,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[FlexWeek] failed: ${message}`);
  }
}
