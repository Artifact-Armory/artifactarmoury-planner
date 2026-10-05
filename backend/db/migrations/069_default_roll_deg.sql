-- Migration 069: per-model default planner roll (second upright axis)
--
-- 036 let an artist bake in a tilt about X, but that single axis cannot stand up
-- a figure whose long axis lies along X (it just spins it about its own length).
-- Roll is a rotation about the model's local Z, applied before the pitch, so the
-- 16 combinations of pitch x roll (0/90/180/270) cover every way a sculpt can lie.

ALTER TABLE models ADD COLUMN IF NOT EXISTS default_roll_deg INTEGER NOT NULL DEFAULT 0;
