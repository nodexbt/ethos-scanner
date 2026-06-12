-- Indexes for the two hottest list queries, added alongside the server
-- pagination of the yours/all tabs:
--
-- 1. listInvestigations with scope=mine filters owner_profile_id and sorts
--    updated_at DESC. Without this the "Your Scans" tab does a full scan +
--    sort per page request.
--
-- 2. listVerifiedInvestigations (and the daily scan-verified backfill)
--    fetch every human-verified profile's primary_address. The partial
--    index keeps that an index-only scan as profile_latest grows.
--
-- Idempotent — re-running is safe.
--
-- Run via Supabase SQL editor.

CREATE INDEX IF NOT EXISTS investigations_owner_updated_idx
  ON investigations (owner_profile_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS profile_latest_verified_primary_idx
  ON profile_latest (primary_address)
  WHERE human_verified = true AND primary_address IS NOT NULL;
