import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { AppState, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

const HUAWEI_STATE_KEY = 'telo:huawei:state:v1';
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export type SyncedWorkout = {
  externalId: string;
  sport: 'swim' | 'bike' | 'run';
  startTime: string;
  durationMins: number | null;
  distanceKm: number | null;
  avgHeartRate: number | null;
};

export type HuaweiImportSummary = {
  imported: number;
  skipped: number;
  errors: string[];
};

type HuaweiIntegrationState = {
  connected: boolean;
  lastSyncAt: string | null;
  lastAutoSyncAt: string | null;
};

const DEFAULT_STATE: HuaweiIntegrationState = {
  connected: false,
  lastSyncAt: null,
  lastAutoSyncAt: null,
};

type HuaweiHealthAdapter = {
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  fetchWorkoutsSince: (lastSyncDate: Date) => Promise<SyncedWorkout[]>;
};

const huaweiNoopAdapter: HuaweiHealthAdapter = {
  connect: async () => false,
  disconnect: async () => undefined,
  fetchWorkoutsSince: async () => [],
};

// TODO: Replace with real Huawei Health implementation when HMS native setup is available.
const huaweiAdapter: HuaweiHealthAdapter = huaweiNoopAdapter;
const isStubbedAdapter = huaweiAdapter === huaweiNoopAdapter;

const ALLOWED_HUAWEI_FILE_EXTENSIONS = ['.json', '.gpx', '.tcx'] as const;

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getState(): Promise<HuaweiIntegrationState> {
  try {
    const raw = await AsyncStorage.getItem(HUAWEI_STATE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<HuaweiIntegrationState>;
    return {
      connected: Boolean(parsed.connected),
      lastSyncAt: parsed.lastSyncAt ?? null,
      lastAutoSyncAt: parsed.lastAutoSyncAt ?? null,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

async function setState(next: HuaweiIntegrationState) {
  try {
    await AsyncStorage.setItem(HUAWEI_STATE_KEY, JSON.stringify(next));
  } catch {
    /* avoid uncaught AsyncStorage rejections (simulator / quota) */
  }
}

async function updateState(partial: Partial<HuaweiIntegrationState>) {
  const current = await getState();
  await setState({ ...current, ...partial });
}

function makeWorkoutSignature(workout: SyncedWorkout) {
  return `${workout.externalId}|${workout.startTime}|${workout.sport}`;
}

async function findActivePlanId(athleteId: string): Promise<string | null> {
  const { data } = await supabase
    .from('plans')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function ensureSessionForWorkout(athleteId: string, workout: SyncedWorkout): Promise<string | null> {
  const workoutDateIso = toIsoDate(new Date(workout.startTime));
  const { data: existingByDate } = await supabase
    .from('sessions')
    .select('id,status')
    .eq('athlete_id', athleteId)
    .eq('sport', workout.sport)
    .eq('scheduled_date', workoutDateIso)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingByDate?.id) {
    if (existingByDate.status !== 'completed') {
      await supabase
        .from('sessions')
        .update({ status: 'completed', completed_at: workout.startTime })
        .eq('id', existingByDate.id);
    }
    return existingByDate.id;
  }

  const activePlanId = await findActivePlanId(athleteId);
  if (!activePlanId) {
    // The current schema requires a plan_id for sessions, so ad-hoc imports cannot be created without an active plan.
    // We keep the import non-blocking and skip this workout instead of throwing.
    return null;
  }

  const { data: inserted, error } = await supabase
    .from('sessions')
    .insert({
      athlete_id: athleteId,
      plan_id: activePlanId,
      title: `Huawei ${workout.sport}`,
      sport: workout.sport,
      scheduled_date: workoutDateIso,
      duration_mins: workout.durationMins,
      distance: workout.distanceKm,
      distance_unit: 'km',
      intensity: 'Steady',
      status: 'completed',
      completed_at: workout.startTime,
      description: 'Imported from Huawei Health',
    })
    .select('id')
    .single();

  if (error) return null;
  return inserted.id;
}

async function hasExistingLog(athleteId: string, workoutSignature: string) {
  const { data } = await supabase
    .from('session_logs')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('source', 'huawei_health')
    .eq('external_workout_id', workoutSignature)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function connectHuaweiHealth(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const connected = await huaweiAdapter.connect();
  await updateState({ connected });
  return connected;
}

export function getHuaweiAvailability() {
  if (Platform.OS !== 'android') {
    return {
      supported: false,
      reason: 'Huawei Health integration is only available on Android devices with Huawei Mobile Services.',
    };
  }
  if (isStubbedAdapter) {
    return {
      supported: false,
      reason: 'Huawei Health integration is not enabled in this app build yet. Use an HMS-enabled build with the Huawei adapter configured.',
    };
  }
  return { supported: true, reason: '' };
}

export function isHuaweiImportFileSupported(fileName: string) {
  const lower = fileName.toLowerCase();
  return ALLOWED_HUAWEI_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function normalizeSport(raw: unknown): SyncedWorkout['sport'] | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Common Huawei numeric sport codes seen in exports/integrations.
    if (raw === 1 || raw === 2) return 'run';
    if (raw === 3 || raw === 4) return 'bike';
    if (raw === 5 || raw === 6) return 'swim';
  }
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (value.includes('swim')) return 'swim';
  if (value.includes('bike') || value.includes('cycle') || value.includes('ride')) return 'bike';
  if (value.includes('run') || value.includes('jog')) return 'run';
  return null;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIsoOrNull(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1_000_000_000_000 ? raw : raw * 1000;
    const parsed = new Date(ms);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  if (/^\d+$/.test(raw.trim())) {
    const numeric = Number(raw.trim());
    if (!Number.isFinite(numeric)) return null;
    const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    const parsedNumeric = new Date(ms);
    if (Number.isNaN(parsedNumeric.getTime())) return null;
    return parsedNumeric.toISOString();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function withKmDistance(rawDistance: unknown, rawUnit?: unknown): number | null {
  const value = toNumber(rawDistance);
  if (value == null) return null;
  const unit = typeof rawUnit === 'string' ? rawUnit.toLowerCase() : '';
  if (unit.includes('m') && !unit.includes('km')) return value / 1000;
  if (unit.includes('mile') || unit === 'mi') return value * 1.60934;
  return value;
}

function withDurationMins(rawDuration: unknown): number | null {
  const value = toNumber(rawDuration);
  if (value == null) return null;
  if (value > 24 * 60) return Math.round((value / 60) * 100) / 100;
  return value;
}

function parseHuaweiJsonWorkouts(payload: unknown): SyncedWorkout[] {
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).workouts ??
          (payload as Record<string, unknown>).activities ??
          (payload as Record<string, unknown>).data)
      : null;

  const normalizedArray = Array.isArray(records) ? records : payload && typeof payload === 'object' ? [payload] : [];
  const parsed: SyncedWorkout[] = [];

  for (const record of normalizedArray) {
    if (!record || typeof record !== 'object') continue;
    const candidate = record as Record<string, unknown>;
    const sport = normalizeSport(
      candidate.sport ??
        candidate.activityType ??
        candidate.type ??
        candidate.sportType ??
        candidate.sport_type ??
        candidate.sportId ??
        candidate.sport_id
    );
    const startTime = toIsoOrNull(
      candidate.startTime ??
        candidate.start_at ??
        candidate.date ??
        candidate.datetime ??
        candidate.beginTime ??
        candidate.time ??
        candidate.startDate ??
        candidate.start_date ??
        candidate.startTimeMillis ??
        candidate.start_time_ms ??
        candidate.startTimestamp ??
        candidate.start_ts
    );
    if (!sport || !startTime) continue;

    const distanceKm = withKmDistance(
      candidate.distanceKm ??
        candidate.distance ??
        candidate.totalDistance ??
        candidate.distance_km ??
        candidate.totalDistanceMeters ??
        candidate.distanceMeters ??
        candidate.distance_m ??
        candidate.distanceInMeters,
      candidate.distanceUnit ?? candidate.unit ?? candidate.distance_unit
    );
    const durationMins = withDurationMins(
      candidate.durationMins ??
        candidate.duration ??
        candidate.totalTime ??
        candidate.duration_sec ??
        candidate.durationSeconds ??
        candidate.duration_seconds ??
        candidate.totalDuration
    );
    const avgHeartRate = toNumber(candidate.avgHeartRate ?? candidate.heartRate ?? candidate.avg_hr ?? candidate.hr);
    const externalId =
      String(candidate.id ?? candidate.workoutId ?? candidate.uuid ?? `${sport}-${startTime}-${durationMins ?? 'na'}`) || '';

    parsed.push({
      externalId,
      sport,
      startTime,
      durationMins,
      distanceKm,
      avgHeartRate,
    });
  }

  return parsed;
}

function stripXmlNamespace(xml: string) {
  return xml.replace(/(<\/?)[\w-]+:/g, '$1');
}

function parseXmlDate(xml: string) {
  const match = xml.match(/<Time>([^<]+)<\/Time>/i) ?? xml.match(/<Id>([^<]+)<\/Id>/i);
  return match?.[1] ? toIsoOrNull(match[1]) : null;
}

function parseXmlDistanceKm(xml: string) {
  const meters = xml.match(/<DistanceMeters>([^<]+)<\/DistanceMeters>/i);
  if (meters?.[1]) return withKmDistance(meters[1], 'm');
  const kilometers = xml.match(/<DistanceKilometers>([^<]+)<\/DistanceKilometers>/i);
  if (kilometers?.[1]) return withKmDistance(kilometers[1], 'km');
  return null;
}

function parseXmlDurationMins(xml: string) {
  const seconds = xml.match(/<TotalTimeSeconds>([^<]+)<\/TotalTimeSeconds>/i);
  if (seconds?.[1]) return withDurationMins(seconds[1]);
  const movingTime = xml.match(/<MovingTime>([^<]+)<\/MovingTime>/i);
  if (movingTime?.[1]) return withDurationMins(movingTime[1]);
  return null;
}

function parseXmlAvgHeartRate(xml: string) {
  const avg = xml.match(/<AverageHeartRateBpm>\s*<Value>([^<]+)<\/Value>\s*<\/AverageHeartRateBpm>/i);
  if (avg?.[1]) return toNumber(avg[1]);
  const ext = xml.match(/<gpxtpx:hr>([^<]+)<\/gpxtpx:hr>/i);
  return ext?.[1] ? toNumber(ext[1]) : null;
}

function parseGpxWorkouts(xml: string): SyncedWorkout[] {
  const stripped = stripXmlNamespace(xml);
  const tracks = Array.from(stripped.matchAll(/<trk>([\s\S]*?)<\/trk>/gi));
  const parsed: SyncedWorkout[] = [];
  for (const [index, trackMatch] of tracks.entries()) {
    const block = trackMatch[1];
    const startTime = parseXmlDate(block);
    if (!startTime) continue;
    parsed.push({
      externalId: `gpx-${index + 1}-${startTime}`,
      sport: 'run',
      startTime,
      durationMins: parseXmlDurationMins(block),
      distanceKm: parseXmlDistanceKm(block),
      avgHeartRate: parseXmlAvgHeartRate(trackMatch[0]),
    });
  }
  return parsed;
}

function parseTcxWorkouts(xml: string): SyncedWorkout[] {
  const stripped = stripXmlNamespace(xml);
  const activities = Array.from(stripped.matchAll(/<Activity[^>]*Sport="([^"]+)"[^>]*>([\s\S]*?)<\/Activity>/gi));
  const parsed: SyncedWorkout[] = [];
  for (const [index, match] of activities.entries()) {
    const sport = normalizeSport(match[1]) ?? 'run';
    const block = match[2];
    const startTime = parseXmlDate(block);
    if (!startTime) continue;
    parsed.push({
      externalId: `tcx-${index + 1}-${startTime}`,
      sport,
      startTime,
      durationMins: parseXmlDurationMins(block),
      distanceKm: parseXmlDistanceKm(block),
      avgHeartRate: parseXmlAvgHeartRate(block),
    });
  }
  return parsed;
}

async function parseHuaweiFile(fileUri: string, fileName: string): Promise<SyncedWorkout[]> {
  const content = await FileSystem.readAsStringAsync(fileUri);
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Could not parse JSON file. Please export Huawei workouts as valid JSON and retry.');
    }
    const workouts = parseHuaweiJsonWorkouts(parsed);
    if (workouts.length === 0) {
      throw new Error('No supported workouts were found in this JSON file.');
    }
    return workouts;
  }
  if (lower.endsWith('.gpx')) {
    const workouts = parseGpxWorkouts(content);
    if (workouts.length === 0) {
      throw new Error('This GPX file format is not supported yet. Export a standard track GPX with timestamps and retry.');
    }
    return workouts;
  }
  if (lower.endsWith('.tcx')) {
    const workouts = parseTcxWorkouts(content);
    if (workouts.length === 0) {
      throw new Error('This TCX file format is not supported yet. Export a standard activity TCX and retry.');
    }
    return workouts;
  }
  throw new Error('Unsupported file type. Choose a .tcx, .gpx, or .json Huawei export file.');
}

export async function disconnectHuaweiHealth(): Promise<void> {
  await huaweiAdapter.disconnect();
  await updateState({ connected: false });
}

export async function getHuaweiIntegrationState(): Promise<HuaweiIntegrationState> {
  return getState();
}

export async function syncRecentWorkouts(athleteId: string, lastSyncDate: Date): Promise<SyncedWorkout[]> {
  const availability = getHuaweiAvailability();
  if (!availability.supported) {
    throw new Error(availability.reason);
  }
  const state = await getState();
  if (!state.connected) {
    throw new Error('Huawei Health is not connected. Connect your Huawei account first.');
  }

  const workouts = await huaweiAdapter.fetchWorkoutsSince(lastSyncDate);
  const synced: SyncedWorkout[] = [];

  for (const workout of workouts) {
    const signature = makeWorkoutSignature(workout);
    const alreadyImported = await hasExistingLog(athleteId, signature);
    if (alreadyImported) continue;

    const sessionId = await ensureSessionForWorkout(athleteId, workout);
    if (!sessionId) continue;

    const notes = `Imported from Huawei Health (${workout.sport})`;
    const { error } = await supabase.from('session_logs').insert({
      session_id: sessionId,
      athlete_id: athleteId,
      completed_at: workout.startTime,
      actual_duration_mins: workout.durationMins,
      actual_distance: workout.distanceKm,
      avg_heart_rate: workout.avgHeartRate,
      rpe: null,
      notes,
      source: 'huawei_health',
      external_workout_id: signature,
    });

    if (!error) {
      synced.push(workout);
    }
  }

  await updateState({ lastSyncAt: new Date().toISOString() });
  return synced;
}

export async function importHuaweiWorkoutsFromFile(
  athleteId: string,
  fileUri: string,
  fileName: string
): Promise<HuaweiImportSummary> {
  if (!isHuaweiImportFileSupported(fileName)) {
    throw new Error('Unsupported file type. Choose .tcx, .gpx, or .json.');
  }

  const workouts = await parseHuaweiFile(fileUri, fileName);
  const summary: HuaweiImportSummary = { imported: 0, skipped: 0, errors: [] };

  for (const workout of workouts) {
    try {
      const signature = makeWorkoutSignature(workout);
      const alreadyImported = await hasExistingLog(athleteId, signature);
      if (alreadyImported) {
        summary.skipped += 1;
        continue;
      }
      const sessionId = await ensureSessionForWorkout(athleteId, workout);
      if (!sessionId) {
        summary.skipped += 1;
        continue;
      }

      const { error } = await supabase.from('session_logs').insert({
        session_id: sessionId,
        athlete_id: athleteId,
        completed_at: workout.startTime,
        actual_duration_mins: workout.durationMins,
        actual_distance: workout.distanceKm,
        avg_heart_rate: workout.avgHeartRate,
        rpe: null,
        notes: `Imported from Huawei Health file (${workout.sport})`,
        source: 'huawei_health',
        external_workout_id: signature,
      });

      if (error) {
        summary.errors.push(error.message);
      } else {
        summary.imported += 1;
      }
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : 'Unknown workout import error');
    }
  }

  if (summary.imported > 0) {
    await updateState({ lastSyncAt: new Date().toISOString() });
  }
  return summary;
}

export async function triggerHuaweiAutoSyncIfNeeded(athleteId: string): Promise<void> {
  const state = await getState();
  if (!state.connected) return;

  const now = Date.now();
  const lastAuto = state.lastAutoSyncAt ? new Date(state.lastAutoSyncAt).getTime() : 0;
  if (now - lastAuto < SIX_HOURS_MS) return;

  const lastSyncDate = state.lastSyncAt ? new Date(state.lastSyncAt) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  try {
    await syncRecentWorkouts(athleteId, lastSyncDate);
    await updateState({ lastAutoSyncAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[HuaweiHealthSync] failed: ${message}`);
  }
}

export function wireHuaweiAutoSyncOnAppOpen(getAthleteId: () => string | null | undefined) {
  const sub = AppState.addEventListener('change', (nextState) => {
    if (nextState !== 'active') return;
    const athleteId = getAthleteId();
    if (!athleteId) return;
    void triggerHuaweiAutoSyncIfNeeded(athleteId);
  });
  return () => sub.remove();
}
