-- 037_proxy_bake_jobs.sql
-- Preview Proxy Bake Pipeline
--
-- The preview GLB shown in the planner is now (optionally) produced by a separate
-- Blender + Cycles "bake" worker instead of the in-process pure-Node decimator.
-- The bake turns a high-poly source mesh into a smooth low-poly PROXY whose
-- surface detail (brick, grain, cracks) is baked into normal + AO maps — a
-- lighting trick that looks right in the planner but is useless on a print bed.
--
-- A Blender bake is minutes-long and CPU-heavy, so it can't run inside the web
-- service. This table is the queue: the web service INSERTs a 'queued' row when a
-- model is uploaded/updated; the worker claims rows with SELECT ... FOR UPDATE
-- SKIP LOCKED, bakes, and writes the result back. One row per bakeable mesh
-- (the model's primary mesh = part_id NULL; each extra "set" part = its part_id).

CREATE TABLE IF NOT EXISTS proxy_bake_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    -- NULL = the model's primary mesh; otherwise the model_parts row this bakes.
    part_id UUID REFERENCES model_parts(id) ON DELETE CASCADE,
    -- R2 key of the canonical STL (or original source) the worker downloads + bakes.
    source_key VARCHAR(500) NOT NULL,
    source_format VARCHAR(10) NOT NULL DEFAULT 'stl',
    -- queued -> running -> succeeded | failed
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    -- Per-model config overrides, merged over the global defaults by the worker.
    config JSONB,
    -- The report JSON the bake emits (tri counts, timings, warnings, etc.).
    report JSONB,
    error TEXT,
    -- Claim bookkeeping so a crashed worker's job can be reclaimed after a timeout.
    locked_at TIMESTAMP,
    locked_by VARCHAR(120),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The worker claims the oldest still-open job; a partial index keeps that cheap.
CREATE INDEX IF NOT EXISTS idx_proxy_bake_jobs_open
    ON proxy_bake_jobs (created_at)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_proxy_bake_jobs_model ON proxy_bake_jobs (model_id);

-- Per-model bake overrides (thin geometry needs them) + the latest report,
-- surfaced later in an admin/artist review UI (UI itself is out of scope here).
ALTER TABLE models ADD COLUMN IF NOT EXISTS proxy_bake_config JSONB;
ALTER TABLE models ADD COLUMN IF NOT EXISTS proxy_report JSONB;
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS proxy_bake_config JSONB;
ALTER TABLE model_parts ADD COLUMN IF NOT EXISTS proxy_report JSONB;
