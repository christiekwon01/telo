import { isAnthropicEnabled } from '@/lib/anthropic';

/** AI-generated training highlights for the Progress screen period view. */

const MODEL = 'claude-sonnet-4-20250514';

function stripCodeFences(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

export type HighlightsContext = {
  athleteName: string;
  periodLabel: string;
  /** One line per logged session — keep ≤ ~50 rows in caller. */
  sessionLines: string;
  sessionCount: number;
};

/**
 * Calls Claude once; returns empty array when no sessions or parsing fails (caller may use fallback bullets).
 */
export async function fetchRovaPeriodHighlights(ctx: HighlightsContext): Promise<string[]> {
  if (!isAnthropicEnabled()) return [];
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey || ctx.sessionCount === 0) return [];

  const userBlock =
    ctx.sessionLines.trim().length > 0
      ? ctx.sessionLines
      : '(No structured rows — infer only from counts below.)';

  const prompt = `You are **Rova**, the Telo app's coach voice — warm, sharp, concise.

Athlete: **${ctx.athleteName}**
Period: **${ctx.periodLabel}**
Sessions completed in period: **${ctx.sessionCount}**

Here is ONE line per completed session (most recent listed first):
${userBlock}

Task: Write **3 to 5** highlight lines for the app's "Highlights" card. Celebrate patterns (longest outing, standout duration, brisk pace sessions when distance/time allow, hardest RPE, sport balance, streaks suggested by dates). Invent nothing — only cite what plausibly follows from the data. If pace cannot be inferred safely, phrase as effort/duration/volume instead.
Each highlight is ONE short sentence, under 140 characters, ending without trailing lists.

Respond with **ONLY** valid JSON, no prose:
{"highlights":["...","..."]}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 768,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Highlights failed (${response.status}): ${err}`);
  }

  const payload = await response.json();
  const text =
    (payload?.content as { type?: string; text?: string }[] | undefined)?.find((p) => p.type === 'text')
      ?.text ?? '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    return [];
  }

  const arr =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).highlights)
      ? ((parsed as { highlights: unknown }).highlights as unknown[])
      : [];

  return arr
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim());
}
