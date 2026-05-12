import { supabase } from '@/lib/supabase';
import { savePlanToDatabase } from '@/services/savePlan';
import type { GeneratedPlan, GeneratedSession } from '@/services/plan-types';
import { getTemplateForLevel, type TemplateDay, type TemplateLevel, type TemplateRaceType } from '@/services/planTemplates';
import { syncAppleCalendarIfEnabled } from '@/services/appleCalendarSync';

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const SHORT_TO_WEEKDAY: Record<string, typeof WEEKDAY_KEYS[number]> = {
  sun: 'sunday',
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
};

function toIsoDate(value: Date) {
  const y = value.getFullYear();
  const m = `${value.getMonth() + 1}`.padStart(2, '0');
  const d = `${value.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(isoDate: string, days: number) {
  const ms = new Date(`${isoDate}T00:00:00`).getTime();
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function normalizeTrainingDay(day: string) {
  const short = day.trim().toLowerCase().slice(0, 3);
  return SHORT_TO_WEEKDAY[short] ?? null;
}

function inferRaceType(level: TemplateLevel, raceName: string): TemplateRaceType {
  const n = raceName.toLowerCase();
  if (n.includes('70.3') || n.includes('half')) return 'half';
  if (n.includes('olympic') || n.includes('standard')) return 'olympic';
  if (level === 'vinna') return 'half';
  if (level === 'orka') return 'olympic';
  return 'sprint';
}

function asRestDay(day: TemplateDay): TemplateDay {
  return {
    sport: 'rest',
    title: `Rest — ${day.title}`,
    durationMins: 0,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Rest day based on selected training availability.',
    coachNote: 'Rest supports consistency and adaptation.',
    blocks: [],
  };
}

function resolveTemplateDay(template: ReturnType<typeof getTemplateForLevel>, weekNumber: number, weekday: typeof WEEKDAY_KEYS[number]) {
  const entry =
    template.weeklyStructure.find((row) => weekNumber >= row.weekRange[0] && weekNumber <= row.weekRange[1]) ??
    template.weeklyStructure[template.weeklyStructure.length - 1];
  return entry.days[weekday];
}

async function replaceFuturePlannedSessionsInActivePlan(
  athleteId: string,
  generatedPlan: GeneratedPlan,
  todayIso: string
) {
  const { data: activePlan, error: activePlanError } = await supabase
    .from('plans')
    .select('id,start_date,end_date,total_weeks')
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activePlanError || !activePlan) {
    throw new Error(activePlanError?.message ?? 'No active plan found');
  }

  const { data: staleRows, error: staleRowsError } = await supabase
    .from('sessions')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('plan_id', activePlan.id)
    .eq('status', 'planned')
    .gte('scheduled_date', todayIso);
  if (staleRowsError) throw new Error(staleRowsError.message);
  const staleSessionIds = (staleRows ?? []).map((row) => row.id);

  if (staleSessionIds.length > 0) {
    const { data: staleBlocks, error: staleBlocksError } = await supabase
      .from('session_blocks')
      .select('id')
      .in('session_id', staleSessionIds);
    if (staleBlocksError) throw new Error(staleBlocksError.message);
    const staleBlockIds = (staleBlocks ?? []).map((row) => row.id);

    if (staleBlockIds.length > 0) {
      const { error: stepDeleteError } = await supabase.from('session_steps').delete().in('block_id', staleBlockIds);
      if (stepDeleteError) throw new Error(stepDeleteError.message);
    }

    const { error: blockDeleteError } = await supabase.from('session_blocks').delete().in('session_id', staleSessionIds);
    if (blockDeleteError) throw new Error(blockDeleteError.message);

    const { error: sessionDeleteError } = await supabase.from('sessions').delete().in('id', staleSessionIds);
    if (sessionDeleteError) throw new Error(sessionDeleteError.message);
  }

  const orderedSessions = [...generatedPlan.sessions].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const sessionRows = orderedSessions.map((session) => ({
    plan_id: activePlan.id,
    athlete_id: athleteId,
    title: session.title,
    sport: session.sport,
    scheduled_date: session.scheduledDate,
    duration_mins: session.durationMins,
    distance: session.distance,
    distance_unit: session.distanceUnit,
    intensity: session.intensity,
    description: session.description,
    coach_note: session.coachNote,
    status: 'planned',
    week_number: session.weekNumber,
    phase: generatedPlan.phase,
  }));
  const { data: insertedSessions, error: sessionInsertError } = await supabase
    .from('sessions')
    .insert(sessionRows)
    .select('id,scheduled_date,title');
  if (sessionInsertError || !insertedSessions) throw new Error(sessionInsertError?.message ?? 'Failed to insert sessions');

  const insertedByComposite = new Map<string, string>();
  for (const inserted of insertedSessions) {
    insertedByComposite.set(`${inserted.scheduled_date}|${inserted.title}`, inserted.id);
  }

  const blockRows: { session_id: string; block_type: string; title: string; order_index: number }[] = [];
  const blockSteps: { key: string; steps: string[] }[] = [];
  for (const session of orderedSessions) {
    const sessionId = insertedByComposite.get(`${session.scheduledDate}|${session.title}`);
    if (!sessionId) continue;
    session.blocks.forEach((block, idx) => {
      blockRows.push({
        session_id: sessionId,
        block_type: block.blockType,
        title: block.title,
        order_index: idx + 1,
      });
      blockSteps.push({ key: `${sessionId}|${idx}`, steps: block.steps });
    });
  }

  if (blockRows.length > 0) {
    const { data: insertedBlocks, error: blockInsertError } = await supabase
      .from('session_blocks')
      .insert(blockRows)
      .select('id,session_id,order_index');
    if (blockInsertError || !insertedBlocks) throw new Error(blockInsertError?.message ?? 'Failed to insert blocks');

    const blockIdByKey = new Map<string, string>();
    insertedBlocks.forEach((block) => {
      blockIdByKey.set(`${block.session_id}|${block.order_index - 1}`, block.id);
    });

    const stepRows: { block_id: string; step_text: string; order_index: number; is_checked: boolean }[] = [];
    for (const lookup of blockSteps) {
      const blockId = blockIdByKey.get(lookup.key);
      if (!blockId) continue;
      lookup.steps.forEach((step, idx) => {
        stepRows.push({ block_id: blockId, step_text: step, order_index: idx + 1, is_checked: false });
      });
    }
    if (stepRows.length > 0) {
      const { error: stepInsertError } = await supabase.from('session_steps').insert(stepRows);
      if (stepInsertError) throw new Error(stepInsertError.message);
    }
  }

  const planStart = activePlan.start_date && activePlan.start_date < todayIso ? activePlan.start_date : todayIso;
  const planEnd = orderedSessions.length > 0 ? orderedSessions[orderedSessions.length - 1].scheduledDate : activePlan.end_date;
  const planTotalWeeks = activePlan.total_weeks ?? generatedPlan.totalWeeks;
  const { error: planUpdateError } = await supabase
    .from('plans')
    .update({
      name: generatedPlan.planName,
      phase: generatedPlan.phase,
      start_date: planStart,
      end_date: planEnd,
      total_weeks: planTotalWeeks,
    })
    .eq('id', activePlan.id);
  if (planUpdateError) throw new Error(planUpdateError.message);

  void syncAppleCalendarIfEnabled(athleteId, new Date(todayIso));
}

export async function assignTemplatePlan(params: {
  athleteId: string;
  level: TemplateLevel;
  raceDate: string;
  raceName: string;
  trainingDays: string[];
  replaceFuturePlannedOnly?: boolean;
}): Promise<void> {
  const raceType = inferRaceType(params.level, params.raceName);
  const template = getTemplateForLevel(params.level, raceType);
  const todayIso = toIsoDate(new Date());

  const raceDate = params.raceDate || addDays(todayIso, template.totalWeeks * 7);
  const countedStart = addDays(raceDate, -template.totalWeeks * 7);
  const startIso = countedStart < todayIso ? todayIso : countedStart;

  const allowedDays = new Set(
    params.trainingDays
      .map(normalizeTrainingDay)
      .filter((value): value is typeof WEEKDAY_KEYS[number] => Boolean(value))
  );

  const sessions: GeneratedSession[] = [];
  for (let week = 1; week <= template.totalWeeks; week += 1) {
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const scheduledDate = addDays(startIso, (week - 1) * 7 + dayOffset);
      if (scheduledDate > raceDate) break;
      const weekday = WEEKDAY_KEYS[new Date(`${scheduledDate}T00:00:00`).getDay()];
      const templateDay = resolveTemplateDay(template, week, weekday);
      const sessionDay =
        allowedDays.size === 0 || templateDay.sport === 'rest' || allowedDays.has(weekday) ? templateDay : asRestDay(templateDay);
      sessions.push({
        weekNumber: week,
        scheduledDate,
        ...sessionDay,
      });
    }
  }

  const generatedPlan: GeneratedPlan = {
    planName: template.name,
    totalWeeks: template.totalWeeks,
    phase: template.phase,
    sessions,
  };

  if (params.replaceFuturePlannedOnly) {
    await replaceFuturePlannedSessionsInActivePlan(params.athleteId, generatedPlan, todayIso);
    return;
  }

  await supabase.from('plans').update({ status: 'archived' }).eq('athlete_id', params.athleteId).eq('status', 'active');
  await savePlanToDatabase(params.athleteId, generatedPlan);
}

