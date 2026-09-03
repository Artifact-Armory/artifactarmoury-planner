-- 057_model_ingest_jobs.sql
-- Model ingest queue (upload processing moved off the API server)
--
-- Uploading a model downloads the raw file from R2, dedup-checks its file hash +
-- geometry fingerprint, parses the STL to compute dims/mesh-QA, and (pure-Node
-- fallback path) decimates a preview GLB. This used to run entirely in-process
-- inside the API server (routes/models.ts's processUploadedModel /
-- processModelVersionUpdate — "background" only in the sense of not being
-- awaited by the HTTP response, but still the same Node process that serves
-- every other request). A sufficiently dense mesh can spike memory enough to
-- OOM-kill that process, taking the whole site down with it — see
-- fileProcessor.ts's MAX_INGEST_TRIANGLES comment for the measured cost per
-- triangle this parser carries.
--
-- This table lets that work move to the same separate worker service that
-- already bakes preview GLBs (worker/proxyBakeWorker.ts), so a memory spike
-- there can only crash the worker, never the web dyno. One row per upload or
-- version-update; the JSONB payload carries the (small) arguments the
-- in-process call used to take directly — raw R2 keys, filenames, version
-- notes, never the file itself. The model-level DB writes and artist
-- notifications stay exactly where they were, in
-- services/modelIngest/process.ts — only WHERE that code executes changes,
-- not what it does.
--
-- Off by default (MODEL_INGEST_WORKER_ENABLED unset/false): routes/models.ts
-- keeps calling the processing functions directly in-process, unchanged from
-- before this migration. Deploying this code changes nothing until the flag is
-- set AND the worker service is actually running to drain the queue — the same
-- opt-in shape as PROXY_BAKE_ENABLED. Unlike the owner-GLB queue there is
-- deliberately no in-process inline fallback: the whole point of the flag is
-- "this work must never run in the API server again", so a silent fallback
-- there would defeat it. Turning the flag on without a worker deployed leaves
-- uploads stuck 'processing' forever — see the CLAUDE.md entry for this change.

CREATE TABLE IF NOT EXISTS model_ingest_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    -- 'upload' = processUploadedModel, 'version' = processModelVersionUpdate.
    job_type VARCHAR(20) NOT NULL,
    payload JSONB NOT NULL,
    -- queued -> running -> succeeded | failed
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error TEXT,
    -- Claim bookkeeping so a crashed worker's job can be reclaimed after a timeout.
    locked_at TIMESTAMP,
    locked_by VARCHAR(120),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The worker claims the oldest still-open job; a partial index keeps that cheap.
CREATE INDEX IF NOT EXISTS idx_model_ingest_jobs_open
    ON model_ingest_jobs (created_at)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_model_ingest_jobs_model ON model_ingest_jobs (model_id);
