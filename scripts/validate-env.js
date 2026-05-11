#!/usr/bin/env node
/**
 * Fails the build if required public env vars are missing or still look like placeholders.
 * Run: node scripts/validate-env.js   (or npm run prebuild:check)
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const PLACEHOLDER =
  /your_|your_project|your_anon|your_api|placeholder|changeme|example\.com\/your|\bREPLACE\b|TODO_KEY/i;

const REQUIRED = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_ANTHROPIC_API_KEY',
];

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

if (!fs.existsSync(envPath)) {
  console.error('[validate-env] Missing .env — copy .env.example to .env and set real values.');
  process.exit(1);
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
let ok = true;

for (const key of REQUIRED) {
  const v = env[key];
  if (!v || !String(v).trim()) {
    console.error(`[validate-env] Missing or empty: ${key}`);
    ok = false;
    continue;
  }
  if (PLACEHOLDER.test(String(v).trim())) {
    console.error(`[validate-env] ${key} still looks like a placeholder — set a real value for TestFlight/EAS.`);
    ok = false;
  }
}

if (!ok) {
  process.exit(1);
}

console.log('[validate-env] Required EXPO_PUBLIC_* keys look configured.');
