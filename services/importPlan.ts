import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

export type ConflictResolution = 'replace' | 'alongside' | 'skip';
export type SupportedSport = 'swim' | 'bike' | 'run' | 'brick' | 'gym' | 'rest';
export type SupportedIntensity = 'easy' | 'steady' | 'tempo' | 'threshold' | 'intervals';
export type ParsedBlock = {
  blockType: 'warmup' | 'main' | 'cooldown' | string;
  title: string;
  steps: string[];
};
export type ParsedSession = {
  id?: string;
  date: string;
  sport: SupportedSport;
  title: string;
  durationMins: number | null;
  distance: number | null;
  distanceUnit: 'm' | 'km' | null;
  intensity: SupportedIntensity;
  description?: string | null;
  coachNote?: string | null;
  blocks: ParsedBlock[];
  source?: 'imported' | 'manual';
};
export type ImportResult = {
  imported: number;
  skipped: number;
  replaced: number;
  errors: string[];
};
export type ParseIssue = { lineNumber: number; line: string; reason: string };

type PlanRow = Database['public']['Tables']['plans']['Row'];
type SessionInsert = Database['public']['Tables']['sessions']['Insert'];

const SUPPORTED_SPORTS = new Set<SupportedSport>(['swim', 'bike', 'run', 'brick', 'gym', 'rest']);
const EXAMPLE_TEMPLATE = `DATE | SPORT | TITLE | DURATION | NOTES
2026-07-06 | swim | Threshold intervals | 50 min | 8x100m threshold
2026-07-08 | bike | Zone 2 ride | 45 min | Easy pace, 85 RPM
2026-07-09 | run | Easy run | 30 min | Conversational pace`;

function toIsoDate(value: Date) {
  const y = value.getFullYear();
  const m = `${value.getMonth() + 1}`.padStart(2, '0');
  const d = `${value.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateToIso(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const d = slashMatch[1].padStart(2, '0');
    const m = slashMatch[2].padStart(2, '0');
    return `${slashMatch[3]}-${m}-${d}`;
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return toIsoDate(new Date(ts));
}

function parseDurationToMinutes(input: string): number | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, ' ');
  const hrMinMatch = normalized.match(/(\d+(?:\.\d+)?)\s*h(?:r|our|ours)?(?:\s*(\d{1,2}))?/);
  if (hrMinMatch) {
    const hours = Number(hrMinMatch[1]);
    const minutes = hrMinMatch[2] ? Number(hrMinMatch[2]) : 0;
    return Math.round(hours * 60 + minutes);
  }
  const minMatch = normalized.match(/(\d+(?:\.\d+)?)\s*m(?:in|ins|inute|inutes)?/);
  if (minMatch) return Math.round(Number(minMatch[1]));
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Math.round(Number(normalized));
  return null;
}

function normalizeIntensity(value?: string | null): SupportedIntensity {
  const v = value?.trim().toLowerCase() ?? '';
  if (v === 'tempo' || v === 'threshold' || v === 'intervals' || v === 'easy') return v;
  return 'steady';
}

function inferDistanceUnitFromSport(sport: SupportedSport): 'm' | 'km' | null {
  if (sport === 'swim') return 'm';
  if (sport === 'bike' || sport === 'run' || sport === 'brick') return 'km';
  return null;
}

export function templateImportExample() {
  return EXAMPLE_TEMPLATE;
}

export function parseTemplatePlan(input: string): { sessions: ParsedSession[]; issues: ParseIssue[] } {
  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sessions: ParsedSession[] = [];
  const issues: ParseIssue[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0 && /date\s*\|\s*sport/i.test(line)) continue;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 4) {
      issues.push({ lineNumber: i + 1, line, reason: 'Expected at least 4 columns: date | sport | title | duration' });
      continue;
    }
    const [dateRaw, sportRaw, titleRaw, durationRaw, notesRaw] = parts;
    const date = parseDateToIso(dateRaw);
    if (!date) {
      issues.push({ lineNumber: i + 1, line, reason: 'Invalid date format' });
      continue;
    }
    const sport = sportRaw.toLowerCase() as SupportedSport;
    if (!SUPPORTED_SPORTS.has(sport)) {
      issues.push({ lineNumber: i + 1, line, reason: `Unsupported sport "${sportRaw}"` });
      continue;
    }
    const title = titleRaw?.trim();
    if (!title) {
      issues.push({ lineNumber: i + 1, line, reason: 'Missing session title' });
      continue;
    }
    const durationMins = parseDurationToMinutes(durationRaw);
    if (durationMins == null) {
      issues.push({ lineNumber: i + 1, line, reason: `Invalid duration "${durationRaw}"` });
      continue;
    }
    const notes = notesRaw?.trim() ?? '';
    sessions.push({
      date,
      sport,
      title,
      durationMins,
      distance: null,
      distanceUnit: inferDistanceUnitFromSport(sport),
      intensity: 'steady',
      description: notes || null,
      coachNote: notes || null,
      blocks: notes
        ? [{ blockType: 'main', title: 'Main set', steps: [notes] }]
        : [{ blockType: 'main', title: 'Main set', steps: [] }],
      source: 'imported',
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  return { sessions, issues };
}

/** Whole calendar weeks spanned by [startIso, endIso] (inclusive), minimum 1. */
function planSpanWeeks(startIso: string, endIso: string): number {
  const ms = Date.parse(`${endIso}T00:00:00`) - Date.parse(`${startIso}T00:00:00`);
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.ceil(ms / 604800000));
}

async function getOrCreateActivePlan(athleteId: string, sessions: ParsedSession[]): Promise<PlanRow> {
  const { data: active, error: activeError } = await supabase
    .from('plans')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .order('start_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (active) {
    const dates = sessions.map((s) => s.date).sort();
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    if (!earliest || !latest) return active;

    const nextStart =
      active.start_date != null ? (earliest < active.start_date ? earliest : active.start_date) : earliest;
    const nextEnd = active.end_date != null ? (latest > active.end_date ? latest : active.end_date) : latest;

    if (nextStart === active.start_date && nextEnd === active.end_date) {
      return active;
    }

    const spanWeeks = planSpanWeeks(nextStart, nextEnd);
    const { error: extendError } = await supabase
      .from('plans')
      .update({
        start_date: nextStart,
        end_date: nextEnd,
        total_weeks: Math.max(active.total_weeks ?? 1, spanWeeks),
      })
      .eq('id', active.id);
    if (extendError) throw new Error(extendError.message);
    const { data: refreshed, error: refetchError } = await supabase.from('plans').select('*').eq('id', active.id).single();
    if (refetchError || !refreshed) return active;
    return refreshed;
  }
  const dates = sessions.map((s) => s.date).sort();
  const earliest = dates[0] ?? toIsoDate(new Date());
  const latest = dates[dates.length - 1] ?? earliest;
  const { data: created, error: createError } = await supabase
    .from('plans')
    .insert({
      athlete_id: athleteId,
      name: 'Custom Training Plan',
      phase: 'custom',
      start_date: earliest,
      end_date: latest,
      status: 'active',
      total_weeks: planSpanWeeks(earliest, latest),
    })
    .select('*')
    .single();
  if (createError || !created) throw new Error(createError?.message ?? 'Unable to create custom plan');
  return created;
}

async function insertSessionWithBlocksAndSteps(athleteId: string, planId: string, session: ParsedSession) {
  const row: SessionInsert = {
    athlete_id: athleteId,
    plan_id: planId,
    title: session.title,
    sport: session.sport,
    scheduled_date: session.date,
    duration_mins: session.durationMins,
    distance: session.distance,
    distance_unit: session.distanceUnit,
    intensity: session.intensity,
    description: session.description ?? null,
    coach_note: session.coachNote ?? null,
    status: 'planned',
    completed_at: null,
    phase: 'custom',
    week_number: null,
  };
  const { data: inserted, error: insertError } = await supabase.from('sessions').insert(row).select('id').single();
  if (insertError || !inserted) throw new Error(insertError?.message ?? `Could not insert session ${session.title}`);
  if (!session.blocks.length) return inserted.id;
  const { data: blocks, error: blockError } = await supabase
    .from('session_blocks')
    .insert(
      session.blocks.map((block, idx) => ({
        session_id: inserted.id,
        block_type: block.blockType,
        title: block.title || 'Block',
        order_index: idx + 1,
      }))
    )
    .select('id, order_index');
  if (blockError) throw new Error(blockError.message);
  const stepRows: Database['public']['Tables']['session_steps']['Insert'][] = [];
  for (const block of blocks ?? []) {
    const sourceBlock = session.blocks[block.order_index - 1];
    for (let i = 0; i < (sourceBlock?.steps?.length ?? 0); i += 1) {
      const step = sourceBlock.steps[i]?.trim();
      if (!step) continue;
      stepRows.push({ block_id: block.id, step_text: step, order_index: i + 1, is_checked: false });
    }
  }
  if (stepRows.length > 0) {
    const { error: stepError } = await supabase.from('session_steps').insert(stepRows);
    if (stepError) throw new Error(stepError.message);
  }
  return inserted.id;
}

export async function importSessions(
  athleteId: string,
  sessions: ParsedSession[],
  conflictResolution: ConflictResolution
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, replaced: 0, errors: [] };
  if (!sessions.length) return result;
  const activePlan = await getOrCreateActivePlan(athleteId, sessions);
  for (const session of sessions) {
    try {
      const { data: existing, error: conflictError } = await supabase
        .from('sessions')
        .select('id')
        .eq('athlete_id', athleteId)
        .eq('scheduled_date', session.date)
        .eq('status', 'planned');
      if (conflictError) throw new Error(conflictError.message);
      const hasConflict = (existing?.length ?? 0) > 0;
      if (hasConflict && conflictResolution === 'skip') {
        result.skipped += 1;
        continue;
      }
      if (hasConflict && conflictResolution === 'replace') {
        const ids = (existing ?? []).map((row) => row.id);
        if (ids.length > 0) {
          await supabase.from('sessions').delete().in('id', ids);
        }
        result.replaced += 1;
      }
      await insertSessionWithBlocksAndSteps(athleteId, activePlan.id, session);
      result.imported += 1;
    } catch (error) {
      result.errors.push(`${session.date} ${session.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export async function upsertManualSession(
  athleteId: string,
  session: ParsedSession,
  mode: 'create' | 'edit',
  sessionId?: string
) {
  if (mode === 'edit' && sessionId) {
    const { error: updateError } = await supabase
      .from('sessions')
      .update({
        title: session.title,
        sport: session.sport,
        scheduled_date: session.date,
        duration_mins: session.durationMins,
        distance: session.distance,
        distance_unit: session.distanceUnit,
        intensity: session.intensity,
        description: session.description ?? null,
        coach_note: session.coachNote ?? null,
      })
      .eq('id', sessionId)
      .eq('athlete_id', athleteId);
    if (updateError) throw new Error(updateError.message);
    await supabase.from('session_blocks').delete().eq('session_id', sessionId);
    const { data: blocks, error: blockError } = await supabase
      .from('session_blocks')
      .insert(
        session.blocks.map((block, idx) => ({
          session_id: sessionId,
          block_type: block.blockType,
          title: block.title || 'Block',
          order_index: idx + 1,
        }))
      )
      .select('id, order_index');
    if (blockError) throw new Error(blockError.message);
    const stepRows: Database['public']['Tables']['session_steps']['Insert'][] = [];
    for (const block of blocks ?? []) {
      const sourceBlock = session.blocks[block.order_index - 1];
      for (let i = 0; i < (sourceBlock?.steps?.length ?? 0); i += 1) {
        const step = sourceBlock.steps[i]?.trim();
        if (!step) continue;
        stepRows.push({ block_id: block.id, step_text: step, order_index: i + 1, is_checked: false });
      }
    }
    if (stepRows.length) {
      const { error: stepError } = await supabase.from('session_steps').insert(stepRows);
      if (stepError) throw new Error(stepError.message);
    }
    return;
  }
  await importSessions(athleteId, [session], 'alongside');
}

export async function deleteSessionById(athleteId: string, sessionId: string) {
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId).eq('athlete_id', athleteId);
  if (error) throw new Error(error.message);
}

export async function loadSessionForEdit(sessionId: string): Promise<ParsedSession | null> {
  const { data, error } = await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: blockRows, error: blockError } = await supabase
    .from('session_blocks')
    .select('*')
    .eq('session_id', sessionId)
    .order('order_index', { ascending: true });
  if (blockError) throw new Error(blockError.message);
  const blockIds = (blockRows ?? []).map((b) => b.id);
  let stepRows: Database['public']['Tables']['session_steps']['Row'][] = [];
  if (blockIds.length > 0) {
    const { data, error: stepError } = await supabase
      .from('session_steps')
      .select('*')
      .in('block_id', blockIds)
      .order('order_index', { ascending: true });
    if (stepError) throw new Error(stepError.message);
    stepRows = data ?? [];
  }
  const stepMap = new Map<string, string[]>();
  for (const step of stepRows) {
    const next = stepMap.get(step.block_id) ?? [];
    next.push(step.step_text);
    stepMap.set(step.block_id, next);
  }
  const blocks = (blockRows ?? []).map((block) => ({
    blockType: block.block_type,
    title: block.title,
    steps: stepMap.get(block.id) ?? [],
  }));
  return {
    id: data.id,
    date: data.scheduled_date,
    sport: (data.sport as SupportedSport) ?? 'rest',
    title: data.title,
    durationMins: data.duration_mins,
    distance: data.distance,
    distanceUnit: (data.distance_unit as 'm' | 'km' | null) ?? null,
    intensity: normalizeIntensity(data.intensity),
    description: data.description,
    coachNote: data.coach_note,
    blocks,
    source: 'manual',
  };
}

export function buildRepeatedSessions(base: ParsedSession, everyDays: number, totalWeeks: number): ParsedSession[] {
  const sessions: ParsedSession[] = [];
  const iterations = Math.max(1, Math.floor((totalWeeks * 7) / Math.max(1, everyDays)));
  const startMs = Date.parse(`${base.date}T00:00:00`);
  for (let i = 0; i < iterations; i += 1) {
    const nextDate = new Date(startMs + i * everyDays * 86_400_000);
    sessions.push({ ...base, date: toIsoDate(nextDate) });
  }
  return sessions;
}

