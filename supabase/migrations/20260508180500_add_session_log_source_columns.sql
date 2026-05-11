alter table public.session_logs
add column if not exists source text,
add column if not exists external_workout_id text;

create index if not exists session_logs_source_idx on public.session_logs (source);
create index if not exists session_logs_external_workout_id_idx on public.session_logs (external_workout_id);
