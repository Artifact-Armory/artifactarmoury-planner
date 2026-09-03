-- 056_mesh_warning_ack.sql
--
-- Mesh QA (032) surfaced EVERY topology issue to buyers, including non-manifold
-- edges with zero open edges — the common case, and one that's routine CAD noise
-- most slicers repair silently (overlapping/duplicate faces from a boolean union
-- or a multi-part merge). That's not "product breaking", it just made artists
-- look bad for a fault buyers were extremely unlikely to ever hit.
--
-- New split: only a genuine open edge (a real hole — the shell isn't closed, so a
-- slicer's inside/outside test can fail outright) counts as "serious" from here
-- on. Everything else (non-manifold-only, degenerate-only) is no longer surfaced
-- anywhere. Serious warnings move OFF the public product page entirely and onto
-- the artist's own model page, where the artist can acknowledge + override —
-- publishing is blocked until they do, and the override notifies admins so a
-- pattern of ignored warnings is visible.

ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_warning_acknowledged BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_warning_acknowledged_at TIMESTAMP;
ALTER TABLE models ADD COLUMN IF NOT EXISTS mesh_warning_acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN models.mesh_warning_acknowledged IS
  'Artist has acknowledged a serious mesh QA warning (open edges > 0) and chosen to publish anyway. Reset to false whenever the file changes (new upload / new version).';
