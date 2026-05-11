import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/supabase';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing Supabase environment variables: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env.example).'
  );
}

/** Never reject: Supabase client can trigger storage reads/writes without awaiting; rejections become LogBox noise. */
const storageAdapter = {
  getItem: async (key: string) => {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: async (key: string) => {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const baseFetch: typeof fetch = (...args) => fetch(...args);

function redactSupabaseUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const sensitiveParams = ['token', 'apikey', 'authorization', 'access_token', 'refresh_token'];
    for (const key of sensitiveParams) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function requestInfoUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  return (input as Request).url;
}

function requestInfoMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof input !== 'string' && !(typeof URL !== 'undefined' && input instanceof URL)) {
    return (input as Request).method;
  }
  return 'GET';
}

const loggingFetch: typeof fetch = async (input, init) => {
  const startedAt = new Date();
  const url = requestInfoUrl(input);
  const safeUrl = redactSupabaseUrl(url);
  const method = requestInfoMethod(input, init);
  if (__DEV__) {
    console.log(`[${startedAt.toISOString()}] [Supabase] Request ${method} ${safeUrl}`);
  }
  try {
    const response = await baseFetch(input, init);
    const endedAt = new Date();
    if (__DEV__) {
      console.log(
        `[${endedAt.toISOString()}] [Supabase] Response ${method} ${safeUrl} -> ${response.status} ${response.statusText}`
      );
    }
    return response;
  } catch (error) {
    const failedAt = new Date();
    if (__DEV__) {
      console.log(
        `[${failedAt.toISOString()}] [Supabase] Error ${method} ${safeUrl}`,
        error instanceof Error ? error.message : error
      );
    }
    throw error;
  }
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: storageAdapter,
    // Anonymous + persisted JWT so strict RLS (`auth.uid()`) works on every request.
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: loggingFetch,
  },
});
