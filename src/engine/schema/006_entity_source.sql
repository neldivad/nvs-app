-- 006_entity_source.sql — where an entity CAME FROM, so prune can evict correctly (see internal/content-id.md).
-- 'page'   = authored world page (content/world/**.md) — a cache of that file; evict when the file is deleted.
-- 'minted' = discovered by the analysis in prose (a "thing" writeTier minted, no file) — a cache of references;
--            evict only when no scene mentions it anymore.
-- NULL = legacy (pre-006) — ingest re-stamps page-backed entities to 'page' on the next run; anything still
--        NULL + fileless is treated like 'minted' for prune (a live page would have been re-stamped this pass).
ALTER TABLE entities ADD COLUMN source TEXT;
