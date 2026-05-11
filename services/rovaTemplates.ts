export type RovaTemplateCategory =
  | 'fatigue'
  | 'race_readiness'
  | 'overview'
  | 'skip_session'
  | 'swim'
  | 'bike'
  | 'run'
  | 'nutrition'
  | 'rest'
  | 'motivation'
  | 'injury'
  | 'race_strategy'
  | 'weather'
  | 'app_help';

export type AthleteContext = {
  athleteName: string;
  athleteLevel: string;
  goalRaceName: string | null;
  goalRaceDate: string | null;
  daysUntilRace: number | null;
  thisWeekPlanned: number;
  thisWeekCompleted: number;
  completionRate: number;
  last7Days: {
    date: string;
    sport: string;
    status: string;
    durationMins: number | null;
    rpe: number | null;
  }[];
  last30DaysSportBreakdown: Record<string, number>;
  currentStreakDays: number;
  longestSessionMins: number;
  avgRpeLast14d: number | null;
};

export type RovaTemplate = {
  category: RovaTemplateCategory;
  anyOf: string[];
  allOf?: string[];
  response: (ctx: AthleteContext) => string;
};

function raceLine(ctx: AthleteContext) {
  if (!ctx.goalRaceName || ctx.daysUntilRace == null) return 'Set a race in-app so we can sharpen timing decisions.';
  return `${ctx.goalRaceName} is ${ctx.daysUntilRace} day${ctx.daysUntilRace === 1 ? '' : 's'} away.`;
}

function completionLine(ctx: AthleteContext) {
  return `You are ${ctx.thisWeekCompleted}/${ctx.thisWeekPlanned} this week (${ctx.completionRate}%).`;
}

function safeAvgRpe(ctx: AthleteContext) {
  return ctx.avgRpeLast14d == null ? 'n/a' : ctx.avgRpeLast14d.toFixed(1);
}

export const rovaTemplates: RovaTemplate[] = [
  {
    category: 'injury',
    anyOf: ['injury', 'hurt', 'pain', 'sore knee', 'achilles', 'shin splint', 'strain', 'tendon'],
    response: () =>
      "If you're in pain or suspect injury, stop the session and prioritize recovery first. I can help you adjust training load, but for diagnosis or persistent pain, check in with a qualified clinician.",
  },
  {
    category: 'race_readiness',
    anyOf: ['ready', 'readiness', 'am i ready', 'prepared', 'on track'],
    allOf: ['race'],
    response: (ctx) =>
      `${raceLine(ctx)} ${completionLine(ctx)} Keep consistency high and protect recovery this week; you're building readiness through repeatable sessions, not one heroic day.`,
  },
  {
    category: 'overview',
    anyOf: ['how is my training', 'overview', 'summary', 'how am i going', 'status'],
    response: (ctx) =>
      `${completionLine(ctx)} Current streak: ${ctx.currentStreakDays} day${ctx.currentStreakDays === 1 ? '' : 's'}. Avg RPE (last 14d): ${safeAvgRpe(ctx)}. ${raceLine(ctx)}`,
  },
  {
    category: 'skip_session',
    anyOf: ['skip', 'miss', 'should i skip', 'skip session', 'skip workout'],
    response: (ctx) =>
      `If fatigue is high, it is better to skip or shorten one session than force poor quality. Check effort honestly today (avg RPE ${safeAvgRpe(ctx)} lately), then either swap to easy recovery or move the session.`,
  },
  {
    category: 'swim',
    anyOf: ['swim', 'pool', 'open water', 'freestyle'],
    response: (ctx) =>
      `Use swim sessions to build relaxed efficiency first, then pace control. Keep form quality high and finish feeling smooth so it supports the rest of your week (${completionLine(ctx)}).`,
  },
  {
    category: 'bike',
    anyOf: ['bike', 'cycle', 'cycling', 'zwift', 'ride'],
    response: (ctx) =>
      `For bike progress, anchor your week with one quality ride and one aerobic ride. Fuel before longer sessions and keep cadence controlled so you can still run well after.`,
  },
  {
    category: 'run',
    anyOf: ['run', 'running', 'jog', 'tempo run', 'long run'],
    response: (ctx) =>
      `Protect run consistency by keeping easy days truly easy, then execute quality with intention. Longest recent session is ${ctx.longestSessionMins} min, so build from there progressively, not abruptly.`,
  },
  {
    category: 'nutrition',
    anyOf: ['nutrition', 'fuel', 'carbs', 'eat', 'hydration', 'hydrated'],
    response: () =>
      'Fuel the work you plan to do: carbs before and during key sessions, protein plus carbs after, and steady hydration across the day. Keep race-week choices simple and practiced.',
  },
  {
    category: 'rest',
    anyOf: ['rest day', 'recovery day', 'recovery', 'rest'],
    response: () =>
      'Recovery is training. Keep your rest day easy: light mobility, hydration, and sleep focus, so your next quality session lands with good legs.',
  },
  {
    category: 'motivation',
    anyOf: ['motivation', 'motivated', 'stuck', 'burnt out', 'hard to train'],
    response: (ctx) =>
      `Keep it simple: win today, not the whole block. You already have a ${ctx.currentStreakDays}-day streak; stack one controlled session and log how you feel after.`,
  },
  {
    category: 'race_strategy',
    anyOf: ['race strategy', 'race plan', 'pacing', 'pace strategy', 'transition'],
    allOf: ['race'],
    response: (ctx) =>
      `${raceLine(ctx)} Strategy is steady start, controlled middle, strong finish. Practice race-pace feel in training and rehearse nutrition + transitions so execution stays calm on race day.`,
  },
  {
    category: 'weather',
    anyOf: ['weather', 'hot', 'heat', 'cold', 'wind', 'rain'],
    response: () =>
      'Adjust execution to conditions: lower intensity slightly in heat, layer smart in cold, and focus on control in wind/rain. Prioritize safety, hydration, and pacing over ego splits.',
  },
  {
    category: 'app_help',
    anyOf: ['how do i use', 'where is', 'app', 'telo', 'log session', 'feature'],
    response: () =>
      'In Telo, you can ask me to review readiness, compare recent training, or help log a session. If you tell me what screen or action you want, I can give step-by-step guidance.',
  },
  {
    category: 'fatigue',
    anyOf: ['tired', 'fatigue', 'exhausted', 'drained', 'heavy legs'],
    response: (ctx) =>
      `Your recent load says pause and assess first: avg RPE ${safeAvgRpe(ctx)} with ${completionLine(ctx)}. If legs feel flat, reduce intensity today and protect sleep so quality returns.`,
  },
];
