import type { GeneratedSession } from '@/services/plan-types';

export type TemplateLevel = 'fara' | 'orka' | 'vinna';
export type TemplateRaceType = 'sprint' | 'olympic' | 'half';
type WeekdayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type TemplateDay = Omit<GeneratedSession, 'weekNumber' | 'scheduledDate'>;
export type WeeklyTemplate = {
  weekRange: [number, number];
  days: Record<WeekdayKey, TemplateDay>;
};

export type PlanTemplate = {
  name: string;
  totalWeeks: number;
  phase: string;
  weeklyStructure: WeeklyTemplate[];
};

const REST_BLOCKS: TemplateDay['blocks'] = [];

const faraBaseWeekDays: WeeklyTemplate['days'] = {
  monday: {
    sport: 'rest',
    title: 'Active recovery',
    durationMins: 30,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Easy walk or light stretching.',
    coachNote: 'Recovery is training. Protect this day.',
    blocks: [
      {
        blockType: 'main',
        title: 'Recovery',
        steps: ['20-30 minute easy walk', '10 minutes of light stretching', 'Focus on hips, ankles, and shoulders'],
      },
    ],
  },
  tuesday: {
    sport: 'swim',
    title: 'Aerobic base swim',
    durationMins: 40,
    distance: 1200,
    distanceUnit: 'm',
    intensity: 'easy',
    description: 'Easy continuous swimming to build water confidence.',
    coachNote: 'Focus on feeling the water, not pace.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['200m very easy', 'Long smooth strokes'] },
      { blockType: 'main', title: 'Main set', steps: ['4 x 100m easy, 30 sec rest', '4 x 50m choice stroke'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['200m easy', 'Gentle stretch'] },
    ],
  },
  wednesday: {
    sport: 'bike',
    title: 'Zone 2 endurance ride',
    durationMins: 45,
    distance: 20,
    distanceUnit: 'km',
    intensity: 'easy',
    description: 'Steady aerobic ride at conversational pace.',
    coachNote: 'Zone 2 builds your aerobic engine.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['10 minutes easy spinning'] },
      { blockType: 'main', title: 'Main set', steps: ['30 minutes Zone 2', 'Cadence 85-95 RPM'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['5 minutes easy spinning'] },
    ],
  },
  thursday: {
    sport: 'run',
    title: 'Easy aerobic run',
    durationMins: 30,
    distance: 4,
    distanceUnit: 'km',
    intensity: 'easy',
    description: 'Easy run at conversational pace.',
    coachNote: 'Zone 2 should feel easy.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['5 minute brisk walk', 'Dynamic mobility'] },
      { blockType: 'main', title: 'Main set', steps: ['20 minutes easy run', 'Relaxed form'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['5 minute walk', 'Stretch'] },
    ],
  },
  friday: {
    sport: 'rest',
    title: 'Full rest',
    durationMins: 0,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Complete rest day.',
    coachNote: 'Your body gets stronger in recovery.',
    blocks: REST_BLOCKS,
  },
  saturday: {
    sport: 'brick',
    title: 'Brick session — bike + run',
    durationMins: 55,
    distance: null,
    distanceUnit: null,
    intensity: 'steady',
    description: 'Bike followed by run to simulate race conditions.',
    coachNote: 'Practice smooth transition under control.',
    blocks: [
      { blockType: 'warmup', title: 'Bike warm up', steps: ['10 minutes easy spin'] },
      { blockType: 'main', title: 'Bike set', steps: ['30 minutes steady bike', 'Quick transition'] },
      { blockType: 'cooldown', title: 'Run off bike', steps: ['15 minutes easy run', '5 minute walk'] },
    ],
  },
  sunday: {
    sport: 'run',
    title: 'Long easy run',
    durationMins: 40,
    distance: 6,
    distanceUnit: 'km',
    intensity: 'easy',
    description: 'Longer easy run to build aerobic base.',
    coachNote: 'Steady and sustainable pacing.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['5 minute walk', 'Easy jog in'] },
      { blockType: 'main', title: 'Main set', steps: ['30 minutes easy continuous run'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['5 minute walk', 'Stretch'] },
    ],
  },
};

const faraDeloadWeekDays: WeeklyTemplate['days'] = {
  monday: {
    sport: 'rest',
    title: 'Full rest',
    durationMins: 0,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Deload rest day.',
    coachNote: 'Adaptation happens in deload.',
    blocks: REST_BLOCKS,
  },
  tuesday: {
    sport: 'swim',
    title: 'Easy recovery swim',
    durationMins: 25,
    distance: 800,
    distanceUnit: 'm',
    intensity: 'easy',
    description: 'Very easy swim.',
    coachNote: 'No pressure, just movement.',
    blocks: [{ blockType: 'main', title: 'Easy swim', steps: ['800m easy choice stroke'] }],
  },
  wednesday: {
    sport: 'bike',
    title: 'Easy spin',
    durationMins: 20,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Short easy spin.',
    coachNote: 'Zone 1 only.',
    blocks: [{ blockType: 'main', title: 'Easy spin', steps: ['20 minutes easy spin'] }],
  },
  thursday: {
    sport: 'rest',
    title: 'Rest',
    durationMins: 0,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Rest day.',
    coachNote: 'Store energy for next block.',
    blocks: REST_BLOCKS,
  },
  friday: {
    sport: 'rest',
    title: 'Rest',
    durationMins: 0,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Rest day.',
    coachNote: 'Full rest today.',
    blocks: REST_BLOCKS,
  },
  saturday: {
    sport: 'run',
    title: 'Easy short run',
    durationMins: 25,
    distance: 3,
    distanceUnit: 'km',
    intensity: 'easy',
    description: 'Short easy run.',
    coachNote: 'Keep it truly easy.',
    blocks: [{ blockType: 'main', title: 'Easy run', steps: ['3km easy run', 'Walk if needed'] }],
  },
  sunday: {
    sport: 'rest',
    title: 'Rest',
    durationMins: 0,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Rest day.',
    coachNote: 'Fresh legs for next week.',
    blocks: REST_BLOCKS,
  },
};

const faraBuildWeekDays: WeeklyTemplate['days'] = {
  ...faraBaseWeekDays,
  tuesday: {
    sport: 'swim',
    title: 'Threshold intervals',
    durationMins: 50,
    distance: 1800,
    distanceUnit: 'm',
    intensity: 'threshold',
    description: 'Harder swim intervals to build speed and fitness.',
    coachNote: 'Threshold is controlled hard, not all-out.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['400m easy', '4 x 25m build'] },
      { blockType: 'main', title: 'Main set', steps: ['6 x 100m threshold, 20 sec rest', '4 x 50m fast'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['200m very easy'] },
    ],
  },
  wednesday: {
    sport: 'brick',
    title: 'Progressed brick',
    durationMins: 65,
    distance: null,
    distanceUnit: null,
    intensity: 'steady',
    description: 'Longer brick session with increased bike volume.',
    coachNote: 'Smooth transition focus.',
    blocks: [
      { blockType: 'warmup', title: 'Bike warm up', steps: ['10 minutes easy spin'] },
      { blockType: 'main', title: 'Bike set', steps: ['40 minutes Zone 2-3 bike'] },
      { blockType: 'cooldown', title: 'Run off bike', steps: ['15 minutes easy run'] },
    ],
  },
  thursday: {
    sport: 'run',
    title: 'Tempo run',
    durationMins: 35,
    distance: 5,
    distanceUnit: 'km',
    intensity: 'tempo',
    description: 'Sustained comfortably-hard run.',
    coachNote: 'Tempo effort, controlled breathing.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['5 minute easy jog', '4 x strides'] },
      { blockType: 'main', title: 'Tempo set', steps: ['20 minutes tempo'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['5-10 minute easy jog', 'Stretch'] },
    ],
  },
  saturday: {
    sport: 'brick',
    title: 'Long brick',
    durationMins: 80,
    distance: null,
    distanceUnit: null,
    intensity: 'steady',
    description: 'Longest brick in this phase.',
    coachNote: 'Key workout of the week.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['10 minute easy spin'] },
      { blockType: 'main', title: 'Bike set', steps: ['55 minute Zone 2-3 bike'] },
      { blockType: 'cooldown', title: 'Run off bike', steps: ['20 minute easy run'] },
    ],
  },
  sunday: {
    sport: 'swim',
    title: 'Aerobic distance swim',
    durationMins: 45,
    distance: 1800,
    distanceUnit: 'm',
    intensity: 'steady',
    description: 'Continuous aerobic swim.',
    coachNote: 'Build continuous distance confidence.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['200m easy'] },
      { blockType: 'main', title: 'Main set', steps: ['1400m continuous steady swim'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['200m easy'] },
    ],
  },
};

const faraRacePrepWeekDays: WeeklyTemplate['days'] = {
  ...faraBuildWeekDays,
  tuesday: {
    sport: 'swim',
    title: 'Race pace swim',
    durationMins: 50,
    distance: 1900,
    distanceUnit: 'm',
    intensity: 'threshold',
    description: 'Race-distance confidence swim.',
    coachNote: 'Controlled race-specific effort.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['400m easy', '4 x 25m build'] },
      { blockType: 'main', title: 'Race simulation', steps: ['750m race pace', '500m race pace', '4 x 50m fast'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['200m easy'] },
    ],
  },
  wednesday: {
    sport: 'brick',
    title: 'Race simulation brick',
    durationMins: 75,
    distance: null,
    distanceUnit: null,
    intensity: 'steady',
    description: 'Race-specific bike + run session.',
    coachNote: 'Practice race transition rhythm.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['10 min easy spin'] },
      { blockType: 'main', title: 'Simulation', steps: ['45 min race-effort bike', '20 min race-effort run'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['5 min walk'] },
    ],
  },
};

const faraTaperWeekDays: WeeklyTemplate['days'] = {
  monday: { ...faraDeloadWeekDays.monday, coachNote: 'Race week starts. Stay calm and fresh.' },
  tuesday: {
    sport: 'swim',
    title: 'Short sharp swim',
    durationMins: 30,
    distance: 1000,
    distanceUnit: 'm',
    intensity: 'steady',
    description: 'Short race-week swim session.',
    coachNote: 'Keep it short and sharp.',
    blocks: [
      { blockType: 'warmup', title: 'Warm up', steps: ['200m easy'] },
      { blockType: 'main', title: 'Main set', steps: ['4 x 100m race pace', '4 x 25m fast'] },
      { blockType: 'cooldown', title: 'Cool down', steps: ['200m easy'] },
    ],
  },
  wednesday: {
    sport: 'bike',
    title: 'Short easy ride',
    durationMins: 25,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Keep legs fresh.',
    coachNote: 'Easy spin only.',
    blocks: [{ blockType: 'main', title: 'Easy ride', steps: ['25 min Zone 1 spin'] }],
  },
  thursday: {
    sport: 'run',
    title: 'Race prep run',
    durationMins: 20,
    distance: 3,
    distanceUnit: 'km',
    intensity: 'easy',
    description: 'Short run with strides.',
    coachNote: 'Stay loose and confident.',
    blocks: [{ blockType: 'main', title: 'Prep run', steps: ['15 min easy', '4 x 20 sec race pace strides'] }],
  },
  friday: { ...faraDeloadWeekDays.friday, title: 'Full rest', description: 'Day before race, complete rest.' },
  saturday: { ...faraDeloadWeekDays.saturday, sport: 'rest', title: 'Race day prep', durationMins: 0, distance: null, distanceUnit: null, blocks: REST_BLOCKS },
  sunday: { ...faraDeloadWeekDays.sunday, title: 'Recovery', description: 'Post-race recovery day.' },
};

export const faraSprintTemplate: PlanTemplate = {
  name: '12-Week Sprint Triathlon — Fara',
  totalWeeks: 12,
  phase: 'base',
  weeklyStructure: [
    { weekRange: [1, 3], days: faraBaseWeekDays },
    { weekRange: [4, 4], days: faraDeloadWeekDays },
    { weekRange: [5, 7], days: faraBuildWeekDays },
    { weekRange: [8, 8], days: faraDeloadWeekDays },
    { weekRange: [9, 11], days: faraRacePrepWeekDays },
    { weekRange: [12, 12], days: faraTaperWeekDays },
  ],
};

export const orkaOlympicTemplate: PlanTemplate = {
  name: '16-Week Olympic Triathlon — Orka',
  totalWeeks: 16,
  phase: 'base',
  weeklyStructure: [
    // V2: Expand with true Olympic-specific progression and volume.
    ...faraSprintTemplate.weeklyStructure,
  ],
};

export const vinnaHalfTemplate: PlanTemplate = {
  name: '20-Week 70.3 — Vinna',
  totalWeeks: 20,
  phase: 'base',
  weeklyStructure: [
    // V2: Expand with true 70.3-specific progression and race demands.
    ...faraSprintTemplate.weeklyStructure,
  ],
};

export function getTemplateForLevel(level: TemplateLevel, raceType: TemplateRaceType = 'sprint'): PlanTemplate {
  if (level === 'vinna') return vinnaHalfTemplate;
  if (level === 'orka') return raceType === 'half' ? vinnaHalfTemplate : orkaOlympicTemplate;
  return raceType === 'olympic' ? orkaOlympicTemplate : faraSprintTemplate;
}

