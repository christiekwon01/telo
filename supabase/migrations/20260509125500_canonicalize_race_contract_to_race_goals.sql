-- Canonical race contract: race_goals.
-- Backward compatibility: keep race_events synchronized from race_goals.
-- NOTE: Legacy writes directly to race_events are not mirrored back into race_goals.
-- TODO: remove race_events after all consumers are migrated to race_goals.

alter table if exists public.race_events
  add column if not exists athlete_id uuid references public.athletes (id) on delete cascade;

alter table if exists public.race_events
  add column if not exists priority text not null default 'c';

alter table if exists public.race_events
  add column if not exists race_type text null;

alter table if exists public.race_events
  drop constraint if exists race_events_priority_check;

alter table if exists public.race_events
  add constraint race_events_priority_check
  check (priority in ('a', 'b', 'c'));

create or replace function public.sync_race_events_from_race_goals()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.race_events
    where id = old.id;
    return old;
  end if;

  insert into public.race_events (
    id,
    athlete_id,
    name,
    date,
    distance,
    is_a_race,
    notes,
    priority,
    race_type
  )
  values (
    new.id,
    new.athlete_id,
    new.title,
    new.event_date,
    coalesce(new.goal_overall_time, ''),
    true,
    null,
    coalesce(new.priority, 'c'),
    new.race_type
  )
  on conflict (id) do update
    set athlete_id = excluded.athlete_id,
        name = excluded.name,
        date = excluded.date,
        distance = excluded.distance,
        is_a_race = excluded.is_a_race,
        notes = excluded.notes,
        priority = excluded.priority,
        race_type = excluded.race_type;

  return new;
end;
$$;

drop trigger if exists trg_sync_race_events_from_race_goals_upsert on public.race_goals;
create trigger trg_sync_race_events_from_race_goals_upsert
after insert or update of athlete_id, title, event_date, goal_overall_time, priority, race_type
on public.race_goals
for each row
execute function public.sync_race_events_from_race_goals();

drop trigger if exists trg_sync_race_events_from_race_goals_delete on public.race_goals;
create trigger trg_sync_race_events_from_race_goals_delete
after delete on public.race_goals
for each row
execute function public.sync_race_events_from_race_goals();

insert into public.race_events (
  id,
  athlete_id,
  name,
  date,
  distance,
  is_a_race,
  notes,
  priority,
  race_type
)
select
  g.id,
  g.athlete_id,
  g.title,
  g.event_date,
  coalesce(g.goal_overall_time, ''),
  true,
  null,
  coalesce(g.priority, 'c'),
  g.race_type
from public.race_goals g
on conflict (id) do update
set athlete_id = excluded.athlete_id,
    name = excluded.name,
    date = excluded.date,
    distance = excluded.distance,
    is_a_race = excluded.is_a_race,
    notes = excluded.notes,
    priority = excluded.priority,
    race_type = excluded.race_type;
