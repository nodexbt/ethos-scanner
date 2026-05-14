-- Adds generated columns strong_count + possible_count to the
-- investigations table so the verified-scans tab doesn't have to pull
-- every cluster_result JSONB just to count signals. STORED so reads are
-- O(1) and the values are automatically kept in sync on insert/update.
--
-- Postgres 14+ rewrites the table to populate the new columns for
-- existing rows; on ~1.1k rows this completes in well under a second.
-- Idempotent — re-running is safe.
--
-- Run via Supabase SQL editor.

ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS strong_count int GENERATED ALWAYS AS (
    CASE
      WHEN jsonb_typeof(cluster_result -> 'strongCluster') = 'array'
        THEN jsonb_array_length(cluster_result -> 'strongCluster')
      ELSE 0
    END
  ) STORED,
  ADD COLUMN IF NOT EXISTS possible_count int GENERATED ALWAYS AS (
    CASE
      WHEN jsonb_typeof(cluster_result -> 'possibleCluster') = 'array'
        THEN jsonb_array_length(cluster_result -> 'possibleCluster')
      ELSE 0
    END
  ) STORED;

-- Composite index to back the verified-tab sort. Most rows have
-- strong_count = 0, so a single-column index is fine — DESC ordering
-- pages through the flagged ones first.
CREATE INDEX IF NOT EXISTS investigations_strong_possible_idx
  ON investigations (strong_count DESC, possible_count DESC, updated_at DESC);

NOTIFY pgrst, 'reload schema';
