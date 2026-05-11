import { supabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/supabase';
import type { FlexConstraints, FlexReason, ReshuffledPlan } from '@/services/flexWeek';

type ApplyReshuffledPlanParams = {
  athleteId: string;
  weekStartDate: string;
  reason: FlexReason;
  constraints: FlexConstraints;
  reshuffledPlan: ReshuffledPlan;
  overrideLimit: boolean;
};

export async function applyReshuffledPlan(params: ApplyReshuffledPlanParams) {
  const normalizedMoves = params.reshuffledPlan.movedSessions.filter((item) => item.toDate !== item.fromDate);
  const movedIdSet = new Set(normalizedMoves.map((item) => item.sessionId));
  const normalizedDrops = params.reshuffledPlan.droppedSessions.filter((item) => !movedIdSet.has(item.sessionId));
  const movedSessionIds = normalizedMoves.map((item) => item.sessionId);
  const droppedSessionIds = normalizedDrops.map((item) => item.sessionId);

  const detailParts: string[] = [];
  if ((params.constraints.travelDays ?? []).length > 0) {
    detailParts.push(`travel:${params.constraints.travelDays?.join(',')}`);
  }
  if ((params.constraints.busyDays ?? []).length > 0) {
    detailParts.push(`busy:${params.constraints.busyDays?.join(',')}`);
  }
  if (typeof params.constraints.tiredness === 'number') {
    detailParts.push(`tiredness:${params.constraints.tiredness}`);
  }
  if (params.constraints.otherNotes) {
    detailParts.push(params.constraints.otherNotes);
  }

  const flexHistoryRow: Database['public']['Tables']['flex_history']['Insert'] = {
    athlete_id: params.athleteId,
    week_start_date: params.weekStartDate,
    reason: params.reason,
    reason_detail: detailParts.join(' | ') || null,
    override_limit: params.overrideLimit,
    ai_status: params.reshuffledPlan.aiStatus,
    moved_count: movedSessionIds.length,
    dropped_count: droppedSessionIds.length,
    original_snapshot: params.reshuffledPlan.before as unknown as Json,
    reshuffled_snapshot: params.reshuffledPlan as unknown as Json,
  };

  const { error: historyError } = await supabase.from('flex_history').insert(flexHistoryRow);

  if (historyError) {
    throw new Error(historyError.message);
  }

  for (const move of normalizedMoves) {
    const { error } = await supabase
      .from('sessions')
      .update({ scheduled_date: move.toDate })
      .eq('id', move.sessionId)
      .eq('athlete_id', params.athleteId);
    if (error) throw new Error(error.message);
  }

  if (droppedSessionIds.length > 0) {
    const { error } = await supabase.from('sessions').update({ status: 'skipped' }).eq('athlete_id', params.athleteId).in('id', droppedSessionIds);
    if (error) throw new Error(error.message);
  }
}
