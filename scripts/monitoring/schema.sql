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

-- Service-keyed identities (Twitter, Discord, Farcaster, Telegram, GitHub).
-- Mirrors profile_addresses for the non-wallet half of Ethos's userkey
-- system. Used to resolve review/slash subjects whose target is a service
-- account ID rather than a wallet, so received-side aggregations don't
-- have to round-trip to Ethos's userkeys table during the cron.
create table if not exists public.profile_service_keys (
  profile_id integer not null,
  service text not null,
  account text not null,
  created_at timestamptz default now(),
  primary key (profile_id, service, account)
);

create index if not exists idx_profile_service_keys_lookup
  on public.profile_service_keys (service, account);

alter table public.profile_service_keys enable row level security;

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

-- ── Aggregation RPCs for window-aware monitoring queries ──
-- Top score movers: sums score_delta across the window, returns the most
-- recent score_end so we can show a clean "start → end" range. Filters to
-- positive movers only.
create or replace function public.monitoring_top_score_movers(
  start_date date,
  lim int default 5
)
returns table (
  profile_id integer,
  score_delta_sum bigint,
  score_end integer
)
language sql
stable
as $$
  select
    profile_id,
    sum(score_delta)::bigint as score_delta_sum,
    (
      select pd2.score_end
      from public.profile_daily pd2
      where pd2.profile_id = pd.profile_id
        and pd2.snapshot_date >= start_date
        and pd2.score_end is not null
      order by pd2.snapshot_date desc
      limit 1
    ) as score_end
  from public.profile_daily pd
  where snapshot_date >= start_date
    and score_delta is not null
  group by profile_id
  having sum(score_delta) > 0
  order by score_delta_sum desc
  limit lim;
$$;

-- Top XP gainers: sums both gained and spent across the window.
create or replace function public.monitoring_top_xp_gainers(
  start_date date,
  lim int default 5
)
returns table (
  profile_id integer,
  xp_gained_sum bigint,
  xp_spent_sum bigint
)
language sql
stable
as $$
  select
    profile_id,
    sum(xp_gained)::bigint as xp_gained_sum,
    sum(xp_spent)::bigint as xp_spent_sum
  from public.profile_daily
  where snapshot_date >= start_date
    and xp_gained > 0
  group by profile_id
  order by xp_gained_sum desc
  limit lim;
$$;

-- Generic activity-spikes RPC. metric must be one of an explicit allowlist
-- to keep the dynamic SQL safe.
create or replace function public.monitoring_top_spikes(
  metric text,
  start_date date,
  lim int default 5
)
returns table (
  profile_id integer,
  count_sum bigint
)
language plpgsql
stable
as $$
declare
  q text;
begin
  if metric not in (
    'reviews_authored', 'vouches_given', 'invitations_accepted',
    'invitations_sent', 'attestations_added', 'slashes_authored',
    'vouches_received', 'reviews_received'
  ) then
    raise exception 'Invalid metric: %', metric;
  end if;

  q := format('
    select profile_id, sum(%I)::bigint as count_sum
    from public.profile_daily
    where snapshot_date >= %L and %I > 0
    group by profile_id
    order by count_sum desc
    limit %s
  ', metric, start_date, metric, lim);

  return query execute q;
end;
$$;

-- Nudge PostgREST to refresh its schema cache after adding tables/functions.
notify pgrst, 'reload schema';
