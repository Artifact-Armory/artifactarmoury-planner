# Preview Proxy Bake Pipeline

Turns a high-poly source mesh into a **decimated proxy** whose surface detail is
baked into **normal + AO maps**, exported as a Draco-compressed GLB preview. A
normal map is a lighting trick — it can't be printed — so a ripped proxy is a
smooth low-poly blob wearing a detailed costume. **Print-resolution geometry never
reaches the browser.** The file buyers download (STL / original) is untouched.

This runs in a **separate worker service** (its own Blender Docker image), driven
by a database job queue. The web API only *enqueues* jobs; the worker does the
minutes-long CPU bake so the API stays responsive.

## Pieces

| File | What it is |
|---|---|
| `blender/bake_proxy.py` | Headless Blender script: import → decimate → UV unwrap → Cycles bake (normal/AO) → poison pills → GLB + validation renders + `report.json`. |
| `src/services/proxyBake/config.ts` + `config/proxyBake.defaults.json` | Config schema, defaults, and per-model override merge. |
| `src/services/proxyBake/bake.ts` | TS wrapper: R2 download, run Blender (hard timeout), `gltf-transform` post-process, comparison PNG, R2 upload. |
| `src/services/proxyBake/queue.ts` | DB queue: `enqueueBakeJob`, `claimNextJob` (`FOR UPDATE SKIP LOCKED`), `completeJob`/`failJob`, model-status roll-up. |
| `src/worker/proxyBakeWorker.ts` | The worker loop (a standalone entrypoint). |
| `Dockerfile.worker` | Pinned Blender LTS + Node image for the worker service. |
| `db/migrations/037_proxy_bake_jobs.sql` | The `proxy_bake_jobs` queue + `proxy_bake_config`/`proxy_report` columns. |
| `scripts/test-proxy-bake.ts` | End-to-end test against a generated high-poly mesh (`npm run test:proxybake`). |

## The on/off switch

Everything is gated by one env var: **`PROXY_BAKE_ENABLED`**.

- **Unset / `false` (default):** nothing changes. Uploads generate the preview
  in-process with the existing pure-Node decimator, exactly as before. Safe to
  deploy the code with the switch off.
- **`true`:** on the **web service**, uploads stop generating the preview inline
  and instead enqueue a bake job (the model stays `processing`). The **worker
  service** picks the job up, bakes, writes `glb_file_path`, and flips the model to
  `ready`. Only **new uploads / version updates** are affected — existing models
  keep their current previews.

Turn it on **only after** the worker service is live (below), or uploads will sit
in `processing` with nothing to bake them.

## Run locally (optional — needs Blender)

1. Install Blender **4.2 LTS** and either put it on `PATH` or set
   `BLENDER_PATH=/full/path/to/blender`.
2. Run the end-to-end test (generates its own high-poly mesh, no R2/DB needed):
   ```
   cd backend
   npm run test:proxybake
   ```
   Without Blender it prints `SKIP` and exits 0.
3. To run the actual worker loop against your dev DB + R2:
   ```
   PROXY_BAKE_ENABLED=true npm run worker:dev
   ```

## Run in Docker (what Railway does)

```
cd backend
docker build -f Dockerfile.worker -t aa-bake-worker .
docker run --rm \
  -e DATABASE_URL=... -e R2_ACCOUNT_ID=... -e R2_ACCESS_KEY_ID=... \
  -e R2_SECRET_ACCESS_KEY=... -e R2_BUCKET=... -e R2_PUBLIC_BASE_URL=... \
  -e PROXY_BAKE_ENABLED=true \
  aa-bake-worker
```

## Per-model overrides (thin geometry)

Thin geometry (blades, gaps between parts) is where bakes fail — the fix is a
per-model override, not a global change. Overrides are stored on
`models.proxy_bake_config` (JSONB) and merged over the defaults. Any subset of the
keys in `config/proxyBake.defaults.json` is valid, e.g.:

```sql
-- Give one model a bigger cage + ray distance and a tighter triangle budget.
UPDATE models
   SET proxy_bake_config = '{"bakeExtrusionPct": 1.5, "maxRayDistancePct": 3.0}'::jsonb
 WHERE id = '<model-id>';
```

Then re-bake by enqueuing a fresh job (a version re-upload does this automatically),
or insert a job directly:

```sql
INSERT INTO proxy_bake_jobs (model_id, source_key, source_format, config)
SELECT id, stl_file_path, source_format, proxy_bake_config
  FROM models WHERE id = '<model-id>';
```

The bake writes a **`report.json`** next to the GLB in R2
(`previews/<modelId>/report.json`) and onto `models.proxy_report`: source/proxy
triangle counts, remesh strategy, texture resolutions, final size, stage timings,
boundary-edge count, and warnings (loose parts joined, unit-sanity flag, fallback
remesh used, size near-miss). This feeds a future admin/artist review UI.

## Tuning knobs (defaults in `config/proxyBake.defaults.json`)

| Key | Meaning |
|---|---|
| `triangleBudget` | Target proxy triangle count. |
| `normalMapRes` / `aoMapRes` / `baseColorRes` | Baked texture resolutions. Normal stays PNG; AO/baseColor become WebP q80. |
| `aoSamples` | Cycles samples for the AO bake. |
| `bakeExtrusionPct` / `maxRayDistancePct` | Cage + ray distance as a % of the bbox diagonal — **the critical quality knobs** for thin parts. |
| `remeshStrategy` | `decimate` (default) or `voxel`; the worker auto-falls back to voxel on pathological topology. |
| `baseFaceZNormalThreshold` / `baseFaceHeightMm` | Which downward base faces the poison pill deletes. |
| `sourceTriangleCap` | Hard cap; sources above it fail cleanly. |
| `bakeTimeoutMinutes` | Hard Blender timeout; the worker kills + fails the job. |
| `targetMaxFileMb` | Soft size target; over it is reported as a warning. |
| `planner*CameraDistanceM` | The three validation-render distances (min = the planner's real 0.3 m min zoom). |
