import type { GeneratePlanParams, GeneratedPlan } from '@/services/plan-types';
import { isAnthropicEnabled } from '@/lib/anthropic';

function daysUntilRace(raceDateIso: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const raceDate = new Date(raceDateIso);
  raceDate.setHours(0, 0, 0, 0);
  return Math.max(7, Math.floor((raceDate.getTime() - now.getTime()) / 86_400_000));
}

function clampWeeks(level: GeneratePlanParams['level'], raceDateIso: string) {
  const rawWeeks = Math.max(1, Math.ceil(daysUntilRace(raceDateIso) / 7));
  const maxWeeks = level === 'fara' ? 12 : 16;
  return Math.min(maxWeeks, rawWeeks);
}

function stripCodeFences(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return trimmed;
}

function assertGeneratedPlanShape(value: unknown): asserts value is GeneratedPlan {
  if (!value || typeof value !== 'object') throw new Error('Malformed plan payload.');
  const maybe = value as GeneratedPlan;
  if (!maybe.planName || !Array.isArray(maybe.sessions)) throw new Error('Missing planName or sessions.');
}

export async function generateTrainingPlan(params: GeneratePlanParams): Promise<GeneratedPlan> {
  // V2: Replace assignTemplatePlan with generateTrainingPlan when Anthropic credits available.
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing EXPO_PUBLIC_ANTHROPIC_API_KEY. Add it to your .env file.');
  }
  if (!isAnthropicEnabled()) {
    throw new Error('Plan generation is temporarily archived while Anthropic prompts are disabled.');
  }

  const weeksUntilRace = clampWeeks(params.level, params.raceDate);
  const levelDescription =
    params.level === 'fara'
      ? 'complete beginner'
      : params.level === 'orka'
        ? 'building consistency'
        : 'performance-focused';
  const sportBackgroundSummary = [
    `swim: ${params.sportBackgrounds?.swim ?? 'beginner'}`,
    `bike: ${params.sportBackgrounds?.bike ?? 'beginner'}`,
    `run: ${params.sportBackgrounds?.run ?? 'beginner'}`,
  ].join(', ');
  const raceStack =
    params.upcomingRaces && params.upcomingRaces.length > 0
      ? params.upcomingRaces
          .map(
            (race) =>
              `- ${race.name} (${(race.raceType ?? 'event').replace(/-/g, ' ')}, ${race.priority.toUpperCase()} race) - ${race.date}`
          )
          .join('\n')
      : `- ${params.raceName} (event, A race) - ${params.raceDate}`;

  const prompt = `You are an expert triathlon coach creating a training
plan for a ${params.level}-level athlete (${levelDescription}).

Athlete: ${params.athleteName}
Goal race: ${params.raceName} on ${params.raceDate}
Training days available: ${params.trainingDays.join(', ')}
Life constraints: ${params.lifeCommitments.join(', ') || 'none'}
Sport-specific background: ${sportBackgroundSummary}
Upcoming races:
${raceStack}

Create a ${weeksUntilRace}-week training plan that:
- Builds from base aerobic fitness (Zone 1-2 focus first 4 weeks)
- Includes swim, bike, run, and brick sessions
- Respects available training days (never schedule on unavailable days)
- Includes deload weeks every 3-4 weeks
- Adapts to life constraints (shorter sessions if young kids, flexible timing if traveling)
- Progressively builds volume and intensity toward race day
- Includes proper taper in final week
- Treat level as permanent athlete maturity and phase as plan-cycle context
- Scale each sport session by that sport's background:
  - beginner: simpler structure, conservative load, extra technique cues
  - experienced: moderate complexity and progression
  - competitive: advanced structure, stronger quality targets and progression
- If one sport is competitive but athlete level is fara (first triathlon), keep plan triathlon-safe overall while allowing advanced work in that specific sport only
- Build around race priorities:
  - A race: full taper (7-14 days), peak freshness
  - B race: train through with a lighter lead-in week, no full taper
  - C race: treat as hard training stimulus, no taper
- Shift weekly emphasis by proximity:
  - 10+ weeks from next A race: balanced tri base
  - 8-10 weeks from next A race: emphasize A-race discipline demands
  - final 2 weeks before B race: slight volume reduction, keep quality
  - week of C race: keep structure and treat race as key workout

For each session provide:
- Sport (swim/bike/run/brick/rest)
- Title (concise, descriptive)
- Duration in minutes
- Distance (if applicable) with unit (m or km)
- Intensity (easy/steady/tempo/threshold/intervals)
- Description (1 sentence overview)
- Coach note (1-2 sentences explaining why this session matters)
- Session blocks array with:
  - blockType (warmup/main/cooldown)
  - title
  - steps array (individual instructions, 1 per line)

Return ONLY valid JSON in this exact structure:
{
  "planName": "12-Week Sprint Triathlon - Fara",
  "totalWeeks": 12,
  "phase": "base",
  "sessions": [
    {
      "weekNumber": 1,
      "scheduledDate": "2026-07-06",
      "sport": "rest",
      "title": "Active recovery",
      "durationMins": 30,
      "distance": null,
      "distanceUnit": null,
      "intensity": "easy",
      "description": "Light walk or mobility work",
      "coachNote": "Recovery is training. Let your body adapt.",
      "blocks": [
        {
          "blockType": "main",
          "title": "Recovery activity",
          "steps": [
            "20-30 minute easy walk",
            "Optional: 10 minutes of stretching or foam rolling"
          ]
        }
      ]
    }
  ]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const failure = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error('Anthropic API key is invalid. Create a valid key at console.anthropic.com.');
    }
    let billingHint = '';
    try {
      const parsed = JSON.parse(failure) as { error?: { message?: string } };
      const msg = parsed?.error?.message ?? '';
      if (
        msg.toLowerCase().includes('credit') ||
        msg.toLowerCase().includes('billing') ||
        msg.toLowerCase().includes('balance')
      ) {
        billingHint = msg;
      }
    } catch {
      /* not JSON */
    }
    if (billingHint) {
      throw new Error(
        `Anthropic: ${billingHint} Open console.anthropic.com → Plans & Billing to add credits or upgrade.`
      );
    }
    throw new Error(`Plan generation failed (${response.status}): ${failure}`);
  }

  const payload = await response.json();
  const text = payload?.content?.find((part: { type?: string }) => part.type === 'text')?.text ?? '';
  if (!text) {
    throw new Error('Claude did not return plan text content.');
  }

  try {
    const parsed = JSON.parse(stripCodeFences(text));
    assertGeneratedPlanShape(parsed);
    return parsed;
  } catch (error) {
    console.error('[generateTrainingPlan] Malformed Claude response:', text);
    throw new Error(
      `Malformed JSON returned by Claude. ${error instanceof Error ? error.message : 'Unknown parse error.'}`
    );
  }
}
