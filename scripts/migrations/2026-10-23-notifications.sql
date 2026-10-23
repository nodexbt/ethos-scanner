-- In-app notifications. Written server-side when a completed scan adds a
-- link involving a profile someone watches (public.watchlist, which
-- predates this migration). Read via GET /api/notifications.
--
-- Idempotent — re-running is safe. Run via the Supabase SQL editor.

create table if not exists public.notifications (
  id                    bigserial primary key,
  recipient_profile_id  integer not null,
  type                  text not null,          -- 'new_links' | 'watched_linked'
  subject_profile_id    integer not null,       -- the watched profile this is about
  investigation_id      text,
  payload               jsonb not null default '{}'::jsonb,
  read                  boolean not null default false,
  created_at            timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_profile_id, read, created_at desc);

alter table public.notifications enable row level security;

NOTIFY pgrst, 'reload schema';
