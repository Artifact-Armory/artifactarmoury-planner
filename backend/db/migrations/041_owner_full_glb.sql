-- 041_owner_full_glb.sql
-- OWNER FULL-FIDELITY GLB
--
-- The GLB the planner draws today is a *preview proxy*: decimated to a triangle
-- budget and (on the bake path) carrying an embossed "ARTIFACT ARMOURY" watermark
-- wrapped around the model's base. That is deliberate — an unowned preview should
-- be useless on a print bed.
--
-- Someone who has BOUGHT the model already has the STL, so there is nothing left
-- to protect: they should see the real mesh. This adds a SECOND, independent
-- pipeline that converts the canonical STL to a full-triangle, un-watermarked GLB
-- and serves it (only) to entitled viewers.
--
-- It is deliberately decoupled from upload processing: a full GLB job NEVER gates
-- models.processing_status, so a model still goes 'ready' — and the artist still
-- leaves the upload form — at exactly the same moment it does today. If the full
-- build is slow, late, or fails outright, the buyer simply sees the proxy, which
-- is the current behaviour.
--
-- Storage note: the R2 bucket is publicly readable through the CDN, and model ids
-- are public. The full GLB is effectively the printable mesh, so its key carries a
-- random component (see services/fullGlb/build.ts) and is never returned in any
-- API payload — the bytes are only reachable through the entitlement-checked
-- streaming route. Do not "helpfully" expose full_glb_path.

-- ---------------------------------------------------------------------------
-- Where the built artefact lands, per bakeable mesh.
-- status: NULL/'queued' -> 'processing' -> 'ready' | 'failed' | 'skipped'
--   'skipped' = deliberately not built (e.g. over FULL_GLB_MAX_TRIS); not an error.
-- ---------------------------------------------------------------------------
ALTER TABLE models ADD COLUMN IF NOT EXISTS full_glb_path VARCHAR(500);
ALTER TABLE models ADD COLUMN IF NOT EXISTS full_glb_status VARCHAR(20);
ALTER TABLE models ADD COLUMN IF NOT EXISTS full_glb_error TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS full_glb_tris INTEGER;

ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS full_glb_path VARCHAR(500);
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS full_glb_status VARCHAR(20);
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS full_glb_error TEXT;
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS full_glb_tris INTEGER;

COMMENT ON COLUMN models.full_glb_path IS
  'R2 key of the un-decimated, un-watermarked GLB served to entitled buyers/the artist. Never expose this key in an API response (migration 041).';

-- ---------------------------------------------------------------------------
-- The queue. Same claim discipline as proxy_bake_jobs (FOR UPDATE SKIP LOCKED +
-- heartbeat + stale-lock reclaim) so the bake worker can drain both, but a
-- separate table so a backlog of full-GLB work can never delay a preview bake.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS full_glb_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    -- NULL = the model's primary mesh; otherwise the model_parts row this builds.
    part_id UUID REFERENCES model_parts(id) ON DELETE CASCADE,
    -- R2 key of the CANONICAL STL (never the artist's original OBJ/3MF): the
    -- canonical STL is what the fingerprint, the preview and the watermark all
    -- operate on, so the full GLB must agree with it.
    source_key VARCHAR(500) NOT NULL,
    -- queued -> running -> succeeded | failed | skipped
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    report JSONB,
    error TEXT,
    locked_at TIMESTAMP,
    locked_by VARCHAR(120),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The worker claims the oldest still-open job; a partial index keeps that cheap.
CREATE INDEX IF NOT EXISTS idx_full_glb_jobs_open
    ON full_glb_jobs (created_at)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_full_glb_jobs_model ON full_glb_jobs (model_id);

-- One open job per mesh: re-uploading a file version replaces the pending build
-- instead of stacking a second one behind it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_full_glb_jobs_one_open
    ON full_glb_jobs (model_id, (COALESCE(part_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    WHERE status IN ('queued', 'running');

COMMENT ON TABLE full_glb_jobs IS
  'Queue for the owner full-fidelity GLB build (migration 041). Independent of proxy_bake_jobs; never gates models.processing_status.';
