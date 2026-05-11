# Telo Launch Audit Checklist (2026-05-08)

Scope: pre-launch audit across schema/migrations, security/RLS, data integrity, app contracts, business logic, performance, reliability, QA flow coverage, and Supabase readiness.

Important: items marked **Not verifiable locally** require live Supabase project access (SQL editor, dashboard, logs, settings).

## Live Supabase Snapshot (verified 2026-05-08)

- ✅ Project connected: `telo` (`kyxoymtxyhqsodmnobpx`) in `ap-northeast-1`
- ⚠️ Migration history in live DB is partial for launch pack:
  - present: `20260508162400_create_race_goals`, `20260508041732_remote_schema`
  - missing from live migration ledger: `20260508170500_launch_hardening_pack`, `20260508171500_rls_compat_current_auth`, `20260508172000_bootstrap_core_tables`, `20260508172500_add_athlete_background_columns`
- ❌ RLS is currently disabled on all `public` app tables (`athletes`, `plans`, `sessions`, `session_blocks`, `session_steps`, `session_logs`, `rova_challenges`, `rova_conversations`, `flex_history`, `race_goals`, `race_events`, `personal_bests`)
- ❌ Supabase security advisor reports critical findings:
  - `rls_disabled_in_public`
  - `policy_exists_rls_disabled`
  - `sensitive_columns_exposed`
- ⚠️ Supabase performance advisor reports:
  - duplicate indexes on `plans`, `race_events`, `session_logs`, `sessions`
  - one unindexed FK on `personal_bests(session_log_id)`
  - multiple currently unused indexes (informational; validate with real workload before dropping)

## Legend
- ✅ verified working from repository code/migrations
- ⚠️ issue found or not verifiable locally
- ❌ broken/missing and needs fix before launch

## 1) Schema & Migrations Verification

- ✅ Core baseline and hardening migrations exist in `supabase/migrations/`:
  - `20260508172000_bootstrap_core_tables.sql`
  - `20260508170500_launch_hardening_pack.sql`
  - `20260508171500_rls_compat_current_auth.sql`
  - `20260508162400_create_race_goals.sql`
  - `20260508172500_add_athlete_background_columns.sql`

- ✅ FK cascades and key indexes are defined in migrations:
  - cascades for `session_blocks -> sessions` and `session_steps -> session_blocks`
  - athlete/date indexes for sessions, race, flex, rova, and PB tables

- ⚠️ `race_events` + `race_goals` dual-table contract remains
  - **What is wrong:** app logic reads/writes `race_goals`, while schema/types still include `race_events` for compatibility.
  - **Where to fix:** `supabase/migrations/20260508170500_launch_hardening_pack.sql`, `types/supabase.ts`, `supabase/README.md`
  - **Suggested fix:** pick one canonical table (recommended `race_goals`), migrate data, remove legacy table/types/docs.

- ⚠️ Live check completed: migration application state in hosted DB shows partial rollout
  - **Verification SQL used:** `select version, name from supabase_migrations.schema_migrations order by version desc limit 20;`
  - **Action:** apply the missing launch migrations to the production target in-order, then re-run migration ledger verification.

## 2) RLS / Security Posture

- ⚠️ RLS model is internally inconsistent for launch security
  - **What is wrong:** hardening migration enables strict owner policies using `auth.uid()`, then compat migration disables RLS for all core tables.
  - **Where to fix:** `supabase/migrations/20260508170500_launch_hardening_pack.sql`, `supabase/migrations/20260508171500_rls_compat_current_auth.sql`, `lib/supabase.ts`
  - **Suggested fix:** before launch, adopt one model:
    - Supabase Auth-backed ownership (`athletes.id = auth.uid()` + RLS on), or
    - service-role backend pattern (never broad anon reads).

- ❌ Live check completed: all app tables in `public` have `rowsecurity=false`
  - **Verification SQL used:**
    - `select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename;`
    - `select tablename, policyname, cmd, roles from pg_policies where schemaname='public' order by tablename, policyname;`
  - **Action:** finalize launch auth model, then enable RLS + apply table-specific policies before public rollout.

## 3) Data Integrity Checks

- ✅ DB-side uniqueness protections are present in migrations:
  - PB uniqueness on `(athlete_id, sport, distance, distance_unit)`
  - one active plan per athlete via partial unique index on `plans(athlete_id) where status='active'`

- ⚠️ A-race minimum spacing is UI-only
  - **What is wrong:** no DB-level guard against bad historical/manual inserts.
  - **Where to fix:** `app/goal-races.tsx` (current UI rule), new DB migration (constraint/trigger)
  - **Suggested fix:** add DB check/trigger for A-race spacing and run cleanup query.

- ⚠️ Not verifiable locally: existing orphaned/bad production data
  - **Next step SQL (examples):**
    - orphans:  
      `select sb.id from session_blocks sb left join sessions s on s.id=sb.session_id where s.id is null;`  
      `select ss.id from session_steps ss left join session_blocks sb on sb.id=ss.block_id where sb.id is null;`
    - multi-active plans:  
      `select athlete_id, count(*) from plans where status='active' group by athlete_id having count(*)>1;`
    - PB duplicates:  
      `select athlete_id,sport,distance,distance_unit,count(*) from personal_bests group by 1,2,3,4 having count(*)>1;`

## 4) App-to-DB Contract

- ✅ Onboarding writes expected athlete fields (`name`, `level`, race fields, sport backgrounds) in `app/onboarding/index.tsx`.
- ✅ Theme persistence is implemented in `contexts/ThemeContext.tsx`.
- ✅ Session completion cross-tab sync is implemented via realtime invalidation channel in `hooks/useSessionData.ts`.

- ❌ Types generation workflow is undocumented/stale
  - **What is wrong:** `types/supabase.ts` is manually drift-prone and `supabase/README.md` references a non-existent old migration.
  - **Where to fix:** `supabase/README.md`, `types/supabase.ts`
  - **Suggested fix:** run and document:
    - `supabase gen types typescript --project-id <project_ref> --schema public > types/supabase.ts`
    - re-run after each migration batch.

- ✅ Fixed in this audit: active-plan lookup scope for manual/Rova logging now filters by athlete:
  - `components/LogSessionSheet.tsx`
  - `app/(tabs)/intelligence.tsx`

## 5) Business Logic Pipelines

- ✅ Session completion pipeline is wired (`hooks/useSessionData.ts`): log insert -> session status update -> PB sync -> cache invalidation.
- ✅ PB auto-calculation and upsert pipeline is wired in `services/personalBests.ts`.
- ✅ Level progression logic exists with Monday-only promotion checks in `hooks/useSessionData.ts`.
- ✅ Wild card generation/save/query pipeline exists:
  - `services/generateWeeklyChallenges.ts`
  - `services/saveChallenges.ts`
  - `hooks/useWeeklyChallenges.ts`
- ✅ Flex pipeline exists and writes `flex_history` in `services/applyFlexPlan.ts`.

## 6) Performance Checks

- ✅ Date-window scoping exists for month/week/today session queries.
- ✅ Rova conversation fetch and prompt history are capped (`limit(20)` and `slice(-20)`).

- ⚠️ Potential performance risk: `sessions_scheduled_date_idx` may be underused by athlete-scoped reads
  - **What is wrong:** many app queries are date-windowed; best selectivity is usually `(athlete_id, scheduled_date)`.
  - **Where to fix:** migration index strategy (`supabase/migrations/20260508170500_launch_hardening_pack.sql`)
  - **Suggested fix:** keep and verify composite index with `EXPLAIN ANALYZE` in production-like dataset.

- ⚠️ Not verifiable locally: production query plans/latency
  - **Next step SQL:** run `EXPLAIN (ANALYZE, BUFFERS)` for:
    - today query
    - month query
    - rova history query

## 7) Error Handling & Reliability

- ✅ Anthropic key missing/invalid paths return user-facing messages in:
  - `services/generatePlan.ts`
  - `services/rovaIntelligence.ts`
  - onboarding flow fallback messaging in `app/onboarding/index.tsx`

- ✅ AI failure fallback exists for weekly challenges (`services/generateWeeklyChallenges.ts`) and Rova chat fallback response exists in `services/rovaIntelligence.ts`.

- ⚠️ Offline durability gap
  - **What is wrong:** no durable offline queue for session logs/challenge actions; failed requests are surfaced but not replayed.
  - **Where to fix:** `hooks/useSessionData.ts`, `components/LogSessionSheet.tsx`, possibly dedicated offline queue service.
  - **Suggested fix:** AsyncStorage-backed queue + connectivity listener + idempotent replay.

## 8) Manual QA Flows (10 user-listed flows)

- ⚠️ Not verifiable locally in this pass (requires simulator/device + live backend state)
  - **What is wrong:** full end-to-end UX/DB assertions cannot be proven from static audit only.
  - **Where to run:** mobile client + target Supabase environment.
  - **Suggested fix:** execute all 10 flows with pass/fail evidence and DB spot-check queries per flow.

## 9) Supabase Production Readiness

- ⚠️ Not verifiable locally: logs, backups/PITR, environment separation, quotas
  - **Dashboard checks required:**
    - Logs/Errors: Supabase Project -> Logs
    - Backups/PITR: Project -> Settings -> Database/Backups
    - Environments: confirm separate dev/stage/prod project refs and secrets
    - Quotas: Project -> Usage/Billing

- ⚠️ Not verifiable locally: constraint violation and policy-denied trend monitoring
  - **Next step:** create saved dashboards/alerts for:
    - 4xx/5xx spikes
    - policy denied events
    - DB CPU / connection saturation

## High-Priority Launch Actions

1. ❌ Resolve and apply launch RLS strategy now (critical; live project currently fully exposed).
2. ❌ Apply missing launch migrations to live project and re-verify `schema_migrations`.
3. ❌ Standardize race table contract (`race_goals` vs `race_events`) and regenerate `types/supabase.ts`.
4. ⚠️ Run integrity SQL suite (orphans/duplicates/multi-active plans) and clean findings.
5. ⚠️ Execute full 10-flow manual QA with artifacts on production-like mobile builds.

