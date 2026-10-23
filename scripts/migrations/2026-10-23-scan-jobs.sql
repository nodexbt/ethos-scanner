-- Background scan jobs. A scan is enqueued by POST /api/scan, run by the
-- same serverless invocation after the response is sent (Next `after()`),
-- and polled by the client via GET /api/scan/jobs/{id}. Progress, logs
-- and the final result live here so a reload or a dropped connection
-- never loses a scan, and the server — not the browser — saves results.
--
-- Idempotent — re-running is safe. Run via the Supabase SQL editor.

create table if not exists public.scan_jobs (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  text not null,
  target_input      text not null,
  requested_by      integer not null,
  status            text not null default 'queued', -- queued | running | done | failed
  progress          jsonb,                           -- latest ScanProgress
  logs              jsonb not null default '[]'::jsonb,
  result            jsonb,                           -- serialized ClusterScanResult (also kept when not saved)
  saved             jsonb,                           -- { ok, code?, message? }
  error             text,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  heartbeat_at      timestamptz,
  finished_at       timestamptz
);

create index if not exists scan_jobs_requested_by_status_idx
  on public.scan_jobs (requested_by, status, created_at desc);

alter table public.scan_jobs enable row level security;

NOTIFY pgrst, 'reload schema';
