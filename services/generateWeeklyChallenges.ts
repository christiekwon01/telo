import { supabase } from '@/lib/supabase';
import { isAnthropicEnabled } from '@/lib/anthropic';
import type { Challenge } from '@/services/rova-types';
import { fallbackChallenges } from '@/services/rova-types';

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(base.getDate() + days);
  return next;
}

const ALLOWED_CHALLENGE_TYPES = new Set<Challenge['type']>([
  'movement',
  'recovery',
  'social',
  'exploration',
  'benchmark',
]);

function normalizeChallengeType(value: unknown): Challenge['type'] {
  if (typeof value !== 'string') return 'exploration';
  const normalized = value.trim().toLowerCase();
  if (ALLOWED_CHALLENGE_TYPES.has(normalized as Challenge['type'])) {
    return normalized as Challenge['type'];
  }
  return 'exploration';
}

function normalizeSuggestedDate(value: unknown, fallbackDate: Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return toIsoDate(fallbackDate);
}

function safeParseChallenges(raw: string): Challenge[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Expected challenge array.');
  const normalized = parsed
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.title === 'string' && typeof item.description === 'string')
    .map((item, index) => {
      const fallbackDate = shiftDate(new Date(), index + 1);
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const description = typeof item.description === 'string' ? item.description.trim() : '';
      return {
        type: normalizeChallengeType(item.type),
        title,
        description,
        suggestedDate: normalizeSuggestedDate(item.suggestedDate, fallbackDate),
      } satisfies Challenge;
    })
    .filter((item) => item.title.length > 0 && item.description.length > 0);
  if (normalized.length === 0) throw new Error('No valid challenges parsed.');
  return normalized;
}

function buildFallbackChallenge(today: Date): Challenge[] {
  const selected = fallbackChallenges[Math.floor(Math.random() * fallbackChallenges.length)];
  return [
    {
      ...selected,
      suggestedDate: toIsoDate(shiftDate(today, 1)),
    },
  ];
}

export async function generateWeeklyChallenges(athleteId: string): Promise<Challenge[]> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing EXPO_PUBLIC_ANTHROPIC_API_KEY. Add it to your .env file.');
  }
  if (!athleteId?.trim()) {
    throw new Error('Cannot generate challenges without a valid athlete id.');
  }

  const now = new Date();
  const sevenDaysAgo = shiftDate(now, -7);
  const fromIso = toIsoDate(sevenDaysAgo);
  const toIso = toIsoDate(now);

  const [logsResult, sessionsResult] = await Promise.all([
    supabase
      .from('session_logs')
      .select(
        'id, rpe, sessions!inner(id,sport,scheduled_date,status)'
      )
      .eq('athlete_id', athleteId)
      .gte('completed_at', `${fromIso}T00:00:00.000Z`)
      .lte('completed_at', `${toIso}T23:59:59.999Z`),
    supabase
      .from('sessions')
      .select('id,sport,status')
      .eq('athlete_id', athleteId)
      .gte('scheduled_date', fromIso)
      .lte('scheduled_date', toIso),
  ]);

  const completedCount = (logsResult.data ?? []).length;
  const plannedCount = (sessionsResult.data ?? []).length;
  const sports = { swim: 0, bike: 0, run: 0, brick: 0, gym: 0, rest: 0 };
  let rpeSum = 0;
  let rpeCount = 0;
  let hasFatigue = false;

  for (const log of logsResult.data ?? []) {
    const sport = (log as any).sessions?.sport as keyof typeof sports | undefined;
    if (sport && sport in sports) sports[sport] += 1;
    if (typeof log.rpe === 'number') {
      rpeSum += log.rpe;
      rpeCount += 1;
      if (log.rpe >= 8) hasFatigue = true;
    }
  }

  const avgRPE = rpeCount > 0 ? Number((rpeSum / rpeCount).toFixed(1)) : null;
  const completionRate = plannedCount > 0 ? Math.round((completedCount / plannedCount) * 100) : 0;
  const sportBreakdown = Object.entries(sports)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const prompt = `You are Rova, an intelligent training companion for a triathlete.
Based on the athlete's last week of training, generate 4-6 mini challenges for the upcoming week.

Last week's data:
- Sessions completed: ${completedCount} / ${plannedCount}
- Sports breakdown: ${sportBreakdown}
- Average RPE: ${avgRPE ?? 'not tracked'}
- High fatigue signals: ${hasFatigue ? 'yes' : 'no'}
- Completion rate: ${completionRate}%

Challenge guidelines:
- Keep them short (10-30 minutes max)
- Mix challenge types: movement, recovery, social, exploration, benchmark
- If completion rate is low: offer easier/motivational challenges
- If RPE is high: prioritize recovery challenges
- If one sport is missing: suggest that sport as exploration
- Make them feel like optional fun, not mandatory training
- Tone: encouraging, slightly playful, coach-like

Return ONLY valid JSON array:
[
  {
    "type": "recovery",
    "title": "Ice bath challenge",
    "description": "3 minutes in cold water post-run. Your legs will thank you.",
    "suggestedDate": "${toIsoDate(shiftDate(now, 1))}"
  }
]`;

  if (!isAnthropicEnabled() || apiKey === 'your_api_key_here') {
    return buildFallbackChallenge(now);
  }

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
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      return buildFallbackChallenge(now);
    }

    const payload = await response.json();
    const text = payload?.content?.find((part: { type?: string }) => part.type === 'text')?.text ?? '';
    if (!text) return buildFallbackChallenge(now);
    return safeParseChallenges(text);
  } catch (error) {
    if (__DEV__) {
      console.warn('[generateWeeklyChallenges] Falling back to generic challenge set.', error);
    }
    return buildFallbackChallenge(now);
  }
}
