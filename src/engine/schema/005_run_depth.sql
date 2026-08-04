-- Depth of a scene extraction run: 'full' (the complete ledger contract) or 'skim' (fast mode — summary +
-- threads + presence only). NULL on pre-depth rows and non-scene kinds; readers treat NULL as 'full'.
-- An EXPERT run treats a fresh-but-skim scene as stale (full ⊃ skim); a FAST run accepts either depth.
ALTER TABLE inference_runs ADD COLUMN depth TEXT;
