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
| `src/services/proxyBake/lod.ts` | Derives the **planner LOD** from the same bake output (`gltf-transform` weld + simplify). See below. |
| `src/services/proxyBake/queue.ts` | DB queue: `enqueueBakeJob`, `claimNextJob` (`FOR UPDATE SKIP LOCKED`), `completeJob`/`failJob`, model-status roll-up. |
| `src/worker/proxyBakeWorker.ts` | The worker loop (a standalone entrypoint). |
| `Dockerfile.worker` | Pinned Blender LTS + Node image for the worker service. |
| `db/migrations/037_proxy_bake_jobs.sql` | The `proxy_bake_jobs` queue + `proxy_bake_config`/`proxy_report` columns. |
| `db/migrations/064_planner_lod.sql` | `lod_glb_path` on `models` / `model_parts`. |
| `scripts/measure-planner-lod.ts` | Measures a raw bake's proxy vs LOD candidates — triangles, stored verts, unique positions, texture bytes, boundary loops (`npm run measure:lod -- <proxy_raw.glb>`). |
| `scripts/backfill-planner-lod.ts` | Queues catalogue **re-bakes** so existing models get an LOD (`npm run backfill:planner-lod`). |
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
| `triangleBudget` | **Floor** on the proxy triangle target (sources at/under it skip decimation). The actual target for anything denser is adaptive — see below. |
| `triangleRetainRatio` | Fraction of source triangles the adaptive target keeps for sources above the floor (default 0.22 = ~22%, raised 2026-08-18 from 0.09 — models were too aggressively decimated). Fixes a flat budget hitting detail-dense sources hardest (a 2.5M-tri model was retaining ~4.8% under the old fixed 120k while a simple 90k-tri tile kept 100%). |
| `triangleBudgetCeiling` | Hard cap on the adaptive target (default 300000 — deliberately *not* scaled proportionally with the ratio bump above; see `compute_adaptive_budget`'s docstring in `bake_proxy.py`), protecting the 20-min timeout and the single-worker queue's throughput on the very densest sources. |
| `normalMapRes` / `aoMapRes` / `baseColorRes` | Baked texture resolutions. Normal stays PNG; AO/baseColor become WebP q80. |
| `aoSamples` | Cycles samples for the AO bake. |
| `bakeExtrusionPct` / `maxRayDistancePct` | Cage + ray distance as a % of the bbox diagonal — **the critical quality knobs** for thin parts. |
| `remeshStrategy` | `decimate` (default) or `voxel`; the worker auto-falls back to voxel on pathological topology. |
| `baseFaceZNormalThreshold` / `baseFaceHeightMm` | Which downward base faces the poison pill deletes. |
| `sourceTriangleCap` | Hard cap; sources above it fail cleanly. |
| `bakeTimeoutMinutes` | Hard Blender timeout; the worker kills + fails the job. |
| `targetMaxFileMb` | Soft size target; over it is reported as a warning. |
| `planner*CameraDistanceM` | The three validation-render distances (min = the planner's real 0.3 m min zoom). |
| `proxyCreaseAngleDeg` | Crease-angle shading on the proxy (default **45**). Edges sharper than this stay hard; everything else shades smooth. See below — this is also what makes the planner LOD possible at all. |
| `plannerLod*` | The planner LOD tier — see below. |

## The planner LOD (migration 064)

The planner draws a whole **table**; the product page draws **one piece**. Until
this existed both loaded the same proxy, and a real artist showcase measured, in a
browser against live production:

| | 28 models |
|---|---|
| Download | **85.07 MB** (mean 3.04 MB, range 1.96–3.38) |
| Triangles | **9,116,141** (mean 325,576) |
| Stored vertices | 26,217,059 — **2.88 per triangle** |

That last row is the whole story. An STL carries no vertex normals, so Blender
imports it flat-shaded, and a flat-shaded mesh **cannot share a vertex between two
triangles** — each one needs its own copy carrying the face normal. With every edge
a seam there is nothing left to collapse, and meshopt refuses to try: asked for 33%
of a real bake it returned 91–95% of the triangles. That is why previous attempts
to decimate ran into `proxyDecimationEnabled`'s wall.

`proxyCreaseAngleDeg` is the unlock. Shading smooth with creases restores shared
edges (2.88 → 0.6–1.4 verts/triangle on real bakes), and `services/proxyBake/lod.ts`
then simplifies the bake's own output into a third GLB — no Blender, no new queue,
a couple of seconds on a mesh already in the bake's temp dir.

**Serving.** `GET /api/models/:id/preview.glb?variant=lod`. The planner asks for it
unconditionally (`plannerMeshUrl` in the frontend's `api/transformers.ts`); the
server falls back to the proxy whenever a model has no LOD. Owners get the LOD too,
**deliberately** — their full-fidelity copy (041) is a large part of why an owner's
table is the heaviest, and at 2–16 m it cannot be told from the proxy. Close
inspection belongs on the product page, which asks for no variant and so still
serves an owner their full copy.

**Measured on four real bakes**, shipped config (crease 45, 50k budget, lockBorder,
normal map capped at 1024):

| source | proxy | LOD | file | triangles |
|---|---|---|---|---|
| wall panel (1.2M-tri src) | 196,114 tris / 1,506 KB | 56,390 / 512 KB | **−66%** | −71% |
| dense architectural | 290,452 / 2,379 KB | 173,236 / 1,080 KB | **−55%** | −40% |
| organic sandbag stack | 251,377 / 2,542 KB | 49,999 / 952 KB | **−63%** | −80% |
| louvred shutter | 14,488 / 298 KB | *no LOD — already under budget* | — | — |

**The dense architectural case is the honest ceiling.** It stops at 173k however
low the budget goes, and the error bound is not what binds — even `error: 1.0`
(100% of the mesh extent) lands in the same place. The cause is measured, not
guessed: dropping `TEXCOORD_0` alone still stopped at 148k, dropping `NORMAL` alone
at 152k, but dropping **both** reached 64k. It is the *union* of the UV-island
seams and the crease seams that fragments that mesh (thousands of separate roof-tile
shells) into regions too small to collapse — and neither can be given up, because
the UVs carry the baked normal map and the creases are what made welding possible.
Getting past it would take a second unwrap+bake in Blender at the LOD's resolution
(about +25s per bake, in the most failure-prone part of the pipeline); it is not
built.

**Anti-theft.** `plannerLodLockBorder` (default on) pins every open boundary through
the collapse. Those boundaries *are* the non-printability: the embossed logo
through-holes, the deleted base faces, the stripped interior. With it off the LOD is
only ~5% smaller and the monogram cut-outs visibly deform into lumpy blobs — verified
by render, and on the organic source it lost 55% of its boundary loops (751 → 335).
Leave it on.

**Backfilling is a RE-BAKE, not a re-process** — see the header comment in
`scripts/backfill-planner-lod.ts`. Existing proxies are flat-shaded and cannot be
derived from, and a backfill job queues behind live artist uploads, so batch it:

```
railway run npm run backfill:planner-lod -- --dry-run
railway run npm run backfill:planner-lod -- --limit 25
```

| Key | Meaning |
|---|---|
| `plannerLodEnabled` | Build the LOD at all. Useless with `proxyCreaseAngleDeg: 0`; the bake report says so rather than shipping a "LOD" as heavy as its input. |
| `plannerLodTriangleBudget` | Target triangles (default 50000) — picked by rendering candidates at the three planner camera distances, not by rounding. At 2 m, under 0.01% of pixels differ from the proxy by more than 8/255. |
| `plannerLodSimplifyError` | meshopt error bound. Not usually what binds — see above. |
| `plannerLodLockBorder` | Keep open boundaries (= the anti-theft cuts) intact. **Anti-theft setting, not a quality one.** |
| `plannerLodMinReduction` | Below this cut, skip the LOD rather than ship a near-duplicate file. |
| `plannerLodNormalMapSize` | Upper bound on the LOD's normal map (default 1024; never enlarges). Once geometry collapses the map *is* the file — 1,446 KB of a 1,878 KB LOD on the organic source. |

The LOD also **drops `TANGENT`**, which the proxy keeps: it is 15–38% of the
finished file through this pipeline, and three.js derives tangents from screen-space
derivatives without it. Checked in a real browser through the planner's own three.js
and lighting, closer than its nearest camera preset, including a model that
previously carried tangents — indistinguishable.
