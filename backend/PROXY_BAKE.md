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
| `blender/render_lod_compare.py` | QA renderer: GLBs side by side at the three planner camera distances, in the PLANNER's lighting and lens. Not part of a bake. |
| `scripts/qa-planner-lod.ts` | **Acceptance test for the LOD** — pulls production proxies, builds candidates, renders them against the proxy and scores edge loss (`npm run qa:lod`). Run it before any backfill. |
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
| `plannerLod*` | The planner LOD tier — see below. **`plannerLodSimplifyError` is the quality knob, not the triangle budget.** |


## The planner LOD (migration 064)

The planner draws a whole **table**; the product page draws **one piece**. Until
this existed both loaded the same proxy, and a real artist showcase measured, in a
browser against live production, 28 models / 85.07 MB / 9,116,141 triangles, stored
as 26,217,059 vertices — 2.88 per triangle.

That last figure was the whole story. An STL carries no vertex normals, so Blender
imports it flat-shaded, and a flat-shaded mesh **cannot share a vertex between two
triangles**. With every edge a seam there is nothing left to collapse, and meshopt
refuses to try: asked for 33% of a real bake it returned 91–95% of the triangles.
`proxyCreaseAngleDeg` is the unlock — shading smooth with creases restores the
shared edges (2.88 → 0.6–1.4 verts/triangle), and `services/proxyBake/lod.ts` then
simplifies the bake's own output into a third GLB: no Blender, no new queue, a
couple of seconds on a mesh already sitting in a temp dir.

**Serving.** `GET /api/models/:id/preview.glb?variant=lod`. The planner asks for it
unconditionally (`plannerMeshUrl` in the frontend's `api/transformers.ts`); the
server falls back to the proxy whenever a model has none, so the tier is a bonus and
never a dependency. Owners get the LOD too, **deliberately** — their full-fidelity
copy (041) is a large part of why an owner's table is the heaviest, and at 2–16 m it
cannot be told from the proxy. Close inspection belongs on the product page, which
asks for no variant and so still serves an owner their full copy. Cache-Control is
`max-age=300`, the same as the other two variants: setting `lod_glb_path` to NULL is
the kill switch, and the cache lifetime is its blast radius.

### The error bound is the quality knob, not the triangle budget

This tier shipped once at `plannerLodTriangleBudget: 50000` with
`plannerLodSimplifyError: 0.01`, was backfilled across the catalogue, and **visibly
destroyed it** — carved wall panels collapsed into lumpy blobs with spikes through
them, roof tiles and window frames gone, whole pieces reading as melted. It was
rolled back the same day (`lod_glb_path` set to NULL) and retuned from renders of
the real catalogue.

meshopt stops at whichever of its two limits it reaches first, so the result is
**max(triangle target, what the error bound permits)**. A triangle target is one
number applied to every model regardless of how much detail it carries, and that is
precisely the failure: at 50k the dense architecture was cut 73–82% while a louvred
shutter was left untouched. An error bound is a *geometric tolerance* — the LOD
surface may not move further than that fraction of the mesh extent — so it allocates
triangles per model on its own. On a ~250 mm terrain piece the shipped `0.0002` is
about **0.05 mm, roughly one resin print layer**.

Measured on 32 real catalogue parts (a 28-piece showcase table plus a second
artist's set), rendered against their own proxies in the planner's own lighting and
lens, scored as the share of the proxy's edge energy the LOD fails to reproduce
inside the silhouette:

| `plannerLodSimplifyError` | edge loss at 0.3 m | verdict |
|---|---|---|
| 0.01 (the shipped one) | 19–33% | melted; unusable |
| 0.0005 | 9–17% | inconsistent — fine on some parts, visibly soft on others |
| **0.0002** | **4.5–10.4%** (mean 7.5%) | indistinguishable from the proxy by eye |

At 2 m — the distance a table is actually laid out from — 0.0002 lands at 1.1–4.5%.
About 3.6 points of the 0.3 m figure is the normal-map bound
(`plannerLodNormalMapSize` 1024 against a 2048 bake), not geometry at all: the
no-decimation control measures 0.1% with the map left alone.

With 0.0002 the budget almost never binds, so `plannerLodTriangleBudget` is now best
read as a **floor** — what the LOD would collapse to if the geometry were smooth
enough to allow it. It is not a ceiling and cannot be used as one.

**Whole-table result** on that 28-part showcase, every part getting an LOD:

| | proxy (crease-shaded) | LOD | |
|---|---|---|---|
| Download | 71.27 MB | **31.04 MB** | −56.5% |
| Triangles | 9,116,141 | **6,654,324** | −27.0% |

Note the shape of that win: **the bytes, not the triangles.** A no-decimation
control — same pipeline, 1% of triangles removed — is already 45–48% smaller,
because dropping `TANGENT` and re-quantising through Draco does that much on its
own. The triangle reduction is real but modest, because this asset class genuinely
cannot give up more without looking wrong.

### Checking it — `npm run qa:lod`

**The acceptance test is looking at the actual models, in the actual product,
before the backfill.** The first attempt validated file sizes and triangle counts on
the real catalogue but validated APPEARANCE only on four substitute models from
another artist, none of which exercised the combination that broke (dense
architectural detail that simplifies readily). A `--limit 1` smoke test then
confirmed the pipeline RAN without anyone checking that the output LOOKED right.

```
npm run qa:lod -- --set "South East Asian village"
npm run qa:lod -- --set "Gothic church" --error 0.0002,0.01 --max-edge-loss 10
```

It downloads the **production** proxies (`?variant=preview`, no auth needed), builds
candidates with the shipped `buildPlannerLod`, renders each against its proxy
through `blender/render_lod_compare.py` at the three planner camera distances in the
planner's own lighting and 50° lens, and reports **edge loss** worst-first, exiting
non-zero over the threshold. Edge loss rather than a pixel difference because a flat
pixel metric is what missed the regression — the previous session measured "under
0.01% of pixels differ at 2 m", and a melted roof covers the same pixels at the same
average brightness. The number ranks candidates; it does not approve them. Open the
images.

`npm run measure:lod -- <proxy_raw.glb>` is still the numbers-only tool (triangles,
stored verts, unique positions, texture bytes, boundary loops, now sweeping
`LOD_ERRORS` as well as `LOD_BUDGETS`). It does not render, and numbers alone have
already passed a config once that melted the catalogue.

### Anti-theft

`plannerLodLockBorder` (default on) pins every open boundary through the collapse.
Those boundaries *are* the non-printability: the embossed logo through-holes, the
deleted base faces, the stripped interior. With it off the LOD is only ~5% smaller
and the monogram cut-outs visibly deform into lumpy blobs — verified by render, and
on an organic source it lost 55% of its boundary loops (751 → 335). **This is a
security setting, not a quality knob.** Leave it on. Across all 32 parts at the
current config, boundary loops survive essentially intact (e.g. 1,247 of 1,260).

### Backfilling is a RE-BAKE, not a re-process

Existing proxies are flat-shaded and cannot be derived from, and a backfill job
queues behind live artist uploads, so batch it. After changing any `plannerLod*`
default, **re-bake one model you can recognise and go and look at it first**:

```
railway run npm run backfill:planner-lod -- --dry-run
railway run npm run backfill:planner-lod -- --model <modelId> --force
railway run npm run backfill:planner-lod -- --limit 25 --force
```

`--force` matters: meshes whose `proxy_report` already records a `plannerLod`
verdict are otherwise skipped, so a config change would be a no-op without it.

### Kill switch

The route falls back to the proxy when the column is NULL, which is the pre-LOD
behaviour — no deploy, and with `max-age=300` it is live within five minutes:

```
railway run npm run db:query -- "UPDATE models SET lod_glb_path = NULL"
railway run npm run db:query -- "UPDATE model_parts SET lod_glb_path = NULL"
```

Verify from outside with no database access at all: a part whose LOD is off answers
`?variant=lod` with the header `X-Preview-Variant: preview`.

### The knobs

| Key | Meaning |
|---|---|
| `plannerLodEnabled` | Build the LOD at all. Useless with `proxyCreaseAngleDeg: 0`; the bake report says so rather than silently shipping a "LOD" as heavy as its input. |
| `plannerLodSimplifyError` | **The quality knob.** meshopt error bound as a fraction of mesh extent (0.0002 ≈ one print layer on a terrain piece). Adapts per model, which a triangle count cannot. |
| `plannerLodTriangleBudget` | A floor the collapse aims for, reached only when the geometry is smooth enough that the error bound allows it. Not a ceiling. |
| `plannerLodLockBorder` | Keep open boundaries (= the anti-theft cuts) intact. **Security setting, not a quality one.** |
| `plannerLodMinReduction` | Minimum **byte** saving before the LOD is worth a second file — see below. |
| `plannerLodNormalMapSize` | Upper bound on the LOD's normal map (default 1024; never enlarges). Worth 3.4 MB across a 32-part catalogue for about 1.3 points of edge loss. |

**`plannerLodMinReduction` counts bytes.** It used to count triangles, which is the
wrong quantity for a tier that exists to make a page download less: once the
collapse is bounded by a geometric error, a detailed mesh legitimately keeps most of
its triangles (16–29% cut on the real catalogue) while still producing a file 55%
smaller. A triangle gate at 0.25 threw away roughly a third of the LODs, including
the heaviest parts in the table and one whose weight was in its normal map rather
than its geometry. `bake.ts` passes the finished proxy's size in so the comparison
is bytes against bytes; without it the check falls back to triangles. The triangle
reduction is still reported as `proxy_report.plannerLod.trianglesCutPct`, where a
near-zero value is the `proxyCreaseAngleDeg: 0` signature.

### A known ceiling, diagnosed

On a many-shell mesh the collapse stalls well above any budget, and the error bound
is not what binds there: dropping `TEXCOORD_0` alone stopped at 148k, `NORMAL` alone
at 152k, **both** reached 64k. It is the *union* of UV-island seams and crease seams
that fragments such a mesh (thousands of separate roof-tile shells) into regions too
small to collapse — and neither can be given up, because the UVs carry the baked
normal map and the creases are what made welding possible. Getting past it would
take a second unwrap and bake in Blender at the LOD's resolution (about +25 s per
bake, in the most failure-prone part of the pipeline); it is not built. At the
current error bound this ceiling is mostly moot — the error stops the collapse first
on every part measured.

### TANGENT

The LOD **drops `TANGENT`**, which the proxy keeps: it is 15–38% of the finished file
through this pipeline, and three.js derives tangents from screen-space derivatives
without it. Checked in a real browser through the planner's own three.js and
lighting, closer than its nearest camera preset, including a model that previously
carried tangents — indistinguishable, and re-confirmed by the no-decimation control
above at 0.1% edge loss. This is where most of the tier's download win comes from.
