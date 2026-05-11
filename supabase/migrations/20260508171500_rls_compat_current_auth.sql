-- RLS compatibility for current app auth model.
-- Use this if the app is not yet using Supabase Auth user IDs mapped to athletes.id.
-- This migration makes the hardened schema usable immediately by disabling restrictive RLS.

-- Drop strict owner-scoped policies if they were created.
drop policy if exists athletes_owner_select on public.athletes;
drop policy if exists athletes_owner_insert on public.athletes;
drop policy if exists athletes_owner_update on public.athletes;
drop policy if exists athletes_owner_delete on public.athletes;

drop policy if exists plans_owner_all on public.plans;
drop policy if exists sessions_owner_all on public.sessions;
drop policy if exists session_blocks_owner_all on public.session_blocks;
drop policy if exists session_steps_owner_all on public.session_steps;
drop policy if exists session_logs_owner_all on public.session_logs;
drop policy if exists personal_bests_owner_all on public.personal_bests;
drop policy if exists rova_challenges_owner_all on public.rova_challenges;
drop policy if exists rova_conversations_owner_all on public.rova_conversations;
drop policy if exists flex_history_owner_all on public.flex_history;
drop policy if exists race_goals_owner_all on public.race_goals;
drop policy if exists race_events_owner_all on public.race_events;

-- Keep behavior compatible with current client-side athlete-id model.
alter table if exists public.athletes disable row level security;
alter table if exists public.plans disable row level security;
alter table if exists public.sessions disable row level security;
alter table if exists public.session_blocks disable row level security;
alter table if exists public.session_steps disable row level security;
alter table if exists public.session_logs disable row level security;
alter table if exists public.personal_bests disable row level security;
alter table if exists public.rova_challenges disable row level security;
alter table if exists public.rova_conversations disable row level security;
alter table if exists public.flex_history disable row level security;
alter table if exists public.race_goals disable row level security;
alter table if exists public.race_events disable row level security;
