import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

export type DailyReflectionRow = Database['public']['Tables']['daily_reflections']['Row'];
export type HabitExportRow = { id: string; name: string; icon_emoji: string };

export type SessionExportRow = Pick<
  Database['public']['Tables']['sessions']['Row'],
  'title' | 'sport' | 'scheduled_date' | 'duration_mins' | 'status'
> & {
  session_logs: unknown;
};

export async function fetchJournalExportBundle(params: {
  athleteId: string;
  fromIso: string;
  toIso: string;
}): Promise<{
  reflections: DailyReflectionRow[];
  habits: HabitExportRow[];
  completions: { habit_id: string; completion_date: string }[];
  sessions: SessionExportRow[];
}> {
  const { athleteId, fromIso, toIso } = params;

  const [{ data: reflections, error: rErr }, { data: habits, error: hErr }] = await Promise.all([
    supabase
      .from('daily_reflections')
      .select('*')
      .eq('athlete_id', athleteId)
      .gte('entry_date', fromIso)
      .lte('entry_date', toIso)
      .order('entry_date', { ascending: true }),
    supabase.from('journal_habits').select('id, name, icon_emoji').eq('athlete_id', athleteId).is('archived_at', null),
  ]);
  if (rErr) throw new Error(rErr.message);
  if (hErr) throw new Error(hErr.message);

  const habitIds = (habits ?? []).map((h) => h.id);
  let completions: { habit_id: string; completion_date: string }[] = [];
  if (habitIds.length > 0) {
    const { data: compRows, error: cErr } = await supabase
      .from('journal_habit_completions')
      .select('habit_id, completion_date')
      .in('habit_id', habitIds)
      .gte('completion_date', fromIso)
      .lte('completion_date', toIso);
    if (cErr) throw new Error(cErr.message);
    completions = compRows ?? [];
  }

  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('title, sport, scheduled_date, duration_mins, status, session_logs(id, completed_at)')
    .eq('athlete_id', athleteId)
    .gte('scheduled_date', fromIso)
    .lte('scheduled_date', toIso)
    .order('scheduled_date', { ascending: true });
  if (sErr) throw new Error(sErr.message);

  return {
    reflections: (reflections ?? []) as DailyReflectionRow[],
    habits: (habits ?? []) as HabitExportRow[],
    completions,
    sessions: (sessions ?? []) as SessionExportRow[],
  };
}

export function eachDateInExportRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const endTime = new Date(ty, tm - 1, td).getTime();
  while (cur.getTime() <= endTime) {
    out.push(
      cur.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    );
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
