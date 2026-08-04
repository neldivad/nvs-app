-- 007_scene_premise_conclusion.sql — split the scene's single `summary` into distinct, individually-consumable
-- components: premise (why the scene starts / its setup) and conclusion (how it ends / the cliffhanger). These are
-- the first-class checkpoint components (internal/analysis-components.md, Slice 1). Additive + nullable: legacy
-- rows keep `summary` and read NULL here → the UI falls back to `summary`; new extractions populate all three.
-- No forced re-analysis (the analysis prompt version is deliberately NOT bumped for this slice).
ALTER TABLE extracted_scenes ADD COLUMN premise TEXT;
ALTER TABLE extracted_scenes ADD COLUMN conclusion TEXT;
