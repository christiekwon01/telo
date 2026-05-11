-- Harden function execution context and add missing FK index from advisor.

create index if not exists personal_bests_session_log_id_idx
  on public.personal_bests (session_log_id);

create or replace function public.touch_apple_calendar_subscriptions_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
