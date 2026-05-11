begin;

-- Emergency compatibility mode for mobile launch stability.
-- Re-open RLS on specific tables currently blocked by auth.uid()/athlete_id mismatches.

-- ---------- race_goals ----------
drop policy if exists race_goals_all_own on public.race_goals;
drop policy if exists race_goals_mobile_compat on public.race_goals;
drop policy if exists race_goals_compat_open on public.race_goals;
create policy race_goals_compat_open
on public.race_goals
for all
using (true)
with check (true);

-- ---------- rova_conversations ----------
drop policy if exists rova_conversations_all_own on public.rova_conversations;
drop policy if exists rova_conversations_mobile_compat on public.rova_conversations;
drop policy if exists rova_conversations_compat_open on public.rova_conversations;
create policy rova_conversations_compat_open
on public.rova_conversations
for all
using (true)
with check (true);

-- ---------- personal_bests ----------
drop policy if exists personal_bests_all_own on public.personal_bests;
drop policy if exists personal_bests_mobile_compat on public.personal_bests;
drop policy if exists personal_bests_compat_open on public.personal_bests;
create policy personal_bests_compat_open
on public.personal_bests
for all
using (true)
with check (true);

commit;
