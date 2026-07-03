-- Cross-profile connection graph derived from saved investigations.
-- One row per (source profile → candidate profile) edge found by a scan,
-- refreshed whenever that investigation is re-saved. Powers the
-- "second-degree connections" panel: profiles connected to your scan's
-- candidates via other saved scans, without spending any Alchemy calls.
--
-- Idempotent — re-running is safe. Run via Supabase SQL editor.

CREATE TABLE IF NOT EXISTS investigation_edges (
  source_profile_id bigint NOT NULL,
  candidate_profile_id bigint NOT NULL,
  investigation_id text NOT NULL,
  confidence text NOT NULL, -- 'high' | 'medium'
  score int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_profile_id, candidate_profile_id)
);

CREATE INDEX IF NOT EXISTS investigation_edges_candidate_idx
  ON investigation_edges (candidate_profile_id);

NOTIFY pgrst, 'reload schema';
