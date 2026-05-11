import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { ensureAthleteRowExists } from '@/lib/supabase-auth';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

type PersonalBestRow = Database['public']['Tables']['personal_bests']['Row'];

export type PersonalBestSport = 'swim' | 'bike' | 'run';

export type PersonalBestCatalogEntry = {
  sport: PersonalBestSport;
  distance: number;
  distance_unit: 'm' | 'km';
  label: string;
};

/** Default PB distances used for auto-calculation and the milestones catalog. */
export const PERSONAL_BEST_CATALOG: readonly PersonalBestCatalogEntry[] = [
  { sport: 'swim', distance: 400, distance_unit: 'm', label: 'Swim 400m' },
  { sport: 'swim', distance: 1000, distance_unit: 'm', label: 'Swim 1000m' },
  { sport: 'swim', distance: 1500, distance_unit: 'm', label: 'Swim 1500m' },
  { sport: 'bike', distance: 10, distance_unit: 'km', label: 'Bike 10km' },
  { sport: 'bike', distance: 20, distance_unit: 'km', label: 'Bike 20km' },
  { sport: 'bike', distance: 40, distance_unit: 'km', label: 'Bike 40km' },
  { sport: 'run', distance: 5, distance_unit: 'km', label: 'Run 5km' },
  { sport: 'run', distance: 10, distance_unit: 'km', label: 'Run 10km' },
  { sport: 'run', distance: 21.1, distance_unit: 'km', label: 'Run 21.1km' },
] as const;

const COLLAPSED_PREVIEW_KEYS = new Set(['swim-400-m', 'bike-20-km', 'run-5-km']);

export function catalogRowKey(entry: Pick<PersonalBestCatalogEntry, 'sport' | 'distance' | 'distance_unit'>): string {
  return `${entry.sport}-${entry.distance}-${entry.distance_unit}`;
}

/** Compare catalog distances tolerantly (Postgres numeric / JSON can differ slightly from JS literals). */
export function catalogDistanceMatches(
  a: number | string | null | undefined,
  b: number | string | null | undefined
): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) < 1e-4;
}

export function isCollapsedPersonalBestPreview(entry: PersonalBestCatalogEntry): boolean {
  return COLLAPSED_PREVIEW_KEYS.has(catalogRowKey(entry));
}

type SessionMini = {
  athlete_id: string;
  sport: string;
  distance: number | null;
  distance_unit: string | null;
};

export type PbLogRow = {
  id: string;
  completed_at: string;
  actual_duration_mins: number | null;
  actual_distance: number | null;
  sessions: SessionMini;
};

export type CatalogWinner = {
  session_log_id: string;
  completed_at: string;
  actual_duration_mins: number;
  achieved_date_iso: string;
};

export type PersonalBestImprovement = {
  label: string;
  sport: PersonalBestSport;
  distance: number;
  distance_unit: 'm' | 'km';
  previousTimeMins: number;
  newTimeMins: number;
  toastLine: string;
};

function normalizePbSport(raw: string): PersonalBestSport | null {
  const s = raw.toLowerCase();
  if (s === 'swim' || s === 'bike' || s === 'run') return s;
  return null;
}

export function distanceToMeters(distance: number, unit: string | null | undefined): number {
  const u = (unit ?? 'km').toLowerCase();
  if (u === 'm') return distance;
  return distance * 1000;
}

export function achievedDateFromCompletedAtIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse MM:SS or a plain minutes number into fractional minutes. */
export function parseMmSsToMinutes(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const parts = s.split(':').map((p) => p.trim());
  if (parts.length === 1) {
    const n = Number(parts[0]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss < 0 || ss >= 60 || mm < 0) return null;
    return mm + ss / 60;
  }
  return null;
}

export function formatMinutesAsMmSs(mins: number): string {
  const totalSec = Math.max(0, Math.round(mins * 60));
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function effectiveDistanceMeters(log: PbLogRow): number | null {
  const session = log.sessions;
  const sport = normalizePbSport(session.sport);
  if (!sport) return null;

  const rawDist =
    log.actual_distance != null && Number.isFinite(Number(log.actual_distance))
      ? Number(log.actual_distance)
      : session.distance != null && Number.isFinite(Number(session.distance))
        ? Number(session.distance)
        : null;
  if (rawDist == null || rawDist <= 0) return null;

  const unit =
    log.actual_distance != null && Number.isFinite(Number(log.actual_distance))
      ? session.distance_unit
      : session.distance_unit;

  return distanceToMeters(rawDist, unit);
}

function catalogTargetMeters(entry: PersonalBestCatalogEntry): number {
  return distanceToMeters(entry.distance, entry.distance_unit);
}

export function findWinnerForCatalogEntry(logs: PbLogRow[], entry: PersonalBestCatalogEntry): CatalogWinner | null {
  const targetM = catalogTargetMeters(entry);
  let best: CatalogWinner | null = null;

  for (const log of logs) {
    const sport = normalizePbSport(log.sessions.sport);
    if (sport !== entry.sport) continue;

    const dur = log.actual_duration_mins;
    if (dur == null || !Number.isFinite(Number(dur)) || Number(dur) <= 0) continue;

    const meters = effectiveDistanceMeters(log);
    if (meters == null || meters + 0.01 < targetM) continue;

    const durNum = Number(dur);
    if (!best || durNum < best.actual_duration_mins) {
      best = {
        session_log_id: log.id,
        completed_at: log.completed_at,
        actual_duration_mins: durNum,
        achieved_date_iso: achievedDateFromCompletedAtIso(log.completed_at),
      };
    }
  }

  return best;
}

export function findWinnerForAdhocDistance(
  logs: PbLogRow[],
  sport: PersonalBestSport,
  distance: number,
  distance_unit: 'm' | 'km'
): CatalogWinner | null {
  const entry: PersonalBestCatalogEntry = { sport, distance, distance_unit, label: '' };
  return findWinnerForCatalogEntry(logs, entry);
}

export function buildCatalogWinnerMap(logs: PbLogRow[]): Map<string, CatalogWinner> {
  const map = new Map<string, CatalogWinner>();
  for (const entry of PERSONAL_BEST_CATALOG) {
    const key = catalogRowKey(entry);
    const w = findWinnerForCatalogEntry(logs, entry);
    if (w) map.set(key, w);
  }
  return map;
}

export async function fetchSessionLogsForPersonalBests(athleteId: string): Promise<PbLogRow[]> {
  const { data, error } = await supabase
    .from('session_logs')
    .select(
      `id, completed_at, actual_duration_mins, actual_distance,
       sessions!inner(athlete_id, sport, distance, distance_unit)`
    )
    .eq('athlete_id', athleteId)
    .eq('sessions.athlete_id', athleteId)
    .not('actual_duration_mins', 'is', null);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PbLogRow[];
}

function matchesCatalogRow(
  row: Pick<PersonalBestRow, 'sport' | 'distance' | 'distance_unit'>,
  entry: PersonalBestCatalogEntry
): boolean {
  return (
    row.sport === entry.sport &&
    catalogDistanceMatches(row.distance, entry.distance) &&
    row.distance_unit === entry.distance_unit
  );
}

async function deleteAutoPersonalBest(
  athleteId: string,
  entry: Pick<PersonalBestCatalogEntry, 'sport' | 'distance' | 'distance_unit'>
): Promise<void> {
  const { error } = await supabase
    .from('personal_bests')
    .delete()
    .eq('athlete_id', athleteId)
    .eq('sport', entry.sport)
    .eq('distance', entry.distance)
    .eq('distance_unit', entry.distance_unit)
    .eq('source', 'auto');
  if (error) throw new Error(error.message);
}

async function upsertPersonalBestRow(payload: Database['public']['Tables']['personal_bests']['Insert']): Promise<void> {
  await ensureAthleteRowExists(payload.athlete_id);
  const { error } = await supabase.from('personal_bests').upsert(payload, {
    onConflict: 'athlete_id,sport,distance,distance_unit',
  });
  if (error) throw new Error(error.message);
}

/**
 * Recomputes automatic PB rows from session logs.
 * Does not overwrite manual rows for the same catalog distance (user can sync via Progress sheet).
 * Returns improvements vs previously stored rows (strictly faster times only).
 */
export async function recalculatePersonalBests(athleteId: string): Promise<{ improvements: PersonalBestImprovement[] }> {
  const [{ data: existingRows, error: existingErr }, logs] = await Promise.all([
    supabase.from('personal_bests').select('*').eq('athlete_id', athleteId),
    fetchSessionLogsForPersonalBests(athleteId),
  ]);

  if (existingErr) throw new Error(existingErr.message);
  const existing = (existingRows ?? []) as PersonalBestRow[];

  const winnerMap = buildCatalogWinnerMap(logs);
  const improvements: PersonalBestImprovement[] = [];

  for (const entry of PERSONAL_BEST_CATALOG) {
    const key = catalogRowKey(entry);
    const winner = winnerMap.get(key);
    const row = existing.find((r) => matchesCatalogRow(r, entry));

    if (!winner) {
      if (row?.source === 'auto') await deleteAutoPersonalBest(athleteId, entry);
      continue;
    }

    if (row?.source === 'manual') continue;

    const prevAutoTime = row?.source === 'auto' ? Number(row.time_mins) : null;
    const nextTime = winner.actual_duration_mins;

    await upsertPersonalBestRow({
      athlete_id: athleteId,
      sport: entry.sport,
      distance: entry.distance,
      distance_unit: entry.distance_unit,
      time_mins: nextTime,
      achieved_date: winner.achieved_date_iso,
      source: 'auto',
      session_log_id: winner.session_log_id,
    });

    if (prevAutoTime != null && nextTime < prevAutoTime - 1e-9) {
      improvements.push({
        label: entry.label,
        sport: entry.sport,
        distance: entry.distance,
        distance_unit: entry.distance_unit,
        previousTimeMins: prevAutoTime,
        newTimeMins: nextTime,
        toastLine: `New PB! ${entry.label}: ${formatMinutesAsMmSs(nextTime)} 🎉`,
      });
    }
  }

  return { improvements };
}

export async function upsertManualPersonalBestFromSessionsWinner(args: {
  athleteId: string;
  entry: PersonalBestCatalogEntry;
  winner: CatalogWinner;
}): Promise<void> {
  await upsertPersonalBestRow({
    athlete_id: args.athleteId,
    sport: args.entry.sport,
    distance: args.entry.distance,
    distance_unit: args.entry.distance_unit,
    time_mins: args.winner.actual_duration_mins,
    achieved_date: args.winner.achieved_date_iso,
    source: 'manual',
    session_log_id: args.winner.session_log_id,
  });
}

export async function upsertManualPersonalBestCustom(args: {
  athleteId: string;
  sport: PersonalBestSport;
  distance: number;
  distance_unit: 'm' | 'km';
  time_mins: number;
  achieved_date_iso: string;
}): Promise<void> {
  await upsertPersonalBestRow({
    athlete_id: args.athleteId,
    sport: args.sport,
    distance: args.distance,
    distance_unit: args.distance_unit,
    time_mins: args.time_mins,
    achieved_date: args.achieved_date_iso,
    source: 'manual',
    session_log_id: null,
  });
}

const LEGACY_PB_STORAGE_KEY = 'telo-personal-bests';
const LEGACY_PB_MIGRATION_FLAG_KEY = 'telo-personal-bests-supabase-migrated-v1';

/** One-time migration from persisted Zustand personal bests into Supabase manual rows. */
export async function migrateLegacyPersonalBestsIfNeeded(athleteId: string): Promise<void> {
  let flag: string | null = null;
  let raw: string | null = null;
  try {
    flag = await AsyncStorage.getItem(LEGACY_PB_MIGRATION_FLAG_KEY);
    if (flag === '1') return;
    raw = await AsyncStorage.getItem(LEGACY_PB_STORAGE_KEY);
    if (!raw) {
      await AsyncStorage.setItem(LEGACY_PB_MIGRATION_FLAG_KEY, '1');
      return;
    }
  } catch {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as { state?: { values?: Record<string, string> }; values?: Record<string, string> };
    const values = parsed?.state?.values ?? parsed?.values;
    if (!values || typeof values !== 'object') {
      try {
        await AsyncStorage.setItem(LEGACY_PB_MIGRATION_FLAG_KEY, '1');
      } catch {
        /* ignore */
      }
      return;
    }

    const legacyMap: Record<string, PersonalBestCatalogEntry> = {
      swim400m: { sport: 'swim', distance: 400, distance_unit: 'm', label: 'Swim 400m' },
      bike20km: { sport: 'bike', distance: 20, distance_unit: 'km', label: 'Bike 20km' },
      run5km: { sport: 'run', distance: 5, distance_unit: 'km', label: 'Run 5km' },
    };

    const todayIso = achievedDateFromCompletedAtIso(new Date().toISOString());

    for (const [legacyKey, meta] of Object.entries(legacyMap)) {
      const str = values[legacyKey];
      if (typeof str !== 'string' || !str.trim()) continue;
      const mins = parseMmSsToMinutes(str);
      if (mins == null) continue;
      await upsertPersonalBestRow({
        athlete_id: athleteId,
        sport: meta.sport,
        distance: meta.distance,
        distance_unit: meta.distance_unit,
        time_mins: mins,
        achieved_date: todayIso,
        source: 'manual',
        session_log_id: null,
      });
    }
  } catch {
    // Ignore malformed legacy payloads; still mark migrated to avoid retry loops.
  }

  try {
    await AsyncStorage.setItem(LEGACY_PB_MIGRATION_FLAG_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function pickCelebrationImprovement(improvements: PersonalBestImprovement[]): PersonalBestImprovement | null {
  if (improvements.length === 0) return null;
  const order = new Map(PERSONAL_BEST_CATALOG.map((e, i) => [catalogRowKey(e), i]));
  return [...improvements].sort((a, b) => {
    const ia = order.get(catalogRowKey(a)) ?? 999;
    const ib = order.get(catalogRowKey(b)) ?? 999;
    return ia - ib;
  })[0];
}

/** Invalidate PB queries after syncing computed rows from session_logs. */
export async function syncPersonalBestsAfterSessionLogsChange(
  queryClient: QueryClient,
  athleteId: string
): Promise<PersonalBestImprovement[]> {
  const { improvements } = await recalculatePersonalBests(athleteId);
  await queryClient.invalidateQueries({ queryKey: ['personal_bests'] });
  return improvements;
}
