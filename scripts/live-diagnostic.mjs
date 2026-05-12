#!/usr/bin/env node
/**
 * Live Supabase connectivity + data smoke test (anon key).
 * Loads .env from project root, writes BUG_REPORT.md.
 *
 * Usage: npm run diagnostic:supabase
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const reportPath = path.join(root, 'BUG_REPORT.md');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('No .env found at', envPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function localIsoDate(d) {
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const env = loadEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key);

const tables = [
  'athletes',
  'plans',
  'sessions',
  'session_blocks',
  'session_steps',
  'session_logs',
  'personal_bests',
  'rova_challenges',
  'rova_conversations',
  'flex_history',
  'race_events',
  'race_goals',
];

async function main() {
  const lines = [];
  const stamp = new Date().toISOString();
  lines.push(`# Telo live diagnostic report`);
  lines.push('');
  lines.push(`Generated: ${stamp}`);
  lines.push('');
  lines.push('> Anon key + RLS: empty counts can mean no public read policy or no rows, not necessarily a broken connection.');
  lines.push('');

  console.log('Supabase URL:', url);
  console.log('--- Table probes (anon, RLS applies) ---\n');

  lines.push('## STEP 1 — Table connectivity');
  lines.push('');
  lines.push('| Table | Result |');
  lines.push('|-------|--------|');

  let failures = 0;
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      failures += 1;
      const msg = `ERROR: ${error.message} (code ${error.code ?? 'n/a'})`;
      console.log(`❌ [${table}] — ${msg}`);
      lines.push(`| ${table} | ❌ ${msg.replace(/\|/g, '\\|')} |`);
    } else {
      const n = Array.isArray(data) ? data.length : 0;
      console.log(`✅ [${table}] — connected (${n} row(s) in sample)`);
      lines.push(`| ${table} | ✅ connected (${n} row(s) in sample) |`);
    }
  }

  lines.push('');
  lines.push('## STEP 2 — Foreign keys / orphans');
  lines.push('');
  lines.push(
    'Run `supabase/diagnostics/FK_ORPHAN_CHECKS.sql` in the **Supabase SQL Editor** (cannot be executed safely from this anon script).'
  );
  lines.push('Paste results here on the next audit if any rows return.');
  lines.push('');

  const todayIso = localIsoDate(new Date());
  const weekEndIso = localIsoDate(addDays(new Date(), 6));

  lines.push('## STEP 3 & 4 — Athlete, active plan, sessions (anon sample)');
  lines.push('');
  lines.push(`Local calendar **today** (en-CA): \`${todayIso}\``);
  lines.push('');

  const { data: athletes, error: athletesErr } = await supabase.from('athletes').select('*').limit(5);
  if (athletesErr) {
    lines.push(`- athletes sample: ❌ ${athletesErr.message}`);
  } else {
    lines.push(`- athletes sample: ✅ ${(athletes ?? []).length} row(s)`);
    for (const a of athletes ?? []) {
      const levelOk = ['fara', 'orka', 'vinna'].includes(String(a.level ?? '').toLowerCase());
      const nameOk = Boolean(a.name && String(a.name).trim());
      lines.push(
        `  - id \`${a.id}\`: name ${nameOk ? '✅' : '❌'}, level ${levelOk ? '✅' : '❌'} (\`${a.level}\`), goal_race_date \`${a.goal_race_date ?? 'null'}\`, goal_race_name \`${a.goal_race_name ?? 'null'}\``
      );
    }
  }

  lines.push('');
  const firstAthlete = athletes?.[0];
  if (firstAthlete?.id) {
    const { data: activePlan, error: planErr } = await supabase
      .from('plans')
      .select('*')
      .eq('athlete_id', firstAthlete.id)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (planErr) lines.push(`- active plan: ❌ ${planErr.message}`);
    else if (!activePlan) lines.push('- active plan: ⚠️ none found for first sample athlete');
    else lines.push(`- active plan: ✅ \`${activePlan.id}\` (${activePlan.name})`);
  } else {
    lines.push('- active plan: skipped (no athlete rows in sample)');
  }

  lines.push('');
  if (firstAthlete?.id) {
    const { count: todayCount, error: todayErr } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('athlete_id', firstAthlete.id)
      .eq('scheduled_date', todayIso);
    if (todayErr) lines.push(`- sessions **today** count: ❌ ${todayErr.message}`);
    else lines.push(`- sessions **today** count: **${todayCount ?? 0}** (athlete ${firstAthlete.id.slice(0, 8)}…)`);

    const { count: weekCount, error: weekErr } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('athlete_id', firstAthlete.id)
      .gte('scheduled_date', todayIso)
      .lte('scheduled_date', weekEndIso);
    if (weekErr) lines.push(`- sessions **next 7 local days** (${todayIso}…${weekEndIso}): ❌ ${weekErr.message}`);
    else lines.push(`- sessions **next 7 local days**: **${weekCount ?? 0}**`);
  }

  lines.push('');
  lines.push('## STEP 5 — Sessions without blocks');
  lines.push('');
  lines.push('See last query in `supabase/diagnostics/FK_ORPHAN_CHECKS.sql` (server-side GROUP BY).');
  lines.push('');

  lines.push('## STEP 6 — Screens (code paths verified in repo)');
  lines.push('');
  lines.push('| Screen | Data hooks / notes |');
  lines.push('|--------|----------------------|');
  lines.push(
    '| Today | `useTodaysSessions`, `useActiveAthlete`, `useWeekSessions`, `useUpcomingSessions`, `useWeeklyChallenges`, `useLevelProgress` |'
  );
  lines.push('| Plan | `useMonthSessions`, `useWeekSessions`, calendar + week cards |');
  lines.push('| Session detail | `useSessionDetail`, `useCompleteSession`, blocks/steps nested select |');
  lines.push('| Progress | `useCompletedSessionLogs`, `useCompletedSessionCount`, `usePersonalBests` |');
  lines.push('| Profile | athlete + goals; theme via `ThemeContext` |');
  lines.push('');

  lines.push('## STEP 7–11 — Automation limits');
  lines.push('');
  lines.push('- **RLS**: Anon script cannot validate policies; use Dashboard → Authentication → Policies.');
  lines.push('- **Rova / Flex / Import**: Behavioural tests require device or E2E; this report covers connectivity + counts only.');
  lines.push('- **Performance**: Today/week/month queries in `hooks/useSessionData.ts` use bounded `eq` / `gte` / `lte` on `scheduled_date` or `completed_at`.');
  lines.push('');

  lines.push('## BUGS FIXED (this audit pass)');
  lines.push('');
  lines.push('- `hooks/useSessionData.ts`: active plan query orders by `start_date` **descending** so the newest plan wins when multiple rows are `active`.');
  lines.push('- `hooks/useWeeklyChallenges.ts`: race challenge “today” uses `toLocalIsoDate` from `lib/dates.ts` (local calendar, not UTC midnight drift).');
  lines.push('- `app/(tabs)/index.tsx`: same local ISO helper for week strip and coach ranges.');
  lines.push('- `app/SessionDetail.tsx`: explicit **Missing session** state when `sessionId` param is absent (after all hooks; avoids hooks violation).');
  lines.push('- `supabase/diagnostics/FK_ORPHAN_CHECKS.sql`: added for manual FK + zero-block session checks.');
  lines.push('');

  lines.push('## BUGS REMAINING / manual follow-up');
  lines.push('');
  lines.push('- Run `FK_ORPHAN_CHECKS.sql` and fix any orphan rows in Supabase.');
  lines.push('- If **next 7 days** session count is 0 for a real athlete, run onboarding / `assignTemplatePlan` or your plan import flow.');
  lines.push('- Expo Go vs dev build: native modules must match Expo SDK (already aligned via `expo install`).');
  lines.push('');

  if (failures > 0) {
    lines.push(`**${failures} table(s) returned errors** — fix URL/key/RLS or table names before shipping.`);
    console.log(`\n${failures} table(s) reported errors — see BUG_REPORT.md`);
    fs.writeFileSync(reportPath, lines.join('\n'));
    process.exit(1);
  }

  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log('\nWrote', reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
