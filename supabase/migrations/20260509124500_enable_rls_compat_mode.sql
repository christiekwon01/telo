-- Staged RLS hardening in compatibility mode.
-- Goal: clear "RLS disabled" posture without breaking current client auth model.
-- IMPORTANT: These permissive policies are transitional and do not provide tenant isolation.
-- TODO: replace each *_compat_open policy with owner-scoped policies once auth.uid() mapping is live.
--
-- Reversal posture (manual, if needed):
-- 1) drop policy "<table>_compat_open" on each table below
-- 2) alter table public.<table> disable row level security

alter table if exists public.athletes enable row level security;
alter table if exists public.plans enable row level security;
alter table if exists public.sessions enable row level security;
alter table if exists public.session_blocks enable row level security;
alter table if exists public.session_steps enable row level security;
alter table if exists public.session_logs enable row level security;
alter table if exists public.personal_bests enable row level security;
alter table if exists public.rova_challenges enable row level security;
alter table if exists public.rova_conversations enable row level security;
alter table if exists public.flex_history enable row level security;
alter table if exists public.race_goals enable row level security;
alter table if exists public.race_events enable row level security;

drop policy if exists athletes_compat_open on public.athletes;
create policy athletes_compat_open on public.athletes for all using (true) with check (true);

drop policy if exists plans_compat_open on public.plans;
create policy plans_compat_open on public.plans for all using (true) with check (true);

drop policy if exists sessions_compat_open on public.sessions;
create policy sessions_compat_open on public.sessions for all using (true) with check (true);

drop policy if exists session_blocks_compat_open on public.session_blocks;
create policy session_blocks_compat_open on public.session_blocks for all using (true) with check (true);

drop policy if exists session_steps_compat_open on public.session_steps;
create policy session_steps_compat_open on public.session_steps for all using (true) with check (true);

drop policy if exists session_logs_compat_open on public.session_logs;
create policy session_logs_compat_open on public.session_logs for all using (true) with check (true);

drop policy if exists personal_bests_compat_open on public.personal_bests;
create policy personal_bests_compat_open on public.personal_bests for all using (true) with check (true);

drop policy if exists rova_challenges_compat_open on public.rova_challenges;
create policy rova_challenges_compat_open on public.rova_challenges for all using (true) with check (true);

drop policy if exists rova_conversations_compat_open on public.rova_conversations;
create policy rova_conversations_compat_open on public.rova_conversations for all using (true) with check (true);

drop policy if exists flex_history_compat_open on public.flex_history;
create policy flex_history_compat_open on public.flex_history for all using (true) with check (true);

drop policy if exists race_goals_compat_open on public.race_goals;
create policy race_goals_compat_open on public.race_goals for all using (true) with check (true);

drop policy if exists race_events_compat_open on public.race_events;
create policy race_events_compat_open on public.race_events for all using (true) with check (true);
