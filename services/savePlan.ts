import { supabase } from '@/lib/supabase';
import { syncAppleCalendarIfEnabled } from '@/services/appleCalendarSync';
import type { GeneratedPlan } from '@/services/plan-types';

export async function savePlanToDatabase(athleteId: string, generatedPlan: GeneratedPlan): Promise<void> {
  if (!generatedPlan.sessions.length) {
    throw new Error('Generated plan has no sessions to save.');
  }

  const orderedSessions = [...generatedPlan.sessions].sort((a, b) =>
    a.scheduledDate.localeCompare(b.scheduledDate)
  );
  const startDate = orderedSessions[0].scheduledDate;
  const endDate = orderedSessions[orderedSessions.length - 1].scheduledDate;

  const { data: planInsert, error: planError } = await supabase
    .from('plans')
    .insert({
      athlete_id: athleteId,
      name: generatedPlan.planName,
      phase: generatedPlan.phase,
      start_date: startDate,
      end_date: endDate,
      total_weeks: generatedPlan.totalWeeks,
      status: 'active',
    })
    .select('id')
    .single();

  if (planError || !planInsert) throw new Error(planError?.message ?? 'Failed to create plan.');
  const planId = planInsert.id;

  const sessionRows = orderedSessions.map((session) => ({
    plan_id: planId,
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

  const { data: insertedSessions, error: sessionError } = await supabase
    .from('sessions')
    .insert(sessionRows)
    .select('id, scheduled_date, title');

  if (sessionError || !insertedSessions) {
    await supabase.from('plans').delete().eq('id', planId);
    throw new Error(sessionError?.message ?? 'Failed to insert sessions.');
  }

  const sessionIdByComposite = new Map<string, string>();
  for (const dbSession of insertedSessions) {
    sessionIdByComposite.set(`${dbSession.scheduled_date}|${dbSession.title}`, dbSession.id);
  }

  const blockRows: { session_id: string; block_type: string; title: string; order_index: number }[] = [];
  const blockStepLookup: { key: string; steps: string[] }[] = [];

  orderedSessions.forEach((session) => {
    const sessionId = sessionIdByComposite.get(`${session.scheduledDate}|${session.title}`);
    if (!sessionId) return;
    session.blocks.forEach((block, blockIdx) => {
      const key = `${sessionId}|${blockIdx}`;
      blockRows.push({
        session_id: sessionId,
        block_type: block.blockType,
        title: block.title,
        order_index: blockIdx + 1,
      });
      blockStepLookup.push({ key, steps: block.steps });
    });
  });

  const { data: insertedBlocks, error: blockError } = await supabase
    .from('session_blocks')
    .insert(blockRows)
    .select('id, session_id, order_index');

  if (blockError || !insertedBlocks) {
    await supabase.from('sessions').delete().eq('plan_id', planId);
    await supabase.from('plans').delete().eq('id', planId);
    throw new Error(blockError?.message ?? 'Failed to insert session blocks.');
  }

  const blockIdByKey = new Map<string, string>();
  insertedBlocks.forEach((block) => {
    blockIdByKey.set(`${block.session_id}|${block.order_index - 1}`, block.id);
  });

  const stepRows: { block_id: string; step_text: string; order_index: number; is_checked: boolean }[] = [];
  blockStepLookup.forEach((entry) => {
    const blockId = blockIdByKey.get(entry.key);
    if (!blockId) return;
    entry.steps.forEach((step, idx) => {
      stepRows.push({
        block_id: blockId,
        step_text: step,
        order_index: idx + 1,
        is_checked: false,
      });
    });
  });

  if (stepRows.length > 0) {
    const { error: stepError } = await supabase.from('session_steps').insert(stepRows);
    if (stepError) {
      await supabase.from('sessions').delete().eq('plan_id', planId);
      await supabase.from('plans').delete().eq('id', planId);
      throw new Error(stepError.message);
    }
  }

  void syncAppleCalendarIfEnabled(athleteId, new Date(startDate));
}
