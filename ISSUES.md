# Telo diagnostic issue list

**Scan type:** Static analysis only (`tsc`, `eslint`, targeted codebase search).  
**Not run here:** Live Metro console on app load, browser/React Native network tab, simulator UI flows, or runtime exception capture.

---

## Critical

1. **Supabase client with empty URL / anon key when env vars are missing**  
   - **What is broken:** `createClient` is called with `''` if `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are unset; all auth and PostgREST calls will fail or target an invalid URL.  
   - **Where:** `lib/supabase.ts`  
   - **Severity:** Critical (app data layer non-functional without env)

2. **TypeScript does not typecheck the repo (`npx tsc --noEmit` exits with errors)**  
   - **What is broken:** Large set of errors (~170+ lines of diagnostics). Dominant pattern: Supabase `.insert()` / `.update()` payloads and query results inferred as `never` or incompatible with `Database` types—suggests generated `types/supabase.ts` is out of sync with the live schema, or client generics are misapplied. Affects core flows (sessions, plans, logs, profile, onboarding, goal races insert/update, hooks, multiple services).  
   - **Where (non-exhaustive):** `app/(tabs)/index.tsx`, `app/(tabs)/intelligence.tsx`, `app/(tabs)/plan.tsx`, `app/(tabs)/profile.tsx`, `app/SessionDetail.tsx`, `app/debug.tsx`, `app/goal-races.tsx`, `app/onboarding/index.tsx`, `components/LogSessionSheet.tsx`, `components/FlexWeekSheet.tsx`, `hooks/useSessionData.ts`, `lib/supabase-auth.ts`, `lib/onboarding-completion.ts`, `services/appleCalendarSync.ts`, `services/applyFlexPlan.ts`, `services/buildAthleteContext.ts`, `services/flexWeek.ts`, `services/generateWeeklyChallenges.ts`, `services/huaweiHealthSync.ts`, `services/personalBests.ts`, `services/rovaIntelligence.ts`, `services/saveChallenges.ts`, `services/savePlan.ts`  
   - **Severity:** Critical for CI/type safety; Expo may still bundle in dev depending on config, but fixes are high risk without aligning types.

3. **Edge function compiled with app `tsconfig` (Deno globals unresolved)**  
   - **What is broken:** `Deno` / `Deno.serve` / `Deno.env` fail typecheck under root `tsconfig.json` (`include: **/*.ts`).  
   - **Where:** `supabase/functions/apple-calendar-subscription/index.ts`  
   - **Severity:** Critical for a clean `tsc` run; runtime on Supabase Edge is still Deno—problem is project-wide TS configuration, not necessarily production Edge.

---

## High

4. **Wrong Expo Calendar API name (`getCalendarAsync` vs `getCalendarsAsync`)**  
   - **What is broken:** Typecheck reports `getCalendarAsync` does not exist on `expo-calendar`; likely wrong API → calendar reads can throw at runtime.  
   - **Where:** `services/appleCalendarSync.ts` (multiple call sites)  
   - **Severity:** High (feature: Apple calendar sync)

5. **Today tab: `TouchableOpacity` passes the press event into `openFlexWeekSheet`**  
   - **What is broken:** `onPress={openFlexWeekSheet}` where `openFlexWeekSheet` expects optional `'Catch up'`; the native event is passed as the first argument (TypeScript flags incompatibility). Flex sheet may open with wrong “preset” / reason handling vs the explicit `() => openFlexWeekSheet('Catch up')` path.  
   - **Where:** `app/(tabs)/index.tsx` (header sparkles button ~line 535)  
   - **Severity:** High (feature behaves incorrectly)

6. **Today tab: session / challenge types collapse to `never` (mutations & props)**  
   - **What is broken:** `.update()` payloads and fields like `status`, `id`, `refetch`, challenge `title`/`description` flagged as invalid on `never`—same root as global Supabase typing drift; blocks safe refactors and may hide real shape bugs.  
   - **Where:** `app/(tabs)/index.tsx` (session completion / challenge interactions ~lines 408–442, 754–758)  
   - **Severity:** High

7. **Rova (Intelligence) tab: plan/messages types + inserts**  
   - **What is broken:** Plan row and message fields on `never`; insert payloads for conversations / messages rejected by types.  
   - **Where:** `app/(tabs)/intelligence.tsx`  
   - **Severity:** High

8. **Plan tab: typed updates and week session card typing**  
   - **What is broken:** `sessions` / `race_goals` `.update()` seen as `never`; `WeekSessionCard` receives `SessionWithCompletion` where `sport` is `string` but prop expects a narrow union.  
   - **Where:** `app/(tabs)/plan.tsx` (~lines 657, 689, 992)  
   - **Severity:** High

9. **Profile & athlete updates typed as `never`**  
   - **What is broken:** Supabase `athletes` update payloads fail typecheck.  
   - **Where:** `app/(tabs)/profile.tsx`  
   - **Severity:** High

10. **Session detail save payload typed as `never`**  
    - **What is broken:** Session log update object not assignable to typed client.  
    - **Where:** `app/SessionDetail.tsx` (~line 337)  
    - **Severity:** High

11. **Log session sheet: plan insert + session log insert**  
    - **What is broken:** `plan_id` / `session_id` insert shapes and plan fields on `never`.  
    - **Where:** `components/LogSessionSheet.tsx`  
    - **Severity:** High

12. **Onboarding inserts**  
    - **What is broken:** Athlete (or related) insert object literal flagged against `never[]`-like insert type.  
    - **Where:** `app/onboarding/index.tsx`  
    - **Severity:** High

13. **Goal races: duplicate keys in object literal (TypeScript TS1117)**  
    - **What is broken:** `{ h, m, s, [part]: ... }` duplicates `h`/`m`/`s` when `part` is one of those keys—invalid object literal in strict TS; JS would keep last key only (subtle time-input bugs).  
    - **Where:** `app/goal-races.tsx` (`GoalTimeInput` `blurNormalizePart` ~line 157)  
    - **Severity:** High

14. **Goal races: insert/update payloads vs typed client**  
    - **What is broken:** `insert`/`update` with full `race_goals` payload still flagged (`never` / `never[]`).  
    - **Where:** `app/goal-races.tsx` (~lines 423–424)  
    - **Severity:** High (overlaps with item 2; listed for screen traceability)

15. **`useSessionData`: session_logs / level updates typed as `never`**  
    - **What is broken:** Mutations for logs and `athletes.level` fail typecheck; completion toggle path affected.  
    - **Where:** `hooks/useSessionData.ts`  
    - **Severity:** High

16. **`ensureAthleteRowExists` insert typed as `never`**  
    - **What is broken:** `athletes.insert` payload not assignable under current `Database` types.  
    - **Where:** `lib/supabase-auth.ts`  
    - **Severity:** High

17. **Flex week / plan save / challenges / Huawei / Rova / PB services: Supabase writes typed as `never`**  
    - **What is broken:** Same schema/client mismatch across save paths (`savePlan`, `saveChallenges`, `applyFlexPlan`, `flexWeek`, `generateWeeklyChallenges`, `huaweiHealthSync`, `personalBests`, `rovaIntelligence`).  
    - **Where:** respective files under `services/`  
    - **Severity:** High

18. **Debug screen Supabase operations typed as `never`**  
    - **What is broken:** Seed/test mutations and selects fail typecheck.  
    - **Where:** `app/debug.tsx`  
    - **Severity:** High (dev tooling)

19. **Anthropic-dependent features without key**  
    - **What is broken:** Rova, flex reshuffle (Anthropic path), plan generation, weekly challenges log warnings or throw when `EXPO_PUBLIC_ANTHROPIC_API_KEY` is missing/invalid.  
    - **Where:** `services/rovaIntelligence.ts`, `services/flexWeek.ts`, `services/generatePlan.ts`, `services/generateWeeklyChallenges.ts`, `services/rovaProgressHighlights.ts`, `app/(tabs)/intelligence.tsx` (user-facing copy)  
    - **Severity:** High (features degrade or fail; not always a “crash”)

20. **Optional Apple calendar subscription URL**  
    - **What is broken:** If both `EXPO_PUBLIC_APPLE_CALENDAR_SUBSCRIPTION_URL` and `EXPO_PUBLIC_CALENDAR_SUBSCRIPTION_URL` are empty, subscription-based sync has nothing to call (handled as empty but feature inactive).  
    - **Where:** `services/appleCalendarSync.ts`, `.env.example`  
    - **Severity:** High for that integration only

---

## Medium

21. **`StatusAreaFade` rendered without required `height`**  
    - **What is broken:** Component props require `height`; call site passes none → TS error; layout may be wrong or rely on defaults if forced through.  
    - **Where:** `app/(tabs)/intelligence.tsx` (~line 788)  
    - **Severity:** Medium

22. **`loggingFetch` / `Request` typing friction**  
    - **What is broken:** `input.url` / method resolution flagged under strict `fetch` typings.  
    - **Where:** `lib/supabase.ts` (~lines 53–55)  
    - **Severity:** Medium (type noise; runtime usually fine)

23. **`lib/onboarding-completion` type errors**  
    - **What is broken:** TS errors in onboarding completion helper (lines ~21, 32).  
    - **Where:** `lib/onboarding-completion.ts`  
    - **Severity:** Medium

24. **`buildAthleteContext` optional chaining / types**  
    - **What is broken:** TS flags on race/athlete fields (~lines 224–230).  
    - **Where:** `services/buildAthleteContext.ts`  
    - **Severity:** Medium

25. **`FlexWeekSheet` flex history row typing**  
    - **What is broken:** `reason` (and related) on `never`.  
    - **Where:** `components/FlexWeekSheet.tsx` (~line 123)  
    - **Severity:** Medium

26. **Verbose dev logging (noise + minor perf)**  
    - **What is broken:** `console.log` on every Supabase request/response in `__DEV__`, plus session fetch logs in hooks and Today tab.  
    - **Where:** `lib/supabase.ts`, `hooks/useSessionData.ts`, `app/(tabs)/index.tsx`  
    - **Severity:** Medium (obscures real errors in console)

27. **Warnings on failure paths without user-visible recovery**  
    - **What is broken:** Many `console.warn` for calendar sync, PB sync, Rova, Huawei, flex reshuffle—failures may be silent to the user unless UI surfaces them.  
    - **Where:** multiple `services/*`, `components/LogSessionSheet.tsx`, `app/SessionDetail.tsx`, `app/(tabs)/intelligence.tsx`  
    - **Severity:** Medium (partially overlaps “failed queries” in spirit; not verified in network tab here)

28. **`plan.tsx` React hook dependency warning**  
    - **What is broken:** `useMemo` for `PanResponder` missing `resetDragPosition` in deps (`eslint` exhaustive-deps).  
    - **Where:** `app/(tabs)/plan.tsx` (~line 304)  
    - **Severity:** Medium (stale closure risk for drag behavior)

---

## Low

29. **ESLint warnings (unused imports/vars, duplicate imports, style)**  
    - **What is broken:** Code hygiene only; examples: unused `MaterialCommunityIcons`, `monthError`, `selectedDateMarker`, `weekRangeLabel`; duplicate `expo-router` imports in `goal-races`; `Array<T>` style.  
    - **Where:** `app/(tabs)/plan.tsx`, `app/(tabs)/index.tsx`, `app/goal-races.tsx`, `components/loading-ui.tsx`  
    - **Severity:** Low

30. **`PersonalBestCelebration` copy references unfinished share integration**  
    - **What is broken:** User-facing TODO-style string for sharing PB milestones.  
    - **Where:** `components/PersonalBestCelebration.tsx`  
    - **Severity:** Low

---

## Checks requested vs this document

| Check | Result |
|-------|--------|
| 1. Console errors when app loads | Not captured live; static findings include heavy `console.log`/`console.warn` paths that may flood or mask issues (`lib/supabase.ts`, `hooks/useSessionData.ts`, `app/(tabs)/index.tsx`). |
| 2. Failed Supabase queries (network tab) | Not observed; empty env URL/key and typed-client drift are indirect risk factors. |
| 3. Undefined/null data rendered | Not exhaustively proven at runtime; TS `never` issues imply possible shape/runtime drift on affected screens. |
| 4. Navigation paths that crash | Not executed; `router.push` / `replace` targets appear consistent with `app/_layout.tsx` stack names (static review only). |
| 5. Functions that don't complete | Not traced at runtime; several async paths only `console.warn` on failure. |
| 6. Missing environment variables | Documented: Supabase URL/key, Anthropic key, optional Apple subscription URL (see items 1, 19–20). |
| 7. Broken imports | No ES module resolution failures found by `tsc` beyond type errors; `expo-router` duplicate import is lint-level. |
| 8. Unhandled promise rejections | Not instrumented; `void` on some async calls without local `.catch` may surface as unhandled rejections in edge cases (not enumerated file-by-file). |
| 9. Components that fail to mount | Not observed; no static “throw during render” patterns were searched beyond TS/ESLint output. |

---

*End of issue list (no code changes in this scan).*
