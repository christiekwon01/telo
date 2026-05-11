import type { Database } from '@/types/supabase';

export type RaceGoalRow = Database['public']['Tables']['race_goals']['Row'];
export type RacePriority = 'a' | 'b' | 'c';
export type RaceMarker = 'a_flag' | 'b_flag' | 'c_dot';
export type RaceFocusPhase = 'base' | 'load' | 'sharpen' | 'recovery';

const PRIORITY_WEIGHT: Record<RacePriority, number> = { a: 3, b: 2, c: 1 };

export function normalizeRacePriority(value: string | null | undefined): RacePriority {
  if (value === 'a' || value === 'b' || value === 'c') return value;
  return 'c';
}

export function racePriorityLabel(priority: string | null | undefined) {
  const p = normalizeRacePriority(priority);
  return p.toUpperCase();
}

export function racePriorityWeight(priority: string | null | undefined) {
  return PRIORITY_WEIGHT[normalizeRacePriority(priority)];
}

export function toIsoDateLocal(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function daysUntilIsoDate(isoDate: string, todayIso = toIsoDateLocal(new Date())) {
  const from = new Date(`${todayIso}T00:00:00`);
  const to = new Date(`${isoDate}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function sortRacesByDate(races: RaceGoalRow[]) {
  return [...races].sort((a, b) => a.event_date.localeCompare(b.event_date));
}

export function sortRacesByPriorityThenDate(races: RaceGoalRow[]) {
  return [...races].sort((a, b) => {
    const weightDelta = racePriorityWeight(b.priority) - racePriorityWeight(a.priority);
    if (weightDelta !== 0) return weightDelta;
    return a.event_date.localeCompare(b.event_date);
  });
}

export function raceMarkerForPriority(priority: string | null | undefined): RaceMarker {
  const p = normalizeRacePriority(priority);
  if (p === 'a') return 'a_flag';
  if (p === 'b') return 'b_flag';
  return 'c_dot';
}

export function getUpcomingRaces(races: RaceGoalRow[], todayIso = toIsoDateLocal(new Date())) {
  return races.filter((race) => race.event_date >= todayIso);
}

export function getPrimaryRaceForPlanning(races: RaceGoalRow[], todayIso = toIsoDateLocal(new Date())) {
  const upcoming = getUpcomingRaces(races, todayIso);
  if (upcoming.length === 0) return null;
  return sortRacesByPriorityThenDate(upcoming)[0] ?? null;
}

/** Earliest upcoming A-priority race — anchor for periodization (Base / Load / Sharpen). */
export function getMainGoalRaceForPlanning(races: RaceGoalRow[], todayIso = toIsoDateLocal(new Date())) {
  const upcoming = getUpcomingRaces(races, todayIso);
  const aRaces = upcoming.filter((r) => normalizeRacePriority(r.priority) === 'a');
  if (aRaces.length === 0) return null;
  return [...aRaces].sort((a, b) => a.event_date.localeCompare(b.event_date))[0] ?? null;
}

/**
 * Training block / phase copy for the plan banner.
 * Pass the **anchor** race used for periodization (typically `getMainGoalRaceForPlanning` ?? fallback).
 */
export function getRaceFocusInfo(anchorRace: RaceGoalRow | null, todayIso = toIsoDateLocal(new Date())): {
  focusPhase: RaceFocusPhase;
  focusText: string;
  daysUntilRace: number | null;
} {
  if (!anchorRace) {
    return {
      focusPhase: 'base',
      focusText: 'No upcoming races set — balanced base focus.',
      daysUntilRace: null,
    };
  }

  const daysOut = daysUntilIsoDate(anchorRace.event_date, todayIso);
  const priority = normalizeRacePriority(anchorRace.priority);
  const raceType = anchorRace.race_type ?? 'event';

  if (daysOut < 0) {
    return {
      focusPhase: 'recovery',
      focusText: `Recovery week after ${anchorRace.title} (${raceType}).`,
      daysUntilRace: daysOut,
    };
  }

  if (priority === 'a') {
    if (daysOut <= 14) {
      return {
        focusPhase: 'sharpen',
        focusText: `Phase 3 · Sharpen (${raceType} taper)`,
        daysUntilRace: daysOut,
      };
    }
    if (daysOut <= 70) {
      return {
        focusPhase: 'load',
        focusText: `Phase 2 · Load & Volume (${raceType} focus)`,
        daysUntilRace: daysOut,
      };
    }
    return {
      focusPhase: 'base',
      focusText: `Phase 1 · Base Building (${raceType} focus)`,
      daysUntilRace: daysOut,
    };
  }

  if (priority === 'b') {
    if (daysOut <= 14) {
      return {
        focusPhase: 'load',
        focusText: `Build (${raceType} checkpoint week)`,
        daysUntilRace: daysOut,
      };
    }
    return {
      focusPhase: 'base',
      focusText: `Base (${raceType} support block)`,
      daysUntilRace: daysOut,
    };
  }

  return {
    focusPhase: 'base',
    focusText: `Train-through (${raceType} stimulus)`,
    daysUntilRace: daysOut,
  };
}

