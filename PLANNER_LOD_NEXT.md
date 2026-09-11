# Planner LOD — retune the budget, work prompt

Read `CLAUDE.md` first, then the "Planner LOD + crease shading" section in it and
`backend/PROXY_BAKE.md`. This continues work from a previous session. The findings
below are measured, not assumed — don't re-derive them, verify only if something
looks wrong.

## Situation

A planner-specific LOD tier shipped and was backfilled across the whole catalogue.
**It visibly destroyed the models** and has been rolled back. The mechanism is
sound and the numbers looked healthy; the triangle budget is simply far too
aggressive for this artist's asset class. Your job is to pick a budget from
rendered evidence on *these* models and re-enable it.

### What the damage looked like

On "South East Asian village" in the planner: carved wall panels collapsed into
smooth lumpy blobs with sharp spikes pushing through, roof tiles and window
frames largely gone, the whole piece reading as melted rather than detailed.
Characteristic of a simplifier collapsing many thin, separate shells.

### Why it was not caught

The previous session QA'd four models from `frontend/public/assets/pre converted/kieran_s/terrain-kieran_s/`
and treated that as sufficient. It wasn't. Measured cuts at the shipped 50,000
budget:

| model | proxy tris | LOD tris | cut | rendered? |
|---|---|---|---|---|
| wall panel (`bottom .stl`) | 196,114 | 56,390 | 71% | yes — looked fine |
| organic (`sandbags.stl`) | 251,377 | 49,999 | 80% | yes — but a smooth blob hides damage |
| dense architectural (`top.stl`) | 290,452 | 173,236 | 40% | **no LOD render** — it *resisted* simplification |
| thin shell (`shutters.stl`) | 14,488 | — | under budget, skipped | n/a |

versus production, "South East Asian village" parts:

| part | proxy tris | LOD tris | cut |
|---|---|---|---|
| mid | 353,212 | 84,084 | 76% |
| top | 314,977 | 58,159 | 82% |
| bottom | 344,937 | 91,935 | 73% |

The untested combination is **dense architectural detail that simplifies readily**.
The one test model closest to that class couldn't reach the budget, so the
aggressive path was never exercised on detailed architecture, and its LOD was
never rendered. Numbers were checked for the real asset class; renders were not.

## State right now

- All code is committed and pushed on `main` (`86d2ba6`), and deployed.
- **The LOD is disabled in production by data, not code**: `models.lod_glb_path`
  and `model_parts.lod_glb_path` were set to NULL, so `preview.glb?variant=lod`
  falls back to the proxy. **Verify this is still true before anything else** —
  if it wasn't run, run it (see "Kill switch" below).
- The whole catalogue (42 meshes: 5 models + 37 set parts) has been **re-baked**
  with `proxyCreaseAngleDeg: 45`. Those crease-shaded proxies are what the planner
  and product pages are serving now, and they are **fine** — crease shading changes
  shading only, never geometry (verified: identical triangle counts, emboss hole
  counts and placements, deleted base faces and warnings, on every test bake).
  Do not roll that back; the LOD depends on it.
- Uncommitted, trivial, unrelated to the bug: `backend/scripts/backfill-planner-lod.ts`
  and `backend/scripts/backfill-full-glb.ts` have `railway run` added to some
  printed hint lines. Commit or ignore.

### Kill switch (instant, no deploy)

```
railway run npm run db:query -- "UPDATE models SET lod_glb_path = NULL"
railway run npm run db:query -- "UPDATE model_parts SET lod_glb_path = NULL"
```

Note the LOD response carries `Cache-Control: private, max-age=3600`, so a browser
that already loaded one may serve it for up to an hour — Ctrl+F5 to bypass.
**Consider whether an hour is the right lifetime for something this easy to get
wrong;** 300s (what the other variants use) would have made this rollback instant.

## The work

### 1. Pick the budget from renders of THESE models

Do not guess, and do not use the `kieran_s` fixtures as the primary evidence —
that is the mistake being corrected.

Get the real meshes. The production proxy is downloadable without auth for a
published model: `https://api.artifactarmoury.com/api/models/parts/<partId>/preview.glb?variant=preview`
(part ids via `GET /api/models/sets`). That is Draco-compressed and post-processed
rather than the raw bake output, but it decodes fine and is the correct input for
choosing a budget, since it is exactly what the LOD is derived from in shape.

Generate candidates across a range — 50k (the broken one), 100k, 150k, 200k, and
"no LOD" — and also vary `plannerLodSimplifyError` (shipped 0.01; 0.001 is the
owner tier's value and may matter more than the budget here). Render each against
the proxy at the three planner camera distances (`plannerMinCameraDistanceM` 0.3,
`plannerTypicalCameraDistanceM` 2.0, `plannerFullTableCameraDistanceM` 16.0) and
**look at the images**, at a size where detail actually resolves. A whole-model
thumbnail will not show this failure; the previous session's aggregate pixel-diff
metrics reported "under 0.01% of pixels differ at 2 m" on models that were fine
and would not have caught this either.

`backend/scripts/measure-planner-lod.ts` (`npm run measure:lod -- <raw.glb>`)
already reports triangles, stored vertices, unique positions, texture bytes and
boundary loops. It does not render — add that or drive Blender separately.

Accept that the honest answer may be "this asset class needs a much higher budget
than others", i.e. a per-model or per-class override rather than one global number.
`models.proxy_bake_config` (JSONB) already supports per-model overrides and
`loadBakeConfig` merges them, so a per-model budget needs no new schema.

### 2. Re-enable and re-verify

`plannerLodTriangleBudget` lives in `backend/config/proxyBake.defaults.json`
(env override `PROXY_BAKE_LOD_TRIANGLE_BUDGET`). Changing it requires a **re-bake**
to take effect — `npm run backfill:planner-lod -- --force` (the `--force` matters:
without it, meshes whose `proxy_report` already records a `plannerLod` verdict are
skipped).

Re-enable on **one** model first, look at it in the live planner, and only then do
the rest. The previous session's `--limit 1` test verified that the pipeline *ran*,
not that the result *looked right* — that gap is the whole incident.

### 3. Then re-measure the win honestly

Before, measured in-browser against live production (28 planner assets on
`/planner/view/0e30e3c2-22f9-4286-b327-80c47092fa34`): **85.07 MB, 9,116,141
triangles, 26,217,059 stored vertices (2.88 per triangle)**. Note the stored-vertex
figure will already have improved from the crease re-bake alone — re-measure the
current state as the new baseline before claiming any LOD win.

## Shipped config (all in `backend/config/proxyBake.defaults.json`)

```
proxyCreaseAngleDeg        45      (was 0; this is what makes simplification possible at all)
plannerLodEnabled          true
plannerLodTriangleBudget   50000   <-- THE PROBLEM
plannerLodSimplifyError    0.01
plannerLodLockBorder       true    <-- anti-theft, see below; do not turn off
plannerLodMinReduction     0.25
plannerLodNormalMapSize    1024
```

## Things that are settled — don't relitigate

- **`plannerLodLockBorder` must stay on.** A baked proxy's open boundaries *are*
  its non-printability (emboss through-holes, deleted base faces, stripped
  interior). With it off the LOD is only ~5% smaller and the monogram cut-outs
  visibly deform into blobs; on an organic source it lost 55% of its boundary loops
  (751 → 335). This is a security setting, not a quality knob. `CreatorProtection.tsx`
  promises the preview is unprintable.
- **The LOD drops `TANGENT`; the proxy keeps it.** Verified in a real browser
  through the planner's own three.js and lighting, closer than its nearest camera
  preset, including a model that previously carried tangents — indistinguishable,
  and it is 15–38% of the file.
- **Crease shading is not the cause of the damage** and should not be reverted.
- **Owners get the LOD too, by design** — their full-fidelity copy (migration 041)
  is much of why an owner's table is heaviest. Reconsider only if the LOD ends up
  close to the proxy in weight, at which point the tier stops earning its keep.
- **Why simplification was impossible before:** STL has no vertex normals, so
  Blender imports flat-shaded and no two triangles share a vertex. meshopt asked
  for 33% of a flat bake returned 91–95% of the triangles. Crease shading restores
  shared edges. That is why `proxyDecimationEnabled`'s long history of destructive
  results never had a good option.
- **A known ceiling, diagnosed:** on a many-shell mesh the LOD can stall well above
  budget, and the error bound is *not* what binds (even `error: 1.0` lands
  identically). Dropping `TEXCOORD_0` alone stopped at 148k, `NORMAL` alone at 152k,
  **both** reached 64k — it is the union of UV-island and crease seams. Neither can
  be given up (UVs carry the baked normal map; creases are what made welding work).

## Working rules

- Typecheck both projects (`npx tsc --noEmit` in `backend` and `frontend`) and run
  `npm run build` in `frontend` before declaring done. `tsconfig.json` only includes
  `src/**`, so typecheck `scripts/*.ts` explicitly.
- The user runs all git and terminal commands themselves. **Print exact copy-paste
  commands.** Their terminal is **Windows cmd.exe**, not Git Bash — no `/c/Users/...`
  POSIX paths, and omit `cd` when their prompt already shows the right directory.
- Local dev is `DB_MOCK=true` with no local Postgres, so anything touching the
  database cannot be exercised locally — say so plainly rather than implying it was
  tested. Production SQL goes through `railway run npm run db:query -- "<SQL>"`
  **linked to the Postgres service** (the backend service only has the private
  `postgres.railway.internal` URL, which does not resolve off-platform).
- Don't touch `planner-lab/` — it has unrelated uncommitted work.
- Blender locally is 4.3 at `/c/Program Files/Blender Foundation/Blender 4.3/blender.exe`;
  production is 4.2.3. Keep API use compatible with both.
- There are 5 bake worker replicas. A re-bake of the whole catalogue is ~6 minutes.
  During a deploy the worker count transiently doubles as old replicas drain.

## The lesson worth carrying

The previous session measured a great deal and still shipped a visible regression,
because it validated **file sizes and triangle counts** on the real catalogue but
validated **appearance** only on substitute models. For anything that alters what a
buyer sees, the acceptance test is looking at the actual models in the actual
product — before the backfill, not after.
