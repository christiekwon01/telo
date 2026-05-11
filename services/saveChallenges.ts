import { supabase } from '@/lib/supabase';
import type { Challenge } from '@/services/rova-types';

const ALLOWED_CHALLENGE_TYPES = new Set<Challenge['type']>([
  'movement',
  'recovery',
  'social',
  'exploration',
  'benchmark',
]);

function ensureIsoDate(date: string, fallback: Date): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : toLocalIsoDate(fallback);
}

function toLocalIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function saveChallenges(athleteId: string, challenges: Challenge[]): Promise<number> {
  if (!athleteId?.trim()) {
    throw new Error('Cannot save challenges: athlete id is missing.');
  }
  if (challenges.length === 0) return 0;

  const rows = challenges
    .map((challenge, index) => {
      const type = challenge.type?.toLowerCase() as Challenge['type'];
      if (!ALLOWED_CHALLENGE_TYPES.has(type)) return null;
      const title = challenge.title?.trim();
      const description = challenge.description?.trim();
      if (!title || !description) return null;
      const fallbackDate = new Date();
      fallbackDate.setDate(fallbackDate.getDate() + index + 1);
      return {
        athlete_id: athleteId,
        challenge_type: type,
        title,
        description,
        scheduled_date: ensureIsoDate(challenge.suggestedDate, fallbackDate),
        status: 'pending',
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (rows.length === 0) {
    throw new Error('Challenge payload was invalid after normalization.');
  }

  const { error } = await supabase.from('rova_challenges').insert(rows);
  if (error) {
    throw new Error(`Failed to insert ${rows.length} challenge(s): ${error.message}`);
  }
  return rows.length;
}
