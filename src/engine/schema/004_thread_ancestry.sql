-- 004_thread_ancestry.sql — per-VARIANT thread analysis (internal/per-variant-analysis.md).
-- thread_events is the only ancestry-aware analysis tier: a scene's threads depend on its story-so-far, which is
-- its graph-ancestors in the ACTIVE tree variant. `ancestry_hash` = a hash of that ancestor-set, so different
-- variants keep DISTINCT thread rows for the same scene (no clobber), and switching to an already-analyzed variant
-- is a cache hit. NULL = legacy/pre-partition rows (treated as matching the active variant until re-analyzed).
-- Additive column → wire-compatible with the Python engine.
ALTER TABLE thread_events ADD COLUMN ancestry_hash TEXT;

-- Reads filter thread_events by (scene_id, ancestry_hash); writes delete+insert scoped to one ancestry.
CREATE INDEX IF NOT EXISTS idx_thread_events_scene_ancestry ON thread_events (scene_id, ancestry_hash);
