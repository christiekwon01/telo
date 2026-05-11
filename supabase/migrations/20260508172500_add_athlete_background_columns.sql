-- Add sport background columns required by Profile level popup save flow.

alter table public.athletes
  add column if not exists swim_background text not null default 'beginner',
  add column if not exists bike_background text not null default 'beginner',
  add column if not exists run_background text not null default 'beginner';

alter table public.athletes
  drop constraint if exists athletes_swim_background_check;
alter table public.athletes
  add constraint athletes_swim_background_check
  check (swim_background in ('beginner', 'experienced', 'competitive'));

alter table public.athletes
  drop constraint if exists athletes_bike_background_check;
alter table public.athletes
  add constraint athletes_bike_background_check
  check (bike_background in ('beginner', 'experienced', 'competitive'));

alter table public.athletes
  drop constraint if exists athletes_run_background_check;
alter table public.athletes
  add constraint athletes_run_background_check
  check (run_background in ('beginner', 'experienced', 'competitive'));
