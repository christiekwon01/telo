begin;

create or replace function public.sync_race_events_from_race_goals()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    begin
      delete from public.race_events where id = old.id;
    exception when others then
      -- Do not block canonical race_goals deletes when legacy mirror fails.
      null;
    end;
    return old;
  end if;

  begin
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
  exception when others then
    -- Keep race_goals as canonical; never fail write because legacy mirror had an issue.
    null;
  end;

  return new;
end;
$$;

commit;
