create extension if not exists pgcrypto;

create table if not exists public.apple_calendar_subscriptions (
  athlete_id uuid primary key references public.athletes (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apple_calendar_subscriptions_token_hash_idx
  on public.apple_calendar_subscriptions (token_hash);

create or replace function public.touch_apple_calendar_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_apple_calendar_subscriptions_updated_at on public.apple_calendar_subscriptions;
create trigger trg_touch_apple_calendar_subscriptions_updated_at
before update on public.apple_calendar_subscriptions
for each row
execute function public.touch_apple_calendar_subscriptions_updated_at();

alter table public.apple_calendar_subscriptions enable row level security;

revoke all on table public.apple_calendar_subscriptions from anon, authenticated;
