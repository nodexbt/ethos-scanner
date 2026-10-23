-- Distinguish personal wallets (EOAs the user connected) from smart-contract
-- wallets (e.g. the Ethos/Privy-provisioned proxy, ~37% of attested wallets).
-- Smart wallets shouldn't be scanned as personal wallets: their history is
-- contract/protocol activity, and because many profiles share the same proxy
-- implementation and interact with the same Ethos contracts, scanning them
-- manufactures false clusters.
--
-- is_contract: true if the address has contract bytecode on any scanned
-- chain (a smart wallet), false if it's an EOA (an EIP-7702 delegation
-- designator does not count as contract code — see lib/wallet-classify.ts),
-- null if not yet classified. Populated
-- by scripts/backfill/classify-wallets.ts and kept fresh by the nightly sync.
--
-- Idempotent — re-running is safe. Run via Supabase SQL editor.

ALTER TABLE profile_addresses
  ADD COLUMN IF NOT EXISTS is_contract boolean;

NOTIFY pgrst, 'reload schema';
