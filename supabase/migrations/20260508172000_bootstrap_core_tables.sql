-- Baseline bootstrap for core Telo tables.
-- Run this BEFORE launch_hardening_pack.sql when the project is missing base tables.

create extension if not exists pgcrypto;

create table if not exists public.athletes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text null,
  level text not null default 'fara',
  swim_background text not null default 'beginner',
  bike_background text not null default 'beginner',
  run_background text not null default 'beginner',
  goal_race_date date null,
  goal_race_name text null,
  created_at timestamptz not null default now(),
  constraint athletes_level_check check (level in ('fara', 'orka', 'vinna')),
  constraint athletes_swim_background_check check (swim_background in ('beginner', 'experienced', 'competitive')),
  constraint athletes_bike_background_check check (bike_background in ('beginner', 'experienced', 'competitive')),
  constraint athletes_run_background_check check (run_background in ('beginner', 'experienced', 'competitive'))
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  name text not null,
  phase text null,
  start_date date not null,
  end_date date null,
  total_weeks integer null,
  status text null default 'active'
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  title text not null,
  sport text not null,
  scheduled_date date not null,
  duration_mins integer null,
  distance numeric null,
  distance_unit text null,
  intensity text null,
  description text null,
  coach_note text null,
  status text null default 'planned',
  completed_at timestamptz null,
  week_number integer null,
  phase text null,
  created_at timestamptz not null default now()
);

create table if not exists public.session_blocks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  block_type text not null,
  title text not null,
  order_index integer not null
);

create table if not exists public.session_steps (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.session_blocks (id) on delete cascade,
  step_text text not null,
  order_index integer not null,
  is_checked boolean not null default false
);

create table if not exists public.session_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  completed_at timestamptz not null,
  actual_duration_mins integer null,
  actual_distance numeric null,
  avg_heart_rate integer null,
  rpe integer null,
  notes text null,
  media_uris jsonb null
);

create table if not exists public.personal_bests (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  sport text not null,
  distance numeric not null,
  distance_unit text not null,
  time_mins numeric not null,
  achieved_date date not null,
  source text not null default 'auto',
  session_log_id uuid null references public.session_logs (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.rova_challenges (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  challenge_type text not null,
  title text not null,
  description text not null,
  scheduled_date date not null,
  status text not null default 'pending',
  accepted_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);
