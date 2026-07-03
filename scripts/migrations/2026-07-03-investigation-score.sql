-- Denormalize the target's Ethos score onto investigations so the scan-list
-- tabs can sort and filter by score without joining profile_latest. The value
-- already lives in cluster_result.targetEthos.score; new saves also write it
-- directly (saveInvestigation).
--
-- Idempotent — re-running is safe. Run via Supabase SQL editor.

ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS score int;

-- Backfill from the stored cluster result.
UPDATE investigations
  SET score = (cluster_result -> 'targetEthos' ->> 'score')::int
  WHERE score IS NULL
    AND cluster_result -> 'targetEthos' ->> 'score' IS NOT NULL;

-- Index to back score sorting/filtering.
CREATE INDEX IF NOT EXISTS investigations_score_idx
  ON investigations (score DESC NULLS LAST);

NOTIFY pgrst, 'reload schema';
