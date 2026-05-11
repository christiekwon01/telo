begin;

create or replace function public.ensure_athlete_row_for_fk()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.athlete_id is not null then
    insert into public.athletes (id, name, level, swim_background, bike_background, run_background)
    values (new.athlete_id, 'Athlete', 'fara', 'beginner', 'beginner', 'beginner')
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bootstrap_athlete_race_goals on public.race_goals;
create trigger trg_bootstrap_athlete_race_goals
before insert on public.race_goals
for each row
execute function public.ensure_athlete_row_for_fk();

drop trigger if exists trg_bootstrap_athlete_rova_conversations on public.rova_conversations;
create trigger trg_bootstrap_athlete_rova_conversations
before insert on public.rova_conversations
for each row
execute function public.ensure_athlete_row_for_fk();

drop trigger if exists trg_bootstrap_athlete_personal_bests on public.personal_bests;
create trigger trg_bootstrap_athlete_personal_bests
before insert on public.personal_bests
for each row
execute function public.ensure_athlete_row_for_fk();

commit;
