-- Per-profile investigation keying. An Ethos profile can attest multiple
-- EVM wallets; investigations were keyed per address (`scan-<address>`),
-- so a two-wallet profile produced two separate entries. New scans key by
-- profile (`scan-p<profileId>`) and record every scanned wallet.
--
-- profile_id: the Ethos profile the investigation targets (null for
-- unattested-wallet scans, which keep the legacy address key).
-- target_wallets: the full wallet set that was scanned (JSONB array).
--
-- The partial unique index enforces one investigation per profile once
-- the merge backfill (scripts/backfill/migrate-profile-ids.ts) has
-- collapsed the pre-existing per-address duplicates.
--
-- Idempotent — re-running is safe. Run via Supabase SQL editor.

ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS profile_id bigint,
  ADD COLUMN IF NOT EXISTS target_wallets jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS investigations_profile_id_key
  ON investigations (profile_id)
  WHERE profile_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
