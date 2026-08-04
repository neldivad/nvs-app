-- NVS canonical schema — the 1.0 BASELINE.
-- Migrations 001–014 were squashed into this single resolved head for the 1.0 release. The _migrations
-- ledger still tracks by filename, so this is the ONLY file a fresh DB applies; existing head-DBs already
-- carry every object and this is a no-op for them. Never edit an applied migration — add a NEW numbered
-- file (002_*.sql, …) for any future change. Every object is IF NOT EXISTS, so re-running is idempotent.

CREATE TABLE IF NOT EXISTS _migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_windows (
    entity_id   TEXT NOT NULL REFERENCES entities(entity_id),
    chapter_id  TEXT NOT NULL REFERENCES narrative_units(unit_id),
    work_id     TEXT NOT NULL REFERENCES works(work_id),
    summary     TEXT,            -- this character in this window, 1-2 sentences
    input_hash  TEXT NOT NULL,   -- hash of the window's dialogue for this character
    model       TEXT,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (entity_id, chapter_id)
);
CREATE TABLE IF NOT EXISTS co_presence_snapshot (
    entity_a_id        TEXT NOT NULL REFERENCES entities(entity_id),
    entity_b_id        TEXT NOT NULL REFERENCES entities(entity_id),
    as_of_unit_id      TEXT NOT NULL REFERENCES narrative_units(unit_id),
    snapshot_type      TEXT NOT NULL,
    shared_appearances INTEGER NOT NULL,
    PRIMARY KEY (entity_a_id, entity_b_id, as_of_unit_id)
);
CREATE TABLE IF NOT EXISTS coherence_findings (
    finding_id    TEXT PRIMARY KEY,
    work_id       TEXT NOT NULL REFERENCES works(work_id),
    entity_id     TEXT,                  -- who (NULL for work-level findings)
    as_of_unit_id TEXT,                  -- the checkpoint (chapter unit_id)
    trait         TEXT,                  -- the aspect under review (a voice rule, a goal, a relationship)
    declared      TEXT,                  -- what the .md says ('(unstated)' if silent)
    observed      TEXT,                  -- what the dialogue shows
    kind          TEXT NOT NULL,         -- drift | gap | contradiction | confirmation
    severity      TEXT,                  -- low | medium | high
    suggestion    TEXT,                  -- advisory: update the .md to…, or 'likely intentional'
    evidence_json TEXT,                  -- list of scene unit_ids supporting `observed`
    input_hash    TEXT,
    model         TEXT,
    created_at    TEXT NOT NULL
, secret_id TEXT);
CREATE TABLE IF NOT EXISTS dialog_nodes (
    node_id       TEXT PRIMARY KEY,
    unit_id       TEXT NOT NULL REFERENCES narrative_units(unit_id),
    speaker_id    TEXT REFERENCES entities(entity_id),
    speaker_name  TEXT NOT NULL,
    text          TEXT NOT NULL,
    voice_path    TEXT,
    sequence      INTEGER NOT NULL,
    metadata_json TEXT
, dialogue_type TEXT NOT NULL DEFAULT 'speech');
CREATE TABLE IF NOT EXISTS entities (
    entity_id     TEXT PRIMARY KEY,
    work_id       TEXT NOT NULL REFERENCES works(work_id),
    type          TEXT NOT NULL,
    name          TEXT NOT NULL,
    aliases_json  TEXT,
    metadata_json TEXT
, significance TEXT);
CREATE TABLE IF NOT EXISTS entity_arc_events (
    event_id      TEXT PRIMARY KEY,
    entity_id     TEXT NOT NULL REFERENCES entities(entity_id),
    unit_id       TEXT NOT NULL REFERENCES narrative_units(unit_id),
    event_type    TEXT NOT NULL,   -- INTRODUCED|ALIGNMENT_SHIFT|BETRAYAL|DEATH|... (author vocab)
    description   TEXT NOT NULL,
    metadata_json TEXT
, category   TEXT, change     TEXT, value      TEXT, chapter_id TEXT, target TEXT, secret_id TEXT);
CREATE TABLE IF NOT EXISTS entity_presence (
    entity_id  TEXT NOT NULL REFERENCES entities(entity_id),
    unit_id    TEXT NOT NULL REFERENCES narrative_units(unit_id),
    role       TEXT,
    PRIMARY KEY (entity_id, unit_id)
);
CREATE TABLE IF NOT EXISTS entity_presence_snapshot (
    entity_id        TEXT NOT NULL REFERENCES entities(entity_id),
    as_of_unit_id    TEXT NOT NULL REFERENCES narrative_units(unit_id),
    snapshot_type    TEXT NOT NULL,
    appearance_count INTEGER,
    line_count       INTEGER,
    word_count       INTEGER,
    PRIMARY KEY (entity_id, as_of_unit_id)
);
CREATE TABLE IF NOT EXISTS "extracted_scenes" (
    scene_id            TEXT PRIMARY KEY REFERENCES narrative_units(unit_id),
    work_id             TEXT NOT NULL REFERENCES works(work_id),
    summary             TEXT,
    pov                 TEXT,        -- character NAME (resolved to an id later), or NULL
    characters_json     TEXT,        -- [name]
    locations_json      TEXT,        -- [name]
    plot_times_json     TEXT,
    goals_json          TEXT,
    conflicts_json      TEXT,
    enters_json         TEXT,
    exits_json          TEXT,
    scene_contexts_json TEXT,
    input_hash          TEXT NOT NULL,
    model               TEXT,
    created_at          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inference_runs (
    run_id         TEXT PRIMARY KEY,   -- deterministic: "{tier}:{kind}:{target_id}[:{as_of}]"
    tier           TEXT NOT NULL,      -- t1 | t2
    kind           TEXT NOT NULL,      -- scene | character | diff
    target_id      TEXT NOT NULL,      -- unit_id (scene) or entity_id (character)
    as_of_unit_id  TEXT,               -- checkpoint chapter unit_id (NULL for per-scene)
    input_hash     TEXT NOT NULL,      -- hash of the exact inputs this run consumed
    model          TEXT,               -- producer id, e.g. "session:claude-code" or "claude-opus-4-8"
    created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lore_updates (
    update_id   TEXT PRIMARY KEY,
    work_id     TEXT NOT NULL REFERENCES works(work_id),
    lore_id     TEXT NOT NULL,          -- topic handle (resolved to world/lore/*.md later)
    scene_id    TEXT NOT NULL REFERENCES narrative_units(unit_id),
    summary     TEXT NOT NULL,
    magnitude   TEXT,                    -- minor | major | retcon
    built_by    TEXT,                    -- inferred | authored
    input_hash  TEXT,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS name_resolution (
    work_id     TEXT NOT NULL REFERENCES works(work_id),
    raw_name    TEXT NOT NULL,
    kind        TEXT NOT NULL,
    entity_id   TEXT REFERENCES entities(entity_id),
    confidence  REAL,
    method      TEXT,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (work_id, kind, raw_name)
);
CREATE TABLE IF NOT EXISTS narrative_threads (
    thread_id        TEXT PRIMARY KEY,
    work_id          TEXT NOT NULL REFERENCES works(work_id),
    description      TEXT NOT NULL,
    thread_type      TEXT,
    opened_unit_id   TEXT NOT NULL REFERENCES narrative_units(unit_id),
    closed_unit_id   TEXT REFERENCES narrative_units(unit_id),
    status           TEXT NOT NULL  -- 'open'|'closed'|'retconned'|'unresolved_at_end'
, built_by TEXT, resolution_condition TEXT, succeeds TEXT, title TEXT);
CREATE TABLE IF NOT EXISTS narrative_units (
    unit_id     TEXT PRIMARY KEY,
    work_id     TEXT NOT NULL REFERENCES works(work_id),
    parent_id   TEXT REFERENCES narrative_units(unit_id),
    type        TEXT NOT NULL,   -- 'series'|'act'|'chapter'|'scene'|'talk'|... author-defined
    title       TEXT,
    sort_order  REAL NOT NULL,
    metadata_json TEXT           -- type-specific extras (quest_type: AQ/SQ/WQ, etc.)
);
CREATE TABLE IF NOT EXISTS rollups (
    unit_id    TEXT NOT NULL REFERENCES narrative_units(unit_id),
    kind       TEXT NOT NULL,                -- digest | profile
    entity_id  TEXT NOT NULL DEFAULT '',     -- '' for digests; the character for profiles
    body       TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    model      TEXT,
    created_at TEXT NOT NULL, span TEXT,
    PRIMARY KEY (unit_id, kind, entity_id)
);
CREATE TABLE IF NOT EXISTS source_files (
    work_id     TEXT NOT NULL,
    path        TEXT NOT NULL,        -- relative to the nvs root
    sha256      TEXT NOT NULL,
    unit_id     TEXT,                 -- the scene unit this file produced (NULL for non-scene files)
    ingested_at TEXT,
    PRIMARY KEY (work_id, path)
);
CREATE TABLE IF NOT EXISTS thread_events (
    event_id    TEXT PRIMARY KEY,
    work_id     TEXT NOT NULL REFERENCES works(work_id),
    thread_id   TEXT NOT NULL,           -- resolved umbrella id
    subject     TEXT,                    -- name | NULL (a singular thread's one anonymous strand)
    action      TEXT NOT NULL,           -- open | advance | resolve | reopen | supersede
    scene_id    TEXT NOT NULL REFERENCES narrative_units(unit_id),
    sort_pos    REAL,                    -- revelation-order position (scene linear_pos) for the fold
    evidence    TEXT,                    -- for resolve/reopen: the line/beat that justifies it
    confidence  REAL,                    -- producer confidence (low closes are surfaced for review)
    description TEXT,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS unit_order (
    unit_id     TEXT PRIMARY KEY REFERENCES narrative_units(unit_id),
    linear_pos  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS works (
    work_id     TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    type        TEXT NOT NULL,   -- 'game' | 'novel' | 'screenplay' | 'comic' | 'tabletop'
    author      TEXT,
    version     TEXT,
    lang        TEXT NOT NULL,
    imported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arc_chapter ON entity_arc_events(chapter_id);
CREATE INDEX IF NOT EXISTS idx_arc_entity ON entity_arc_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_arc_unit   ON entity_arc_events(unit_id);
CREATE INDEX IF NOT EXISTS idx_charwin_entity ON character_windows(entity_id);
CREATE INDEX IF NOT EXISTS idx_coh_entity ON coherence_findings(entity_id, as_of_unit_id);
CREATE INDEX IF NOT EXISTS idx_coh_kind   ON coherence_findings(work_id, kind);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_work ON entities(work_id);
CREATE INDEX IF NOT EXISTS idx_extracted_work ON extracted_scenes(work_id);
CREATE INDEX IF NOT EXISTS idx_lore_scene ON lore_updates(scene_id);
CREATE INDEX IF NOT EXISTS idx_lore_topic ON lore_updates(lore_id);
CREATE INDEX IF NOT EXISTS idx_nameres_entity ON name_resolution(entity_id);
CREATE INDEX IF NOT EXISTS idx_nodes_dialogue_type ON dialog_nodes(dialogue_type);
CREATE INDEX IF NOT EXISTS idx_nodes_speaker ON dialog_nodes(speaker_id);
CREATE INDEX IF NOT EXISTS idx_nodes_unit    ON dialog_nodes(unit_id);
CREATE INDEX IF NOT EXISTS idx_presence_entity ON entity_presence(entity_id);
CREATE INDEX IF NOT EXISTS idx_presence_unit   ON entity_presence(unit_id);
CREATE INDEX IF NOT EXISTS idx_rollups_kind ON rollups(kind, entity_id);
CREATE INDEX IF NOT EXISTS idx_runs_target ON inference_runs(tier, kind, target_id);
CREATE INDEX IF NOT EXISTS idx_tevents_scene  ON thread_events(scene_id);
CREATE INDEX IF NOT EXISTS idx_tevents_strand ON thread_events(thread_id, subject);
CREATE INDEX IF NOT EXISTS idx_units_parent  ON narrative_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_units_work    ON narrative_units(work_id);
