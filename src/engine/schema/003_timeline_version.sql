-- 003_timeline_version.sql — the timeline redesign, slice 1 (internal/timeline-model.md).
-- The analysis is bound to a GRAPH version: the `leads_to` DAG it walked. `timeline_versions` holds each saved
-- graph; every analysis row is stamped with the version that produced it, so switching versions shows (or
-- offers to run) that version's analysis. Additive columns → wire-compatible with the Python engine (ledger).
CREATE TABLE IF NOT EXISTS timeline_versions (
    version_id  TEXT PRIMARY KEY,   -- stable hash of the leads_to edge set (or a user-named save)
    name        TEXT,               -- display name (NULL = auto)
    graph_json  TEXT,               -- the leads_to edge set this version captured
    created_at  TEXT
);

ALTER TABLE narrative_threads  ADD COLUMN timeline_version TEXT;
ALTER TABLE thread_events      ADD COLUMN timeline_version TEXT;
ALTER TABLE entity_arc_events  ADD COLUMN timeline_version TEXT;
ALTER TABLE coherence_findings ADD COLUMN timeline_version TEXT;
ALTER TABLE character_windows  ADD COLUMN timeline_version TEXT;
