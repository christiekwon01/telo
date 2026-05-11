-- Launch hardening pack
-- Scope: schema gap coverage + indexes + FK cascade + RLS scaffolding
-- NOTE: Apply in a non-production environment first and validate with real auth flows.

create extension if not exists pgcrypto;

-- =========================
-- Core missing tables
-- =========================

create table if not exists public.rova_conversations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.flex_history (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  week_start_date date not null,
  reason text not null,
  reason_detail text null,
  override_limit boolean not null default false,
  ai_status text not null default 'fallback',
  moved_count integer not null default 0,
  dropped_count integer not null default 0,
  original_snapshot jsonb not null default '{}'::jsonb,
  reshuffled_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now(),
  constraint race_goals_priority_check check (priority in ('a', 'b', 'c'))
);

-- race_events compatibility / rollout support
create table if not exists public.race_events (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references public.athletes (id) on delete cascade,
  name text not null,
  date date not null,
  distance text not null default '',
  is_a_race boolean not null default true,
  notes text null
);

alter table public.race_events
  add column if not exists priority text not null default 'c';

alter table public.race_events
  add column if not exists race_type text null;

alter table public.race_events
  drop constraint if exists race_events_priority_check;

alter table public.race_events
  add constraint race_events_priority_check
  check (priority in ('a', 'b', 'c'));

-- =========================
-- FK cascade hardening
-- =========================

alter table public.session_blocks
  drop constraint if exists session_blocks_session_id_fkey;

alter table public.session_blocks
  add constraint session_blocks_session_id_fkey
  foreign key (session_id) references public.sessions (id) on delete cascade;

alter table public.session_steps
  drop constraint if exists session_steps_block_id_fkey;

alter table public.session_steps
  add constraint session_steps_block_id_fkey
  foreign key (block_id) references public.session_blocks (id) on delete cascade;

-- =========================
-- Indexes
-- =========================

-- athlete_id indexes
create index if not exists plans_athlete_id_idx on public.plans (athlete_id);
create index if not exists sessions_athlete_id_idx on public.sessions (athlete_id);
create index if not exists session_logs_athlete_id_idx on public.session_logs (athlete_id);
create index if not exists personal_bests_athlete_id_idx on public.personal_bests (athlete_id);
create index if not exists rova_challenges_athlete_id_idx on public.rova_challenges (athlete_id);
create index if not exists rova_conversations_athlete_id_idx on public.rova_conversations (athlete_id);
create index if not exists flex_history_athlete_id_idx on public.flex_history (athlete_id);
create index if not exists race_goals_athlete_id_idx on public.race_goals (athlete_id);
create index if not exists race_events_athlete_id_idx on public.race_events (athlete_id);

-- date/time access patterns
create index if not exists sessions_scheduled_date_idx on public.sessions (scheduled_date);
create index if not exists sessions_athlete_id_scheduled_date_idx on public.sessions (athlete_id, scheduled_date);
create index if not exists rova_conversations_athlete_created_at_desc_idx
  on public.rova_conversations (athlete_id, created_at desc);
create index if not exists race_goals_athlete_event_date_idx on public.race_goals (athlete_id, event_date);
create index if not exists race_events_athlete_date_idx on public.race_events (athlete_id, date);

-- integrity constraints
create unique index if not exists personal_bests_unique_idx
  on public.personal_bests (athlete_id, sport, distance, distance_unit);

create unique index if not exists plans_one_active_per_athlete_idx
  on public.plans (athlete_id)
  where status = 'active';

-- =========================
-- RLS enablement
-- =========================

alter table public.athletes enable row level security;
alter table public.plans enable row level security;
alter table public.sessions enable row level security;
alter table public.session_blocks enable row level security;
alter table public.session_steps enable row level security;
alter table public.session_logs enable row level security;
alter table public.personal_bests enable row level security;
alter table public.rova_challenges enable row level security;
alter table public.rova_conversations enable row level security;
alter table public.flex_history enable row level security;
alter table public.race_goals enable row level security;
alter table public.race_events enable row level security;

-- =========================
-- RLS policies (owner-scoped)
-- Assumes athletes.id maps to auth.uid().
-- =========================

drop policy if exists athletes_owner_select on public.athletes;
drop policy if exists athletes_owner_insert on public.athletes;
drop policy if exists athletes_owner_update on public.athletes;
drop policy if exists athletes_owner_delete on public.athletes;
create policy athletes_owner_select on public.athletes for select using (id = auth.uid());
create policy athletes_owner_insert on public.athletes for insert with check (id = auth.uid());
create policy athletes_owner_update on public.athletes for update using (id = auth.uid()) with check (id = auth.uid());
create policy athletes_owner_delete on public.athletes for delete using (id = auth.uid());

drop policy if exists plans_owner_all on public.plans;
create policy plans_owner_all on public.plans for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists sessions_owner_all on public.sessions;
create policy sessions_owner_all on public.sessions for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists session_logs_owner_all on public.session_logs;
create policy session_logs_owner_all on public.session_logs for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists personal_bests_owner_all on public.personal_bests;
create policy personal_bests_owner_all on public.personal_bests for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists rova_challenges_owner_all on public.rova_challenges;
create policy rova_challenges_owner_all on public.rova_challenges for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists rova_conversations_owner_all on public.rova_conversations;
create policy rova_conversations_owner_all on public.rova_conversations for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists flex_history_owner_all on public.flex_history;
create policy flex_history_owner_all on public.flex_history for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists race_goals_owner_all on public.race_goals;
create policy race_goals_owner_all on public.race_goals for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists race_events_owner_all on public.race_events;
create policy race_events_owner_all on public.race_events for all
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists session_blocks_owner_all on public.session_blocks;
create policy session_blocks_owner_all on public.session_blocks for all
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

drop policy if exists session_steps_owner_all on public.session_steps;
create policy session_steps_owner_all on public.session_steps for all
  using (
    exists (
      select 1
      from public.session_blocks sb
      join public.sessions s on s.id = sb.session_id
      where sb.id = session_steps.block_id
        and s.athlete_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.session_blocks sb
      join public.sessions s on s.id = sb.session_id
      where sb.id = session_steps.block_id
        and s.athlete_id = auth.uid()
    )
  );
