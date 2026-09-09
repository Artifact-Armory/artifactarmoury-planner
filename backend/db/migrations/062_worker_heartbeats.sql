-- 062_worker_heartbeats.sql
--
-- Makes "the worker stopped" observable.
--
-- MODEL_INGEST_WORKER_ENABLED=true is live, and that queue deliberately has NO
-- in-process fallback (see 057) — the whole point of the flag is that ingest
-- must never run in the API server again. The consequence is that if the worker
-- service dies, every upload sits at processing_status='processing' forever and
-- NOTHING anywhere says so: the API server is healthy, /health passes, the
-- artist just sees a listing that never gets a preview. On the day several
-- artists upload at once that is the likeliest way this fails.
--
-- Per-job `locked_at` heartbeats already exist (proxy_bake_jobs / full_glb_jobs /
-- model_ingest_jobs) but they only prove liveness WHILE a job is running. They
-- cannot distinguish "worker healthy and idle" from "worker dead and the queue
-- happens to be empty" — which is exactly the window in which you want to find
-- out, i.e. BEFORE the uploads arrive rather than after they have piled up.
-- Hence a worker-level heartbeat that ticks every poll cycle regardless of
-- whether there was any work to do.

CREATE TABLE IF NOT EXISTS worker_heartbeats (
    -- "<hostname>:<pid>", matching the WORKER_ID the queues already lock with,
    -- so a heartbeat row can be tied to the job rows that worker holds.
    worker_id VARCHAR(120) PRIMARY KEY,
    -- Room for future worker types; today every row is 'bake' (the one worker
    -- service, which drains all three queues).
    kind VARCHAR(40) NOT NULL DEFAULT 'bake',
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Cheap "is it actually doing anything, or just spinning?" signal.
    jobs_completed BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_seen ON worker_heartbeats (last_seen_at DESC);

-- One row per distinct alert condition, so the alarm can fire ONCE per incident
-- instead of every scheduler tick. `resolved_at IS NULL` means the incident is
-- currently open; the notifier re-sends only after ALERT_REPEAT_MS and writes a
-- single recovery notice when the condition clears.
CREATE TABLE IF NOT EXISTS queue_alert_state (
    alert_key VARCHAR(80) PRIMARY KEY,
    opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_notified_at TIMESTAMP,
    resolved_at TIMESTAMP,
    detail TEXT
);

COMMENT ON TABLE worker_heartbeats IS
  'Liveness beacon written by worker/proxyBakeWorker.ts every poll cycle. Absence of a recent row is what the queue-health alarm treats as "the worker is down".';
COMMENT ON TABLE queue_alert_state IS
  'Dedupe/latch state for the queue-health alarm so an ongoing incident emails once, not every tick.';
