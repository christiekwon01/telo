-- Create table used by the app for goal races.
-- This migration is intentionally minimal (no RLS/policies) to match existing repo migrations.

create table if not exists public.race_goals (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  title text not null,
  event_date date not null,
  priority text not null default 'c',
  race_type text null,
  goal_swim_time text null,
  goal_bike_time text null,
  goal_run_time text null,
  goal_overall_time text null,
  created_at timestamptz not null default now()
);

create index if not exists race_goals_athlete_id_idx on public.race_goals (athlete_id);
create index if not exists race_goals_event_date_idx on public.race_goals (event_date);
