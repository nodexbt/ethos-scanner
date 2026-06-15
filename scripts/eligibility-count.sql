-- How many users meet the access bar: human-verified AND score >= 1800.
-- Mirrors lib/access.ts (MIN_SCORE = 1800, humanVerificationStatus === 'VERIFIED').
--
-- Two queries below:
--   (A) runnable now against the scanner's own Supabase — but only covers
--       profiles the monitoring cron has already observed, so it's a LOWER
--       BOUND, not the network-wide count.
--   (B) the authoritative count against the Ethos production DB. Column/table
--       names are placeholders — adjust to the real schema.

-- ============================================================================
-- (A) Scanner Supabase (Supabase SQL editor). Subset = profiles we've seen.
-- ============================================================================
select count(*) as eligible_seen
from public.profile_latest
where human_verified = true
  and score >= 1800;

-- Optional breakdown to see how much the verification half costs you:
select
  count(*) filter (where score >= 1800)                          as score_ok,
  count(*) filter (where human_verified)                         as verified,
  count(*) filter (where human_verified and score >= 1800)       as both
from public.profile_latest;

-- ============================================================================
-- (B) Ethos production DB — authoritative, network-wide. ADJUST NAMES.
--     Assumes a users/profiles table with an integer score and a
--     human_verification_status text column ('VERIFIED' | null), matching
--     the v2 API's EthosProfile shape (lib/ethos.ts).
-- ============================================================================
select count(*) as eligible_total
from users                                  -- <-- real table name
where human_verification_status = 'VERIFIED'
  and score >= 1800;
