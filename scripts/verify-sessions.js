/**
 * Verifies seed data: logs first 5 sessions by scheduled_date.
 * Run: npm run verify-sessions
 * Requires .env with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error('Missing .env at', filePath);
    process.exit(1);
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function main() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = loadEnvFile(envPath);
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes('your_project') || key.includes('your_anon')) {
    console.error('Set real EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env first.');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('scheduled_date', { ascending: true })
    .limit(5);

  if (error) {
    console.error('Supabase error:', error);
    process.exit(1);
  }

  const { count, error: countError } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.warn('Count check warning:', countError.message);
  }

  console.log('First 5 sessions (scheduled_date asc):');
  console.log(JSON.stringify(data, null, 2));

  if (!data?.length) {
    console.log('\n---');
    console.log(
      'No rows returned. Common causes:\n' +
        '  1) Table is empty — run the schema migration seed or paste your INSERT SQL in the SQL editor.\n' +
        '  2) Row Level Security — if sessions has RLS on and no SELECT policy for role `anon`, PostgREST returns [].\n' +
        '     Fix: run supabase/migrations/20260507120000_telo_rls_mvp_open_access.sql in the Supabase SQL editor.\n' +
        '  3) Wrong project — confirm EXPO_PUBLIC_SUPABASE_URL matches the project where you inserted data.\n' +
        (typeof count === 'number'
          ? `\n  (Anon-visible row count from API: ${count}. If Table Editor shows rows but count is 0, it is almost certainly RLS.)`
          : '')
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
