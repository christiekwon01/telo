export type GeneratedSessionBlock = {
  blockType: 'warmup' | 'main' | 'cooldown';
  title: string;
  steps: string[];
};

export type GeneratedSession = {
  weekNumber: number;
  scheduledDate: string; // YYYY-MM-DD
  sport: 'swim' | 'bike' | 'run' | 'brick' | 'gym' | 'rest';
  title: string;
  durationMins: number | null;
  distance: number | null;
  distanceUnit: 'm' | 'km' | null;
  intensity: 'easy' | 'steady' | 'tempo' | 'threshold' | 'intervals';
  description: string;
  coachNote: string;
  blocks: GeneratedSessionBlock[];
};

export type GeneratedPlan = {
  planName: string;
  totalWeeks: number;
  phase: string;
  sessions: GeneratedSession[];
};

export type GeneratePlanParams = {
  athleteName: string;
  level: 'fara' | 'orka' | 'vinna';
  sportBackgrounds?: {
    swim?: 'beginner' | 'experienced' | 'competitive';
    bike?: 'beginner' | 'experienced' | 'competitive';
    run?: 'beginner' | 'experienced' | 'competitive';
  };
  raceDate: string;
  raceName: string;
  upcomingRaces?: {
    name: string;
    date: string;
    priority: 'a' | 'b' | 'c';
    raceType?: string | null;
  }[];
  trainingDays: string[];
  lifeCommitments: string[];
};
