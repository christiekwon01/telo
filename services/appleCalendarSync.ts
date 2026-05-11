import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

const APPLE_CALENDAR_PREFS_KEY = 'telo:apple-calendar:prefs:v1';
const APPLE_CALENDAR_SUBSCRIPTION_TOKEN_KEY = 'telo:apple-calendar:subscription-token:v1';

export type DefaultSessionTime = '6am' | '12pm' | '6pm';
export type SyncRange = 'week' | 'two_weeks' | 'month';

export type AppleCalendarPrefs = {
  enabled: boolean;
  removeCompleted: boolean;
  defaultSessionTime: DefaultSessionTime;
  syncRange: SyncRange;
  calendarId: string | null;
};

export type AppleCalendarSubscriptionState = {
  url: string | null;
  configured: boolean;
  source: 'edge-function' | 'env' | 'config-extra' | 'template';
};

const DEFAULT_PREFS: AppleCalendarPrefs = {
  enabled: false,
  removeCompleted: true,
  defaultSessionTime: '6am',
  syncRange: 'week',
  calendarId: null,
};

function randomToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function tokenStorageKey(athleteId?: string | null) {
  return athleteId ? `${APPLE_CALENDAR_SUBSCRIPTION_TOKEN_KEY}:${athleteId}` : APPLE_CALENDAR_SUBSCRIPTION_TOKEN_KEY;
}

async function getSubscriptionToken(athleteId?: string | null) {
  try {
    const existing = await AsyncStorage.getItem(tokenStorageKey(athleteId));
    if (existing) return existing;
    const created = randomToken();
    await AsyncStorage.setItem(tokenStorageKey(athleteId), created);
    return created;
  } catch {
    return randomToken();
  }
}

async function setSubscriptionToken(token: string, athleteId?: string | null) {
  try {
    await AsyncStorage.setItem(tokenStorageKey(athleteId), token);
  } catch {
    /* ignore */
  }
}

function cleanUrl(url: string | undefined | null) {
  if (!url) return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getEnvSubscriptionBaseUrl() {
  return (
    cleanUrl(process.env.EXPO_PUBLIC_APPLE_CALENDAR_SUBSCRIPTION_URL) ??
    cleanUrl(process.env.EXPO_PUBLIC_CALENDAR_SUBSCRIPTION_URL)
  );
}

function getExtraSubscriptionBaseUrl() {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const candidates = [
    extra.appleCalendarSubscriptionUrl,
    extra.calendarSubscriptionUrl,
    extra.appleCalendarSubscriptionTemplate,
    extra.calendarSubscriptionTemplate,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function substituteTemplate(template: string, token: string, athleteId?: string | null) {
  return template
    .replace('{token}', encodeURIComponent(token))
    .replace('{athleteId}', encodeURIComponent(athleteId ?? ''));
}

function getSupabaseFunctionBaseUrl() {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const functionPath = typeof extra.appleCalendarSubscriptionFunctionPath === 'string'
    ? extra.appleCalendarSubscriptionFunctionPath.trim()
    : '';
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return null;
  const path = functionPath.length > 0 ? functionPath : '/functions/v1/apple-calendar-subscription';
  return `${supabaseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function toWebcalUrl(url: string) {
  if (url.startsWith('https://')) return `webcal://${url.slice('https://'.length)}`;
  return url;
}

async function registerSubscriptionToken(athleteId: string, token: string) {
  const endpoint = getSupabaseFunctionBaseUrl();
  if (!endpoint) return null;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteId, token }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { subscribeUrl?: string };
    const generatedUrl = cleanUrl(payload.subscribeUrl ?? null);
    if (!generatedUrl) return null;
    return generatedUrl;
  } catch {
    return null;
  }
}

export async function getAppleCalendarPrefs(): Promise<AppleCalendarPrefs> {
  try {
    const raw = await AsyncStorage.getItem(APPLE_CALENDAR_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AppleCalendarPrefs>;
    return {
      enabled: Boolean(parsed.enabled),
      removeCompleted: parsed.removeCompleted ?? true,
      defaultSessionTime: parsed.defaultSessionTime ?? '6am',
      syncRange: parsed.syncRange ?? 'week',
      calendarId: parsed.calendarId ?? null,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setAppleCalendarPrefs(next: AppleCalendarPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(APPLE_CALENDAR_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export async function updateAppleCalendarPrefs(partial: Partial<AppleCalendarPrefs>): Promise<AppleCalendarPrefs> {
  const current = await getAppleCalendarPrefs();
  const next = { ...current, ...partial };
  await setAppleCalendarPrefs(next);
  return next;
}

export async function requestCalendarPermission() {
  if (Platform.OS !== 'ios') {
    return { granted: false, canAskAgain: false, status: 'undetermined' as const };
  }
  return Calendar.requestCalendarPermissionsAsync();
}

async function hasCalendarPermission() {
  if (Platform.OS !== 'ios') return false;
  const permission = await Calendar.getCalendarPermissionsAsync();
  return permission.granted;
}

async function getDefaultSource() {
  const defaultCalendar = await Calendar.getDefaultCalendarAsync();
  return defaultCalendar.source;
}

export async function isAppleCalendarSupported() {
  return Platform.OS === 'ios';
}

export async function getAppleCalendarSubscriptionState(athleteId?: string | null): Promise<AppleCalendarSubscriptionState> {
  if (athleteId) {
    const token = await getSubscriptionToken(athleteId);
    const generatedUrl = await registerSubscriptionToken(athleteId, token);
    if (generatedUrl) {
      return {
        url: toWebcalUrl(generatedUrl),
        configured: true,
        source: 'edge-function',
      };
    }
  }

  const token = await getSubscriptionToken(athleteId);
  const envUrl = getEnvSubscriptionBaseUrl();
  if (envUrl) {
    return {
      url: envUrl.includes('{token}') || envUrl.includes('{athleteId}') ? substituteTemplate(envUrl, token, athleteId) : envUrl,
      configured: true,
      source: 'env',
    };
  }

  const extraUrl = getExtraSubscriptionBaseUrl();
  if (extraUrl) {
    return {
      url:
        extraUrl.includes('{token}') || extraUrl.includes('{athleteId}')
          ? substituteTemplate(extraUrl, token, athleteId)
          : extraUrl,
      configured: true,
      source: 'config-extra',
    };
  }

  return {
    url: null,
    configured: false,
    source: 'template',
  };
}

export async function refreshAppleCalendarSubscriptionState(athleteId?: string | null): Promise<AppleCalendarSubscriptionState> {
  await setSubscriptionToken(randomToken(), athleteId);
  return getAppleCalendarSubscriptionState(athleteId);
}

export async function resolveAppleCalendarId(preferredCalendarId: string | null): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  if (preferredCalendarId) {
    try {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const existing = calendars.find((calendar) => calendar.id === preferredCalendarId);
      if (existing?.id) return existing.id;
    } catch {
      // Ignore stale IDs and attempt to create a new calendar.
    }
  }
  return createTeloCalendar();
}

export async function createTeloCalendar() {
  if (Platform.OS !== 'ios') return null;
  const granted = await hasCalendarPermission();
  if (!granted) return null;
  const source = await getDefaultSource();
  const calendarId = await Calendar.createCalendarAsync({
    title: 'Telo Training',
    color: '#C97E2F',
    entityType: Calendar.EntityTypes.EVENT,
    sourceId: source.id,
    source,
    name: 'Telo Training',
    ownerAccount: 'personal',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
  await updateAppleCalendarPrefs({ calendarId });
  return calendarId;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toLocalIsoDate(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function rangeDays(pref: SyncRange) {
  if (pref === 'month') return 31;
  if (pref === 'two_weeks') return 14;
  return 7;
}

function sessionEventId(sessionId: string) {
  return `telo-session-${sessionId}`;
}

function cleanSessionTitle(rawTitle: string | null | undefined, sport: string | null | undefined) {
  const fallback = sport ? `${sport[0].toUpperCase()}${sport.slice(1)} Session` : 'Training Session';
  const source = (rawTitle ?? '').trim();
  if (!source) return fallback;
  const cleaned = source.replace(/\bplaceholder\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export async function syncSessionsToCalendar(athleteId: string, calendarId: string, weekStart: Date) {
  if (Platform.OS !== 'ios') return 0;
  const granted = await hasCalendarPermission();
  if (!granted) {
    throw new Error('Calendar permission is disabled. Enable Calendar access for Telo in iOS Settings and try again.');
  }
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    if (!calendars.some((calendar) => calendar.id === calendarId)) {
      throw new Error('Calendar not found');
    }
  } catch {
    throw new Error('Selected calendar is unavailable. Re-enable Apple Calendar sync to create or select a usable calendar.');
  }
  const prefs = await getAppleCalendarPrefs();
  const limitDays = rangeDays(prefs.syncRange);
  const startIso = toLocalIsoDate(weekStart);
  const endIso = toLocalIsoDate(addDays(weekStart, limitDays - 1));

  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('id,title,sport,scheduled_date,duration_mins,status')
    .eq('athlete_id', athleteId)
    .gte('scheduled_date', startIso)
    .lte('scheduled_date', endIso)
    .order('scheduled_date', { ascending: true });

  if (error) throw new Error(error.message);

  let synced = 0;
  for (const session of sessions ?? []) {
    if (prefs.removeCompleted && session.status === 'completed') continue;
    const [year, month, day] = session.scheduled_date.split('-').map(Number);
    const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endDate = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
    const title = cleanSessionTitle(session.title, session.sport);

    const notes = `Sport: ${session.sport}\nSession ID: ${session.id}\nManaged by Telo`;
    const existing = await Calendar.getEventsAsync([calendarId], addDays(startDate, -30), addDays(endDate, 30));
    const match = existing.find((event) => event.id === sessionEventId(session.id) || event.notes?.includes(`Session ID: ${session.id}`));

    if (match) {
      await Calendar.updateEventAsync(match.id, {
        title,
        startDate,
        endDate,
        allDay: true,
        notes,
      });
    } else {
      await Calendar.createEventAsync(calendarId, {
        title,
        startDate,
        endDate,
        allDay: true,
        notes,
      });
    }
    synced += 1;
  }
  return synced;
}

export async function removeCompletedFromCalendar(sessionId: string, calendarId: string) {
  if (Platform.OS !== 'ios') return;
  const now = new Date();
  const events = await Calendar.getEventsAsync([calendarId], addDays(now, -120), addDays(now, 120));
  const match = events.find((event) => event.id === sessionEventId(sessionId) || event.notes?.includes(`Session ID: ${sessionId}`));
  if (match) {
    await Calendar.deleteEventAsync(match.id);
  }
}

export async function syncAppleCalendarIfEnabled(athleteId: string, anchorDate = new Date()) {
  if (Platform.OS !== 'ios') return;
  const prefs = await getAppleCalendarPrefs();
  if (!prefs.enabled || !prefs.calendarId) return;
  try {
    await syncSessionsToCalendar(athleteId, prefs.calendarId, anchorDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[AppleCalendarSync] failed: ${message}`);
  }
}
