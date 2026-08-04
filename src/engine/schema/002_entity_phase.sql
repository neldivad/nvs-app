-- 002_entity_phase.sql — carry each entity's content-phase (draft | developing | canon | archived) from its
-- world-page frontmatter onto the entity row. Lets visualizations (Cast rail, Relation rail, entity pivots)
-- drop ARCHIVED characters/locations/items the same way the scene canon gate drops non-canon scenes.
-- NULL = unset → treated as visible (legacy DBs, and pages with no explicit phase).
ALTER TABLE entities ADD COLUMN phase TEXT;
