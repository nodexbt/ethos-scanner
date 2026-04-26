-- Monitoring schema — paste into Supabase SQL editor and run once.
--
-- profile_latest holds the current (and prior-run) score/xp for each Ethos
-- profile we've seen, so the cron can compute day-over-day deltas without
-- storing one row per profile per day.
--
-- profile_daily is an append-log of "interesting" days — a row is only
-- written when a profile had activity or a score/xp change. Keeps storage
-- bounded while preserving a full time-series for the dashboard.

-- Latest observed score/xp per profile. The cron reads this before writing
-- its new values, which gives us "value at previous run" for free — no need
-- for a separate last_* column. Next run reads this, diffs, then overwrites.
create table if not exists public.profile_latest (
  profile_id integer primary key,
  score integer,
  xp_total bigint,
  human_verified boolean,
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

-- display_name / username / avatar_url added after initial migration. Safe to re-run.
-- primary_address is the first 0x wallet keyed to the profile's userkeys
-- row; used to launch a sybil cluster scan from the monitoring dashboard
-- without a live Ethos-DB round-trip on the web side.
alter table public.profile_latest
  add column if not exists display_name text,
  add column if not exists username text,
  add column if not exists avatar_url text,
  add column if not exists primary_address text;

create table if not exists public.profile_daily (
  profile_id integer not null,
  snapshot_date date not null,
  score_end integer,
  score_delta integer,
  xp_total_end bigint,
  xp_delta bigint,
  reviews_authored integer default 0,
  vouches_given integer default 0,
  vouch_given_wei numeric default 0,
  invitations_sent integer default 0,
  vouches_received integer default 0,
  human_verified boolean,
  created_at timestamptz default now(),
  primary key (profile_id, snapshot_date)
);

-- Added after initial migration. Safe to re-run.
-- xp_by_type stores a per-type breakdown (e.g. VOTE_COST, VOUCH_POOL_REWARD)
-- as {type: signed_points} so the dashboard can distinguish "earned from
-- rewards" from "farmed via passive events" without a schema change per
-- new Ethos XP event type.
alter table public.profile_daily
  add column if not exists invitations_accepted integer default 0,
  add column if not exists attestations_added integer default 0,
  add column if not exists slashes_authored integer default 0,
  add column if not exists xp_gained bigint default 0,
  add column if not exists xp_spent bigint default 0,
  add column if not exists xp_by_type jsonb default '{}'::jsonb,
  -- xp_tips shape: {"sent":{"<counterpartyProfileId>":<points>,...},
  --                 "received":{"<counterpartyProfileId>":<points>,...}}
  add column if not exists xp_tips jsonb default '{}'::jsonb;

create index if not exists idx_profile_daily_date_score
  on public.profile_daily (snapshot_date, score_delta desc);
create index if not exists idx_profile_daily_date_reviews
  on public.profile_daily (snapshot_date, reviews_authored desc);
create index if not exists idx_profile_daily_date_vouches
  on public.profile_daily (snapshot_date, vouches_given desc);

create table if not exists public.monitoring_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  rows_written integer,
  error_message text,
  duration_ms integer
);

alter table public.profile_latest enable row level security;
alter table public.profile_daily enable row level security;
alter table public.monitoring_runs enable row level security;

-- Every wallet address keyed to a profile. primary_address on profile_latest
-- is only a display/launch convenience; this table is the canonical mapping
-- used to cross-reference arbitrary scanner targets (which can be any of a
-- profile's wallets) against the monitored profiles.
create table if not exists public.profile_addresses (
  profile_id integer not null,
  address text not null,
  created_at timestamptz default now(),
  primary key (profile_id, address)
);

create index if not exists idx_profile_addresses_address
  on public.profile_addresses (address);

alter table public.profile_addresses enable row level security;

-- Per-user watchlist. user_profile_id is the Ethos profile ID of the signed-in
-- user (from session.user.ethos.profileId); watched_profile_id is the
-- Ethos profile being tracked.
create table if not exists public.watchlist (
  user_profile_id integer not null,
  watched_profile_id integer not null,
  note text,
  added_at timestamptz default now(),
  primary key (user_profile_id, watched_profile_id)
);

create index if not exists idx_watchlist_user
  on public.watchlist (user_profile_id);

alter table public.watchlist enable row level security;

-- Nudge PostgREST to refresh its schema cache after adding tables.
-- Supabase-hosted instances occasionally miss the auto-reload; this makes
-- sure the REST layer sees any new tables as soon as this file is run.
notify pgrst, 'reload schema';
