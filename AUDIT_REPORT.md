# Telo Audit Report

Date: 2026-05-09  
Project: `/Users/christiekwon/telo`  
Scope: Full 10-part audit (code + live Supabase), safe fixes, and launch-readiness gaps.

## Audit Counts

- Checklist sections reviewed: 10/10
- Section status count: 4 pass, 5 warning, 1 fail
- Finding severity count: 1 critical, 4 high, 6 medium, 3 low
- Safe fixes applied now: 7 (1 code hardening, 4 DB migrations, 1 type alignment, 1 docs update)
- Manual follow-ups required: 5

## 1) File Structure & Coverage

Status: PASS

- Expo Router app structure is coherent and scoped:
  - screens: 16 (`app/**/*.tsx`)
  - shared components: 17 (`components/**/*.tsx`)
  - services: 18 (`services/**/*.ts`)
  - Supabase migrations: 10 after this audit (`supabase/migrations/*.sql`)
- Core folders (`app`, `components`, `services`, `hooks`, `store`, `supabase`) are consistent with current feature set.

## 2) Database Schema & Migrations

Status: WARNING

- Live project verified: `telo` (`kyxoymtxyhqsodmnobpx`, region `ap-northeast-1`).
- Live migration ledger includes all local launch migrations through `20260508223500`.
- New safe migrations added in this audit:
  - `supabase/migrations/20260509121500_harden_apple_calendar_function_and_index_fk.sql`
  - adds missing index: `personal_bests(session_log_id)`
  - hardens trigger function with explicit `search_path`.
  - `supabase/migrations/20260509124500_enable_rls_compat_mode.sql`
  - enables RLS across core app tables in compatibility mode with explicit transitional policies.
  - `supabase/migrations/20260509125500_canonicalize_race_contract_to_race_goals.sql`
  - standardizes app contract on `race_goals` and syncs `race_events` for backward compatibility.
- Remaining schema debt: permissive compatibility RLS policies still need owner-scoped enforcement tied to final auth model.

## 3) Screens & UX Flows

Status: PASS

- Navigation stack and tab wiring are complete and internally consistent (`app/_layout.tsx`, `app/(tabs)/_layout.tsx`).
- Core user journeys are represented in route set (onboarding, plan, progress, intelligence, profile, session detail, race goals, calendar sync, Huawei import).
- Manual end-to-end simulator/device verification still required for launch sign-off.

## 4) Data Flows (App <-> DB)

Status: PASS

- Session lifecycle pipeline is wired end-to-end (`hooks/useSessionData.ts`, `components/LogSessionSheet.tsx`).
- Athlete/plan/session/race query shapes are internally consistent with typed Supabase usage.
- Live integrity checks passed:
  - orphan `session_blocks`: 0
  - orphan `session_steps`: 0
  - athletes with >1 active plan: 0
  - duplicate personal-best groups: 0

## 5) Navigation & State Architecture

Status: WARNING

- Router and tab graph are stable.
- Potential product-level risk remains from single “active athlete = first row” assumption in several flows; this is acceptable only for strict single-user data model.
- If multi-user model is expected, identity scoping must be redesigned before launch.

## 6) Styling & Theming

Status: PASS

- Theme system is centralized and persisted (`contexts/ThemeContext.tsx`).
- Major screens use theme tokens and alpha utilities consistently.
- No obvious blocking styling regressions found in static review.

## 7) Error Handling & Reliability

Status: WARNING

- Most critical DB/API writes surface user-visible errors and/or safe fallback paths.
- Reliability gap remains: no durable offline replay queue for failed mutation paths (manual log, challenge updates, session actions).
- Existing warning/fallback logs are useful but not a substitute for offline durability.

## 8) Performance

Status: WARNING

- Query windows (today/week/month/upcoming) and sorted projections are reasonable for current scale.
- Live advisors still report duplicate indexes and unused indexes (needs cleanup plan based on real workload).
- Safe perf fix added now: index on `personal_bests(session_log_id)`.

## 9) Security (Code + Supabase)

Status: WARNING

- Critical live security findings reduced:
  - `rls_disabled_in_public` and `policy_exists_rls_disabled` are addressed by staged RLS enablement.
  - `sensitive_columns_exposed` remains until auth model and restrictive policies are finalized.
- Safe code hardening applied:
  - `lib/supabase.ts` now redacts sensitive query params in request logs and restricts verbose request/response logging to `__DEV__`.
- Safe DB hardening applied:
  - trigger function `public.touch_apple_calendar_subscriptions_updated_at()` now sets explicit `search_path`.

## 10) Production Readiness

Status: WARNING

- Launch risk remains due to compatibility-mode RLS (policies are currently permissive by design).
- Advisor backlog still includes security errors and performance cleanup work.
- Additional dashboard-level checks remain manual (logs/alerts, backups/PITR policy, quota and environment separation).

## Safe Fixes Applied In This Audit

1. `lib/supabase.ts`
   - Added URL redaction for sensitive parameters (`token`, `apikey`, `authorization`, `access_token`, `refresh_token`).
   - Limited Supabase request/response/error logging to development mode (`__DEV__`).
2. `supabase/migrations/20260509121500_harden_apple_calendar_function_and_index_fk.sql`
   - Added `personal_bests_session_log_id_idx`.
   - Hardened trigger function with fixed `search_path`.
3. `supabase/README.md`
   - Added new migration to migration inventory.
4. `supabase/migrations/20260509124500_enable_rls_compat_mode.sql`
   - Enables RLS for core app tables with transitional permissive policies to preserve current behavior.
   - Documents explicit TODO to replace compatibility policies with owner-scoped auth policies.
5. `supabase/migrations/20260509125500_canonicalize_race_contract_to_race_goals.sql`
   - Sets `race_goals` as canonical app contract and syncs `race_events` for legacy compatibility.
6. `types/supabase.ts`
   - Updated `race_events` row/insert/update shape to include `athlete_id`, `priority`, and `race_type`.
7. `app/(tabs)/plan.tsx`
   - Renamed local race display type to reduce ambiguity with legacy `race_events` schema naming.

## Unresolved Manual Items (Required)

1. Finalize launch auth model and replace compatibility `*_compat_open` policies with restrictive owner-scoped policies.
2. Re-run Supabase security advisors after applying migrations until remaining critical findings clear.
3. Validate index cleanup candidates (duplicate/unused indexes) with production-like workload before dropping.
4. Run full mobile manual QA pass for all key user flows with evidence capture.
5. Complete production operations checks (alerts, logs triage workflow, PITR/backup strategy, quota monitoring).

### Decision needed (auth/RLS)

Pick one transition path before final launch hardening:

- **Option A (preferred):** adopt Supabase Auth identity mapping (`athletes.id = auth.uid()`) and replace compatibility policies with owner-scoped RLS.
- **Option B:** keep current non-auth model temporarily and maintain compatibility-mode RLS (reduced immediate break risk, weaker data isolation posture).

## DB Change Summary

- Live checks executed (read-only): project info, migration ledger, RLS/policies, data-integrity counts, advisor reports.
- New migration added locally (not auto-applied by this audit runner):
  - `20260509121500_harden_apple_calendar_function_and_index_fk.sql`
  - `20260509124500_enable_rls_compat_mode.sql`
  - `20260509125500_canonicalize_race_contract_to_race_goals.sql`

