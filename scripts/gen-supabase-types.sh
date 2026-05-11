#!/usr/bin/env bash
# Regenerate types/supabase.ts from the linked Supabase project (public schema).
#
# Prerequisite: authenticate once so the CLI can call the Management API:
#   npx supabase login
#   (or set SUPABASE_ACCESS_TOKEN in the environment)
#
# Project ref is read from EXPO_PUBLIC_SUPABASE_URL in .env (…/<ref>.supabase.co).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — create it from .env.example first." >&2
  exit 1
fi

REF="$(node -e "
const fs = require('fs');
const t = fs.readFileSync('.env', 'utf8');
const m = t.match(/EXPO_PUBLIC_SUPABASE_URL\\s*=\\s*https?:\\/\\/([^.]+)\\.supabase\\.co/i);
if (!m) process.exit(1);
process.stdout.write(m[1]);
")"

echo "Using project ref: ${REF}"
npx --yes supabase gen types typescript --project-id "${REF}" --schema public > types/supabase.ts
echo "Wrote types/supabase.ts"
