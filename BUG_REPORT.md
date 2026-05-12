# Telo live diagnostic report

Generated: 2026-05-11T03:57:30.590Z

> Anon key + RLS: empty counts can mean no public read policy or no rows, not necessarily a broken connection.

## STEP 1 — Table connectivity

| Table | Result |
|-------|--------|
| athletes | ✅ connected (1 row(s) in sample) |
| plans | ✅ connected (1 row(s) in sample) |
| sessions | ✅ connected (1 row(s) in sample) |
| session_blocks | ✅ connected (1 row(s) in sample) |
| session_steps | ✅ connected (1 row(s) in sample) |
| session_logs | ✅ connected (1 row(s) in sample) |
| personal_bests | ✅ connected (1 row(s) in sample) |
| rova_challenges | ✅ connected (1 row(s) in sample) |
| rova_conversations | ✅ connected (1 row(s) in sample) |
| flex_history | ✅ connected (0 row(s) in sample) |
| race_events | ✅ connected (1 row(s) in sample) |
| race_goals | ✅ connected (1 row(s) in sample) |

## STEP 2 — Foreign keys / orphans

Run `supabase/diagnostics/FK_ORPHAN_CHECKS.sql` in the **Supabase SQL Editor** (cannot be executed safely from this anon script).
Paste results here on the next audit if any rows return.

## STEP 3 & 4 — Athlete, active plan, sessions (anon sample)

Local calendar **today** (en-CA): `2026-05-11`

- athletes sample: ✅ 5 row(s)
  - id `06fe57d0-2cc6-4305-95d1-c1847fccf497`: name ✅, level ✅ (`fara`), goal_race_date `null`, goal_race_name `null`
  - id `66766200-c6bf-443e-9984-317acec96c94`: name ✅, level ✅ (`fara`), goal_race_date `null`, goal_race_name `null`
  - id `05e9b750-a242-424c-9c61-d8a3174ad8ab`: name ✅, level ✅ (`fara`), goal_race_date `null`, goal_race_name `null`
  - id `b34a56fd-d62e-4233-a793-0a47aa80283d`: name ✅, level ✅ (`fara`), goal_race_date `null`, goal_race_name `null`
  - id `e32b8c0a-cadc-46b1-9fcb-cb12596a288f`: name ✅, level ✅ (`fara`), goal_race_date `null`, goal_race_name `null`

- active plan: ⚠️ none found for first sample athlete

- sessions **today** count: **0** (athlete 06fe57d0…)
- sessions **next 7 local days**: **0**

## STEP 5 — Sessions without blocks

See last query in `supabase/diagnostics/FK_ORPHAN_CHECKS.sql` (server-side GROUP BY).

## STEP 6 — Screens (code paths verified in repo)

| Screen | Data hooks / notes |
|--------|----------------------|
| Today | `useTodaysSessions`, `useActiveAthlete`, `useWeekSessions`, `useUpcomingSessions`, `useWeeklyChallenges`, `useLevelProgress` |
| Plan | `useMonthSessions`, `useWeekSessions`, calendar + week cards |
| Session detail | `useSessionDetail`, `useCompleteSession`, blocks/steps nested select |
| Progress | `useCompletedSessionLogs`, `useCompletedSessionCount`, `usePersonalBests` |
| Profile | athlete + goals; theme via `ThemeContext` |

## STEP 7–11 — Automation limits

- **RLS**: Anon script cannot validate policies; use Dashboard → Authentication → Policies.
- **Rova / Flex / Import**: Behavioural tests require device or E2E; this report covers connectivity + counts only.
- **Performance**: Today/week/month queries in `hooks/useSessionData.ts` use bounded `eq` / `gte` / `lte` on `scheduled_date` or `completed_at`.

## BUGS FIXED (this audit pass)

- `hooks/useSessionData.ts`: active plan query orders by `start_date` **descending** so the newest plan wins when multiple rows are `active`.
- `hooks/useWeeklyChallenges.ts`: race challenge “today” uses `toLocalIsoDate` from `lib/dates.ts` (local calendar, not UTC midnight drift).
- `app/(tabs)/index.tsx`: same local ISO helper for week strip and coach ranges.
- `app/SessionDetail.tsx`: explicit **Missing session** state when `sessionId` param is absent (after all hooks; avoids hooks violation).
- `supabase/diagnostics/FK_ORPHAN_CHECKS.sql`: added for manual FK + zero-block session checks.

## BUGS REMAINING / manual follow-up

- Run `FK_ORPHAN_CHECKS.sql` and fix any orphan rows in Supabase.
- If **next 7 days** session count is 0 for a real athlete, run onboarding / `assignTemplatePlan` or your plan import flow.
- Expo Go vs dev build: native modules must match Expo SDK (already aligned via `expo install`).
