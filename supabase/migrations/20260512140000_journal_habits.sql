-- Daily reflections + journal habits (avoid generic name `habits`, which may already exist in other projects).

create table if not exists public.daily_reflections (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  entry_date date not null,
  body_text text not null default '',
  mood smallint null,
  energy smallint null,
  sleep_quality smallint null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_reflections_mood_range check (mood is null or (mood >= 1 and mood <= 5)),
  constraint daily_reflections_energy_range check (energy is null or (energy >= 1 and energy <= 5)),
  constraint daily_reflections_sleep_range check (sleep_quality is null or (sleep_quality >= 1 and sleep_quality <= 5)),
  constraint daily_reflections_one_per_day unique (athlete_id, entry_date)
);

create index if not exists daily_reflections_athlete_entry_idx on public.daily_reflections (athlete_id, entry_date);

create table if not exists public.journal_habits (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  name text not null,
  icon_emoji text not null default '✓',
  sort_order integer not null default 0,
  archived_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists journal_habits_athlete_idx on public.journal_habits (athlete_id);

create table if not exists public.journal_habit_completions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.journal_habits (id) on delete cascade,
  completion_date date not null,
  created_at timestamptz not null default now(),
  constraint journal_habit_completions_once_per_day unique (habit_id, completion_date)
);

create index if not exists journal_habit_completions_habit_date_idx on public.journal_habit_completions (habit_id, completion_date);

alter table public.daily_reflections enable row level security;
alter table public.journal_habits enable row level security;
alter table public.journal_habit_completions enable row level security;

drop policy if exists daily_reflections_all_own on public.daily_reflections;
create policy daily_reflections_all_own
on public.daily_reflections
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

drop policy if exists journal_habits_all_own on public.journal_habits;
create policy journal_habits_all_own
on public.journal_habits
for all
to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

drop policy if exists journal_habit_completions_all_own on public.journal_habit_completions;
create policy journal_habit_completions_all_own
on public.journal_habit_completions
for all
to authenticated
using (
  exists (
    select 1
    from public.journal_habits h
    where h.id = journal_habit_completions.habit_id
      and h.athlete_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.journal_habits h
    where h.id = journal_habit_completions.habit_id
      and h.athlete_id = auth.uid()
  )
);

grant select, insert, update, delete on public.daily_reflections to authenticated;
grant select, insert, update, delete on public.journal_habits to authenticated;
grant select, insert, update, delete on public.journal_habit_completions to authenticated;
