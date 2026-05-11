begin;

-- =========================================================
-- Assumption:
-- - athletes.id and all athlete_id FKs are uuid
-- - logged-in Supabase user id matches athletes.id (auth.uid())
-- =========================================================

-- Helper: compare uuid columns to auth.uid() (uuid), never ::text

-- ---------- athletes ----------
drop policy if exists athletes_compat_open on public.athletes;
drop policy if exists athletes_select_compat_open on public.athletes;
drop policy if exists athletes_write_compat_open on public.athletes;

create policy athletes_select_own
on public.athletes
for select
to authenticated
using (id = auth.uid());

create policy athletes_insert_own
on public.athletes
for insert
to authenticated
with check (id = auth.uid());

create policy athletes_update_own
on public.athletes
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy athletes_delete_own
on public.athletes
for delete
to authenticated
using (id = auth.uid());

-- ---------- plans ----------
drop policy if exists plans_compat_open on public.plans;
drop policy if exists plans_select_compat_open on public.plans;
drop policy if exists plans_write_compat_open on public.plans;

create policy plans_all_own
on public.plans
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

-- ---------- sessions ----------
drop policy if exists sessions_compat_open on public.sessions;
drop policy if exists sessions_select_compat_open on public.sessions;
drop policy if exists sessions_write_compat_open on public.sessions;

create policy sessions_all_own
on public.sessions
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

-- ---------- session_logs ----------
drop policy if exists session_logs_compat_open on public.session_logs;
drop policy if exists session_logs_select_compat_open on public.session_logs;
drop policy if exists session_logs_write_compat_open on public.session_logs;

create policy session_logs_all_own
on public.session_logs
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

-- ---------- rova_challenges ----------
drop policy if exists rova_challenges_compat_open on public.rova_challenges;
drop policy if exists rova_challenges_select_compat_open on public.rova_challenges;
drop policy if exists rova_challenges_write_compat_open on public.rova_challenges;

create policy rova_challenges_all_own
on public.rova_challenges
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

-- ---------- rova_conversations ----------
drop policy if exists rova_conversations_compat_open on public.rova_conversations;
drop policy if exists rova_conversations_select_compat_open on public.rova_conversations;
drop policy if exists rova_conversations_write_compat_open on public.rova_conversations;

create policy rova_conversations_all_own
on public.rova_conversations
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

-- ---------- flex_history ----------
drop policy if exists flex_history_compat_open on public.flex_history;
drop policy if exists flex_history_select_compat_open on public.flex_history;
drop policy if exists flex_history_write_compat_open on public.flex_history;

create policy flex_history_all_own
on public.flex_history
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

-- ---------- race_goals ----------
drop policy if exists race_goals_compat_open on public.race_goals;
drop policy if exists race_goals_select_compat_open on public.race_goals;
drop policy if exists race_goals_write_compat_open on public.race_goals;

create policy race_goals_all_own
on public.race_goals
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

-- ---------- race_events (legacy mirror) ----------
drop policy if exists race_events_compat_open on public.race_events;
drop policy if exists race_events_select_compat_open on public.race_events;
drop policy if exists race_events_write_compat_open on public.race_events;

create policy race_events_all_own
on public.race_events
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

-- ---------- session_blocks ----------
drop policy if exists session_blocks_compat_open on public.session_blocks;
drop policy if exists session_blocks_select_compat_open on public.session_blocks;
drop policy if exists session_blocks_write_compat_open on public.session_blocks;

create policy session_blocks_all_own
on public.session_blocks
for all
to authenticated
using (
  exists (
    select 1
    from public.sessions s
    where s.id = session_blocks.session_id
      and s.athlete_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = session_blocks.session_id
      and s.athlete_id = auth.uid()
  )
);

-- ---------- session_steps ----------
drop policy if exists session_steps_compat_open on public.session_steps;
drop policy if exists session_steps_select_compat_open on public.session_steps;
drop policy if exists session_steps_write_compat_open on public.session_steps;

create policy session_steps_all_own
on public.session_steps
for all
to authenticated
using (
  exists (
    select 1
    from public.session_blocks b
    join public.sessions s on s.id = b.session_id
    where b.id = session_steps.block_id
      and s.athlete_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.session_blocks b
    join public.sessions s on s.id = b.session_id
    where b.id = session_steps.block_id
      and s.athlete_id = auth.uid()
  )
);

-- ---------- personal_bests ----------
drop policy if exists personal_bests_compat_open on public.personal_bests;
drop policy if exists personal_bests_select_compat_open on public.personal_bests;
drop policy if exists personal_bests_write_compat_open on public.personal_bests;

create policy personal_bests_all_own
on public.personal_bests
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

commit;
