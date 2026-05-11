# Supabase Setup

## 1) Configure environment variables

Copy `.env.example` to `.env` and set:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### Strict RLS + onboarding

The app uses **Supabase Anonymous Sign-In** so `auth.uid()` matches `athletes.id` and strict row policies work.

In the Supabase Dashboard:

1. **Authentication → Providers → Anonymous** → enable **Allow anonymous sign-ins**.
2. After changing auth settings, retry onboarding (**Enter telo**).

If anonymous sign-ins stay disabled, creating an athlete during onboarding will fail with RLS / auth errors.

## 2) Apply migrations

Use the Supabase CLI migration flow (recommended) or run SQL in order.

Current migration files:

- `supabase/migrations/20260508162400_create_race_goals.sql`
- `supabase/migrations/20260508170500_launch_hardening_pack.sql`
- `supabase/migrations/20260508171500_rls_compat_current_auth.sql`
- `supabase/migrations/20260508172000_bootstrap_core_tables.sql`
- `supabase/migrations/20260508172500_add_athlete_background_columns.sql`
- `supabase/migrations/20260508223500_add_apple_calendar_subscriptions.sql`
- `supabase/migrations/20260509121500_harden_apple_calendar_function_and_index_fk.sql`
- `supabase/migrations/20260509124500_enable_rls_compat_mode.sql`
- `supabase/migrations/20260509125500_canonicalize_race_contract_to_race_goals.sql`

Recommended commands:

- `supabase db push`
- `supabase migration list`

## 3) App integration status

Already wired in app:

- Supabase client: `lib/supabase.ts`
- Today query hook: `hooks/useSessionData.ts` (`useTodaysSessions`)
- Today View uses live session data: `app/(tabs)/index.tsx`
- Database types: `types/supabase.ts`

## 4) Generate database types

Regenerate TypeScript types from the live project schema:

```bash
supabase gen types typescript --project-id <project_ref> --schema public > types/supabase.ts
```

## 5) Quick verification query

```sql
select scheduled_date, title, sport, duration_mins, week_number, phase
from public.sessions
order by scheduled_date, title;
```

## 6) Apple Calendar subscription feed

The app now auto-generates per-athlete subscription URLs via Supabase Edge Function:

- Function: `apple-calendar-subscription`
- Feed URL shape: `https://<project-ref>.supabase.co/functions/v1/apple-calendar-subscription?token=<token>`
- App opens it as `webcal://...` for Apple Calendar subscribe flow.

One-time setup/deploy:

```bash
supabase db push
supabase functions deploy apple-calendar-subscription --no-verify-jwt
```

Immediate runbook (to make subscribe link live now):

```bash
# 1) Apply latest schema (includes apple_calendar_subscriptions)
supabase db push

# 2) Deploy the edge function that registers tokens + serves ICS
supabase functions deploy apple-calendar-subscription --no-verify-jwt

# 3) Restart Metro so app picks up any config/env updates
npx expo start -c
```

Local test:

```bash
supabase functions serve apple-calendar-subscription --no-verify-jwt
```

Optional fallback:

- You can still set `EXPO_PUBLIC_APPLE_CALENDAR_SUBSCRIPTION_URL` (or `EXPO_PUBLIC_CALENDAR_SUBSCRIPTION_URL`) to a static/template URL if edge functions are unavailable.

## 7) Huawei Health import (v1)

Huawei native OAuth sync is intentionally not enabled in this build. Use file import:

1. Open **Profile -> Huawei Health**.
2. Tap **Upload Huawei Health file**.
3. Select a Huawei export file (`.tcx`, `.gpx`, or `.json`).
4. Wait for import toast/summary, then refresh sessions/progress views.

## 8) Race table contract (canonical)

- Canonical app table: `public.race_goals`.
- Backward compatibility table: `public.race_events` is synced from `race_goals` by trigger.
- New writes should target `race_goals`; `race_events` remains for compatibility until legacy consumers are removed.

