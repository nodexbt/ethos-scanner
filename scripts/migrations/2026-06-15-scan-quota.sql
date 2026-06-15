-- Per-user daily scan quota. Durable (survives serverless cold starts, unlike
-- the in-memory hourly limiter), keyed by Ethos profile_id + UTC day.
--
-- Run via the Supabase SQL editor. Idempotent — safe to re-run.

create table if not exists public.scan_quota (
  profile_id integer not null,
  day        date    not null,
  count      integer not null default 0,
  primary key (profile_id, day)
);

-- Atomic "consume one" — increments today's counter and returns the new value
-- in a single statement so concurrent scans from one user can't race past the
-- cap. The caller allows the scan when the returned count is <= the limit.
create or replace function public.increment_scan_quota(p_profile_id integer, p_day date)
returns integer
language plpgsql
as $$
declare
  new_count integer;
begin
  insert into public.scan_quota (profile_id, day, count)
  values (p_profile_id, p_day, 1)
  on conflict (profile_id, day)
  do update set count = public.scan_quota.count + 1
  returning count into new_count;
  return new_count;
end;
$$;
