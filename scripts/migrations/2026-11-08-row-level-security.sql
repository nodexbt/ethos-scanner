-- Row-level security on every table. The app only ever talks to Postgres
-- with the service role key, which bypasses RLS, so nothing in the app
-- changes. What changes: the project's anon and authenticated keys (which
-- every Supabase project issues, and which a second app in this project
-- would use) can no longer read or write these tables through PostgREST.
-- Enabling RLS with no policies means "deny everything except the service
-- role", which is exactly the posture the app assumes today.
--
-- scan_jobs and notifications already had this (2026-10-23 migrations);
-- they are repeated here so the list is the complete inventory.
--
-- Idempotent — re-running is safe. Run via the Supabase SQL editor.

alter table public.investigations        enable row level security;
alter table public.investigation_edges   enable row level security;
alter table public.allowed_users         enable row level security;
alter table public.allowed_users_audit   enable row level security;
alter table public.profile_latest        enable row level security;
alter table public.profile_addresses     enable row level security;
alter table public.watchlist             enable row level security;
alter table public.monitoring_runs       enable row level security;
alter table public.scan_quota            enable row level security;
alter table public.scan_jobs             enable row level security;
alter table public.notifications         enable row level security;

-- The quota counter is a function, and functions are not covered by RLS.
-- Postgres grants EXECUTE to PUBLIC by default, so an anon caller could
-- burn any profile's daily quota. Keep it callable by the service role only.
revoke execute on function public.increment_scan_quota(integer, date) from public, anon, authenticated;

-- Verify: every row should show rls_enabled = true.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

notify pgrst, 'reload schema';
