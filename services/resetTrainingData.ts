import { supabase } from '@/lib/supabase';

/** PostgREST `in()` lists that are too long can fail; stay well under typical limits. */
const IN_CHUNK = 150;

function chunkIds<T extends string>(ids: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

/**
 * Deletes planned sessions (blocks, steps), completion logs, derived progress data,
 * Rova weekly challenges, and flex-week history for one athlete. Does not remove
 * the active plan row, goal races, or the athlete profile.
 */
export async function resetTrainingDataForAthlete(athleteId: string): Promise<void> {
  const { data: sessionRows, error: sessionsReadError } = await supabase
    .from('sessions')
    .select('id')
    .eq('athlete_id', athleteId);
  if (sessionsReadError) throw new Error(sessionsReadError.message);

  const sessionIds = (sessionRows ?? []).map((row) => row.id);

  const { error: deletePersonalBestsError } = await supabase.from('personal_bests').delete().eq('athlete_id', athleteId);
  if (deletePersonalBestsError) throw new Error(deletePersonalBestsError.message);

  for (const sessionChunk of chunkIds(sessionIds, IN_CHUNK)) {
    if (sessionChunk.length === 0) continue;

    const { data: blockRows, error: blockReadError } = await supabase
      .from('session_blocks')
      .select('id')
      .in('session_id', sessionChunk);
    if (blockReadError) throw new Error(blockReadError.message);

    const blockIds = (blockRows ?? []).map((row) => row.id);
    for (const blockChunk of chunkIds(blockIds, IN_CHUNK)) {
      if (blockChunk.length === 0) continue;
      const { error: deleteStepsError } = await supabase.from('session_steps').delete().in('block_id', blockChunk);
      if (deleteStepsError) throw new Error(deleteStepsError.message);
    }

    const { error: deleteBlocksError } = await supabase.from('session_blocks').delete().in('session_id', sessionChunk);
    if (deleteBlocksError) throw new Error(deleteBlocksError.message);

    const { error: deleteLogsError } = await supabase.from('session_logs').delete().in('session_id', sessionChunk);
    if (deleteLogsError) throw new Error(deleteLogsError.message);
  }

  const { error: deleteAnyRemainingLogsError } = await supabase.from('session_logs').delete().eq('athlete_id', athleteId);
  if (deleteAnyRemainingLogsError) throw new Error(deleteAnyRemainingLogsError.message);

  const { error: deleteSessionsError } = await supabase.from('sessions').delete().eq('athlete_id', athleteId);
  if (deleteSessionsError) throw new Error(deleteSessionsError.message);

  const { error: deleteChallengesError } = await supabase.from('rova_challenges').delete().eq('athlete_id', athleteId);
  if (deleteChallengesError) throw new Error(deleteChallengesError.message);

  const { error: deleteFlexHistoryError } = await supabase.from('flex_history').delete().eq('athlete_id', athleteId);
  if (deleteFlexHistoryError) throw new Error(deleteFlexHistoryError.message);

  const { error: deleteReflectionsError } = await supabase.from('daily_reflections').delete().eq('athlete_id', athleteId);
  if (deleteReflectionsError) throw new Error(deleteReflectionsError.message);

  const { error: deleteHabitsError } = await supabase.from('journal_habits').delete().eq('athlete_id', athleteId);
  if (deleteHabitsError) throw new Error(deleteHabitsError.message);
}
