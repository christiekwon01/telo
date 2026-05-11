import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RegisterBody = {
  athleteId?: string;
  token?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function sanitizeToken(value: string | null) {
  if (!value) return null;
  const token = value.trim();
  if (token.length < 12 || token.length > 256) return null;
  if (!/^[A-Za-z0-9._~-]+$/.test(token)) return null;
  return token;
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function toUtcStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function toIcsDate(isoDate: string) {
  return isoDate.replace(/-/g, '');
}

function cleanSessionTitle(rawTitle: string | null | undefined, sport: string | null | undefined) {
  const fallback = sport ? `${sport[0].toUpperCase()}${sport.slice(1)} Session` : 'Training Session';
  const source = (rawTitle ?? '').trim();
  if (!source) return fallback;
  const cleaned = source.replace(/\bplaceholder\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'POST') {
    let body: RegisterBody = {};
    try {
      body = (await req.json()) as RegisterBody;
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON payload' });
    }

    const athleteId = body.athleteId?.trim();
    const token = sanitizeToken(body.token ?? null);
    if (!athleteId || !UUID_RE.test(athleteId)) {
      return jsonResponse(400, { error: 'athleteId must be a valid UUID' });
    }
    if (!token) {
      return jsonResponse(400, { error: 'token must be 12-256 chars using URL-safe characters' });
    }

    const tokenHash = await sha256Hex(token);
    const { error } = await supabase
      .from('apple_calendar_subscriptions')
      .upsert(
        {
          athlete_id: athleteId,
          token_hash: tokenHash,
        },
        { onConflict: 'athlete_id' }
      );

    if (error) {
      return jsonResponse(500, { error: error.message });
    }

    const subscribeUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/apple-calendar-subscription?token=${encodeURIComponent(token)}`;
    return jsonResponse(200, { subscribeUrl });
  }

  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const token = sanitizeToken(new URL(req.url).searchParams.get('token'));
  if (!token) {
    return jsonResponse(400, { error: 'token is required' });
  }

  const tokenHash = await sha256Hex(token);
  const { data: mapping, error: mappingError } = await supabase
    .from('apple_calendar_subscriptions')
    .select('athlete_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (mappingError) {
    return jsonResponse(500, { error: mappingError.message });
  }
  if (!mapping?.athlete_id) {
    return jsonResponse(404, { error: 'Subscription not found' });
  }

  const start = new Date();
  const startIso = start.toISOString().slice(0, 10);
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  const endIso = end.toISOString().slice(0, 10);

  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('id,title,sport,scheduled_date,duration_mins,status,description')
    .eq('athlete_id', mapping.athlete_id)
    .gte('scheduled_date', startIso)
    .lte('scheduled_date', endIso)
    .neq('status', 'completed')
    .order('scheduled_date', { ascending: true });

  if (sessionsError) {
    return jsonResponse(500, { error: sessionsError.message });
  }

  const nowStamp = toUtcStamp(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Telo//Training Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Telo Training',
    'X-WR-TIMEZONE:UTC',
  ];

  for (const session of sessions ?? []) {
    const startDate = session.scheduled_date;
    const endDateExclusive = new Date(`${startDate}T00:00:00Z`);
    endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() + 1);
    const endDate = endDateExclusive.toISOString().slice(0, 10);
    const title = escapeIcs(cleanSessionTitle(session.title, session.sport));
    const description = escapeIcs(
      [session.description, `Sport: ${session.sport}`, `Session ID: ${session.id}`].filter(Boolean).join('\n')
    );
    lines.push(
      'BEGIN:VEVENT',
      `UID:telo-session-${session.id}@telo.app`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(startDate)}`,
      `DTEND;VALUE=DATE:${toIcsDate(endDate)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${description}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  return new Response(`${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});
