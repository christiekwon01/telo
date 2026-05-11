begin;

alter table if exists public.race_events enable row level security;

drop policy if exists race_events_all_own on public.race_events;
drop policy if exists race_events_mobile_compat on public.race_events;
drop policy if exists race_events_compat_open on public.race_events;

create policy race_events_compat_open
on public.race_events
for all
using (true)
with check (true);

commit;
