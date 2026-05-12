import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toLocalIsoDate } from '@/lib/dates';
import { supabase } from '@/lib/supabase';
import { generateWeeklyChallenges } from '@/services/generateWeeklyChallenges';
import { saveChallenges } from '@/services/saveChallenges';

const LAST_GENERATED_KEY = 'telo:rova:last-generated-at';

function isMondayWindow(now: Date) {
  return now.getDay() === 1 || now.getDay() === 0;
}

export function useWeeklyChallenges(athleteId: string | null | undefined) {
  const queryClient = useQueryClient();

  const generateNow = useMutation({
    mutationFn: async () => {
      if (!athleteId) throw new Error('No athlete selected.');
      const generated = await generateWeeklyChallenges(athleteId);
      const savedCount = await saveChallenges(athleteId, generated);
      try {
        await AsyncStorage.setItem(LAST_GENERATED_KEY, new Date().toISOString());
      } catch {
        /* ignore */
      }
      return savedCount;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rova_challenges'] });
    },
  });

  const maybeGenerateForWeek = useCallback(async () => {
    if (!athleteId) return false;
    const now = new Date();
    if (!isMondayWindow(now)) return false;
    let last: string | null = null;
    try {
      last = await AsyncStorage.getItem(LAST_GENERATED_KEY);
    } catch {
      last = null;
    }
    if (last) {
      const lastDate = new Date(last);
      const deltaDays = Math.floor((now.getTime() - lastDate.getTime()) / 86_400_000);
      if (deltaDays < 6) return false;
    }
    await generateNow.mutateAsync();
    return true;
  }, [athleteId, generateNow]);

  const todayIso = toLocalIsoDate(new Date());
  const todaysChallenge = useQuery({
    queryKey: ['rova_challenges', 'today', athleteId ?? 'none', todayIso] as const,
    enabled: Boolean(athleteId),
    queryFn: async () => {
      if (!athleteId) return null;
      const { data, error } = await supabase
        .from('rova_challenges')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('scheduled_date', todayIso)
        .in('status', ['pending', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  return {
    todaysChallenge,
    generateNow,
    maybeGenerateForWeek,
  };
}
