import { supabase } from '@/lib/supabase';
import { savePlanToDatabase } from '@/services/savePlan';
import type { GeneratedPlan, GeneratedSession } from '@/services/plan-types';
import { getTemplateForLevel, type TemplateDay, type TemplateLevel, type TemplateRaceType } from '@/services/planTemplates';

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const SHORT_TO_WEEKDAY: Record<string, typeof WEEKDAY_KEYS[number]> = {
  sun: 'sunday',
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
};

function toIsoDate(value: Date) {
  const y = value.getFullYear();
  const m = `${value.getMonth() + 1}`.padStart(2, '0');
  const d = `${value.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(isoDate: string, days: number) {
  const ms = new Date(`${isoDate}T00:00:00`).getTime();
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function normalizeTrainingDay(day: string) {
  const short = day.trim().toLowerCase().slice(0, 3);
  return SHORT_TO_WEEKDAY[short] ?? null;
}

function inferRaceType(level: TemplateLevel, raceName: string): TemplateRaceType {
  const n = raceName.toLowerCase();
  if (n.includes('70.3') || n.includes('half')) return 'half';
  if (n.includes('olympic') || n.includes('standard')) return 'olympic';
  if (level === 'vinna') return 'half';
  if (level === 'orka') return 'olympic';
  return 'sprint';
}

function asRestDay(day: TemplateDay): TemplateDay {
  return {
    sport: 'rest',
    title: `Rest — ${day.title}`,
    durationMins: 0,
    distance: null,
    distanceUnit: null,
    intensity: 'easy',
    description: 'Rest day based on selected training availability.',
    coachNote: 'Rest supports consistency and adaptation.',
    blocks: [],
  };
}

function resolveTemplateDay(template: ReturnType<typeof getTemplateForLevel>, weekNumber: number, weekday: typeof WEEKDAY_KEYS[number]) {
  const entry =
    template.weeklyStructure.find((row) => weekNumber >= row.weekRange[0] && weekNumber <= row.weekRange[1]) ??
    template.weeklyStructure[template.weeklyStructure.length - 1];
  return entry.days[weekday];
}

export async function assignTemplatePlan(params: {
  athleteId: string;
  level: TemplateLevel;
  raceDate: string;
  raceName: string;
  trainingDays: string[];
}): Promise<void> {
  const raceType = inferRaceType(params.level, params.raceName);
  const template = getTemplateForLevel(params.level, raceType);
  const todayIso = toIsoDate(new Date());

  const raceDate = params.raceDate || addDays(todayIso, template.totalWeeks * 7);
  const countedStart = addDays(raceDate, -template.totalWeeks * 7);
  const startIso = countedStart < todayIso ? todayIso : countedStart;

  const allowedDays = new Set(
    params.trainingDays
      .map(normalizeTrainingDay)
      .filter((value): value is typeof WEEKDAY_KEYS[number] => Boolean(value))
  );

  const sessions: GeneratedSession[] = [];
  for (let week = 1; week <= template.totalWeeks; week += 1) {
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const scheduledDate = addDays(startIso, (week - 1) * 7 + dayOffset);
      if (scheduledDate > raceDate) break;
      const weekday = WEEKDAY_KEYS[new Date(`${scheduledDate}T00:00:00`).getDay()];
      const templateDay = resolveTemplateDay(template, week, weekday);
      const sessionDay =
        allowedDays.size === 0 || templateDay.sport === 'rest' || allowedDays.has(weekday) ? templateDay : asRestDay(templateDay);
      sessions.push({
        weekNumber: week,
        scheduledDate,
        ...sessionDay,
      });
    }
  }

  const generatedPlan: GeneratedPlan = {
    planName: template.name,
    totalWeeks: template.totalWeeks,
    phase: template.phase,
    sessions,
  };

  await supabase.from('plans').update({ status: 'archived' }).eq('athlete_id', params.athleteId).eq('status', 'active');
  await savePlanToDatabase(params.athleteId, generatedPlan);
}

