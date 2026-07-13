-- Migration 036: per-model default planner tilt (upright orientation)
--
-- An STL file has no canonical "up" axis. The STL→GLB converter assumes the
-- 3D-printing Z-up convention (terrain), but character sculpts are usually
-- authored Y-up, so they import into the planner lying on their side. Rather
-- than making every buyer press T to stand a figure up each time, an artist can
-- bake in the tilt that stands their model upright and it's applied to every
-- placement. Degrees, pitch about the model's local X axis (typically 0/90/180/270).

ALTER TABLE models ADD COLUMN IF NOT EXISTS default_pitch_deg INTEGER NOT NULL DEFAULT 0;
