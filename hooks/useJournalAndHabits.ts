import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toLocalIsoDate } from '@/lib/dates';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

export const journalQueryKeys = {
  all: ['journal'] as const,
  reflection: (athleteId: string, dateIso: string) => [...journalQueryKeys.all, 'reflection', athleteId, dateIso] as const,
  habits: (athleteId: string) => [...journalQueryKeys.all, 'habits', athleteId] as const,
  month: (athleteId: string, year: number, month: number) => [...journalQueryKeys.all, 'month', athleteId, year, month] as const,
  streakData: (athleteId: string) => [...journalQueryKeys.all, 'streak', athleteId] as const,
};

type HabitRow = Database['public']['Tables']['journal_habits']['Row'];

const DEFAULT_HABITS: { name: string; icon_emoji: string; sort_order: number }[] = [
  { name: 'Hydration', icon_emoji: '💧', sort_order: 0 },
  { name: 'Sleep 7+ hours', icon_emoji: '🛌', sort_order: 1 },
  { name: 'Nutrition logged', icon_emoji: '🥗', sort_order: 2 },
  { name: 'Stretching', icon_emoji: '🧘', sort_order: 3 },
  { name: 'Journal entry', icon_emoji: '📖', sort_order: 4 },
];

export async function ensureDefaultHabits(athleteId: string): Promise<void> {
  const { count, error: cErr } = await supabase
    .from('journal_habits')
    .select('id', { count: 'exact', head: true })
    .eq('athlete_id', athleteId)
    .is('archived_at', null);
  if (cErr) throw new Error(cErr.message);
  if ((count ?? 0) > 0) return;

  const rows = DEFAULT_HABITS.map((h) => ({
    athlete_id: athleteId,
    name: h.name,
    icon_emoji: h.icon_emoji,
    sort_order: h.sort_order,
  }));
  const { error } = await supabase.from('journal_habits').insert(rows);
  if (error) throw new Error(error.message);
}

export function useJournalHabits(athleteId: string | null | undefined) {
  return useQuery({
    queryKey: journalQueryKeys.habits(athleteId ?? 'none'),
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return [];
      await ensureDefaultHabits(athleteId);
      const { data, error } = await supabase
        .from('journal_habits')
        .select('*')
        .eq('athlete_id', athleteId)
        .is('archived_at', null)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as HabitRow[];
    },
  });
}

export function useDailyReflectionQuery(athleteId: string | null | undefined, entryDateIso: string) {
  return useQuery({
    queryKey: journalQueryKeys.reflection(athleteId ?? 'none', entryDateIso),
    enabled: Boolean(athleteId) && Boolean(entryDateIso),
    queryFn: async () => {
      if (!athleteId) return null;
      const { data, error } = await supabase
        .from('daily_reflections')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('entry_date', entryDateIso)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Database['public']['Tables']['daily_reflections']['Row'] | null;
    },
  });
}

export type MonthJournalBundle = {
  reflectionDates: Set<string>;
  habitCompletionsByDate: Map<string, Set<string>>;
};

export function useMonthJournalIndicators(athleteId: string | null | undefined, year: number, month: number) {
  const fromDate = new Date(year, month, 1);
  const toDate = new Date(year, month + 1, 0);
  const fromIso = toLocalIsoDate(fromDate);
  const toIso = toLocalIsoDate(toDate);

  return useQuery({
    queryKey: journalQueryKeys.month(athleteId ?? 'none', year, month),
    enabled: Boolean(athleteId),
    queryFn: async (): Promise<MonthJournalBundle> => {
      if (!athleteId) {
        return { reflectionDates: new Set(), habitCompletionsByDate: new Map() };
      }

      const [{ data: refl, error: rErr }, { data: habits, error: hErr }, { data: comps, error: cErr }] =
        await Promise.all([
          supabase
            .from('daily_reflections')
            .select('entry_date')
            .eq('athlete_id', athleteId)
            .gte('entry_date', fromIso)
            .lte('entry_date', toIso),
          supabase.from('journal_habits').select('id').eq('athlete_id', athleteId).is('archived_at', null),
          supabase
            .from('journal_habit_completions')
            .select('habit_id, completion_date')
            .gte('completion_date', fromIso)
            .lte('completion_date', toIso),
        ]);

      if (rErr) throw new Error(rErr.message);
      if (hErr) throw new Error(hErr.message);
      if (cErr) throw new Error(cErr.message);

      const habitIds = new Set((habits ?? []).map((h) => h.id));
      const reflectionDates = new Set((refl ?? []).map((r) => r.entry_date));
      const habitCompletionsByDate = new Map<string, Set<string>>();
      for (const row of comps ?? []) {
        if (!habitIds.has(row.habit_id)) continue;
        const set = habitCompletionsByDate.get(row.completion_date) ?? new Set();
        set.add(row.habit_id);
        habitCompletionsByDate.set(row.completion_date, set);
      }

      return { reflectionDates, habitCompletionsByDate };
    },
  });
}

export function useJournalStreakData(athleteId: string | null | undefined) {
  const anchor = new Date();
  anchor.setDate(anchor.getDate() - 400);
  const fromIso = toLocalIsoDate(anchor);

  return useQuery({
    queryKey: journalQueryKeys.streakData(athleteId ?? 'none'),
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) {
        return {
          habitCompletionByHabit: new Map<string, Set<string>>(),
          reflectionDates: new Set<string>(),
        };
      }

      const { data: habits, error: hErr } = await supabase
        .from('journal_habits')
        .select('id')
        .eq('athlete_id', athleteId)
        .is('archived_at', null);
      if (hErr) throw new Error(hErr.message);
      const habitIds = (habits ?? []).map((h) => h.id);
      const habitCompletionByHabit = new Map<string, Set<string>>();
      if (habitIds.length === 0) {
        const { data: reflOnly, error: r0 } = await supabase
          .from('daily_reflections')
          .select('entry_date')
          .eq('athlete_id', athleteId)
          .gte('entry_date', fromIso);
        if (r0) throw new Error(r0.message);
        return {
          habitCompletionByHabit,
          reflectionDates: new Set((reflOnly ?? []).map((r) => r.entry_date)),
        };
      }

      const [{ data: comps, error: cErr }, { data: refl, error: rErr }] = await Promise.all([
        supabase
          .from('journal_habit_completions')
          .select('habit_id, completion_date')
          .in('habit_id', habitIds)
          .gte('completion_date', fromIso),
        supabase
          .from('daily_reflections')
          .select('entry_date')
          .eq('athlete_id', athleteId)
          .gte('entry_date', fromIso),
      ]);
      if (cErr) throw new Error(cErr.message);
      if (rErr) throw new Error(rErr.message);

      for (const row of comps ?? []) {
        const set = habitCompletionByHabit.get(row.habit_id) ?? new Set();
        set.add(row.completion_date);
        habitCompletionByHabit.set(row.habit_id, set);
      }

      return {
        habitCompletionByHabit,
        reflectionDates: new Set((refl ?? []).map((r) => r.entry_date)),
      };
    },
  });
}

export function useUpsertReflectionMutation(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      entry_date: string;
      body_text: string;
      mood: number;
      energy: number;
      sleep_quality: number | null;
    }) => {
      if (!athleteId) throw new Error('No athlete');
      const row = {
        athlete_id: athleteId,
        entry_date: payload.entry_date,
        body_text: payload.body_text,
        mood: payload.mood,
        energy: payload.energy,
        sleep_quality: payload.sleep_quality,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('daily_reflections').upsert(row, { onConflict: 'athlete_id,entry_date' });
      if (error) throw new Error(error.message);
    },
    onSuccess: async (_, vars) => {
      if (!athleteId) return;
      const y = Number(vars.entry_date.slice(0, 4));
      const m = Number(vars.entry_date.slice(5, 7)) - 1;
      await Promise.all([
        qc.invalidateQueries({ queryKey: journalQueryKeys.reflection(athleteId, vars.entry_date) }),
        qc.invalidateQueries({ queryKey: journalQueryKeys.month(athleteId, y, m) }),
        qc.invalidateQueries({ queryKey: journalQueryKeys.streakData(athleteId) }),
      ]);
    },
  });
}

export function useToggleHabitCompletionMutation(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: { habitId: string; dateIso: string; completed: boolean }) => {
      if (!athleteId) throw new Error('No athlete');
      if (opts.completed) {
        const { error } = await supabase.from('journal_habit_completions').insert({
          habit_id: opts.habitId,
          completion_date: opts.dateIso,
        });
        if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('journal_habit_completions')
          .delete()
          .eq('habit_id', opts.habitId)
          .eq('completion_date', opts.dateIso);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: async (_, opts) => {
      if (!athleteId) return;
      const y = Number(opts.dateIso.slice(0, 4));
      const m = Number(opts.dateIso.slice(5, 7)) - 1;
      await Promise.all([
        qc.invalidateQueries({ queryKey: journalQueryKeys.habits(athleteId) }),
        qc.invalidateQueries({ queryKey: journalQueryKeys.month(athleteId, y, m) }),
        qc.invalidateQueries({ queryKey: journalQueryKeys.streakData(athleteId) }),
      ]);
    },
  });
}

export function useCreateHabitMutation(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; icon_emoji: string }) => {
      if (!athleteId) throw new Error('No athlete');
      const { error } = await supabase.from('journal_habits').insert({
        athlete_id: athleteId,
        name: payload.name.trim(),
        icon_emoji: payload.icon_emoji.trim() || '✓',
        sort_order: 99,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      if (!athleteId) return;
      await qc.invalidateQueries({ queryKey: journalQueryKeys.habits(athleteId) });
    },
  });
}

export function useArchiveHabitMutation(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (habitId: string) => {
      const { error } = await supabase.from('journal_habits').update({ archived_at: new Date().toISOString() }).eq('id', habitId);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      if (!athleteId) return;
      await qc.invalidateQueries({ queryKey: journalQueryKeys.habits(athleteId) });
    },
  });
}

/** Consecutive calendar days present in `completedDates`, counting backwards from anchorDateIso (inclusive). */
export function calendarDayStreak(completedDates: Set<string>, anchorDateIso: string): number {
  const [y, mo, d] = anchorDateIso.split('-').map(Number);
  const cur = new Date(y, mo - 1, d);
  let streak = 0;
  for (;;) {
    const iso = toLocalIsoDate(cur);
    if (completedDates.has(iso)) {
      streak += 1;
      cur.setDate(cur.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export function daysReflectedInMonth(reflectionDates: Set<string>, year: number, month: number): number {
  let n = 0;
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d += 1) {
    const iso = toLocalIsoDate(new Date(year, month, d));
    if (reflectionDates.has(iso)) n += 1;
  }
  return n;
}
