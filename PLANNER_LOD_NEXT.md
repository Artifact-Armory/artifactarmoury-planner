# Planner LOD — retuned, ready to re-enable

The retune asked for in the previous version of this file is **done in code**. What
is left is the part that needs production access: deploy, re-bake one model, look at
it, then do the rest. Nothing in production has changed yet — the tier is still
disabled by data.

Read `CLAUDE.md`'s "Planner LOD + crease shading" section and `backend/PROXY_BAKE.md`
for the full picture. This file is the runbook for finishing it.

## What was wrong, and what changed

The tier shipped with a fixed **50,000-triangle budget** and a loose **0.01** error
bound, and that combination destroyed the catalogue. The budget was the wrong kind
of control: meshopt stops at whichever of its two limits it reaches first, so a
triangle target is one number applied to every model regardless of how much detail
it carries. At 50k the dense architecture was cut 73–82% while a louvred shutter was
left untouched.

The fix is to let the **error bound** lead. It is a geometric tolerance — the LOD
surface may not move further than that fraction of the mesh extent — so it allocates
triangles per model on its own.

| | was | now |
|---|---|---|
| `plannerLodSimplifyError` | 0.01 | **0.0002** (≈0.05 mm, one resin print layer, on a 250 mm piece) |
| `plannerLodTriangleBudget` | 50000, and binding | 50000, now a **floor** the collapse rarely reaches |
| `plannerLodMinReduction` | 0.25 of **triangles** | 0.25 of **bytes** |
| LOD `Cache-Control` | `max-age=3600` | `max-age=300` |

Plus: the "already under the triangle budget, skip" bail is gone (it was refusing an
LOD to the single heaviest file in the table, whose weight was in its normal map),
`backfill-planner-lod.ts` takes `--model <id>`, and there is a new acceptance test.

## The evidence

Measured on **32 real production parts** — the whole 28-part "South East Asian
village" showcase table plus the Gothic church — pulled from the live API, rendered
against their own proxies at the planner's camera distances in the planner's own
lighting and 50° lens. Scored as *edge loss*: the share of the proxy's Sobel edge
energy the LOD fails to reproduce inside the model's silhouette. A flat pixel
difference is the metric that missed the original regression, because a melted roof
covers the same pixels at the same average brightness.

| `plannerLodSimplifyError` | edge loss at 0.3 m | verdict |
|---|---|---|
| 0.01 (shipped, broken) | 19–33% | melted; unusable |
| 0.0005 | 9–17% | inconsistent — fine on some parts, visibly soft on others |
| **0.0002** | **4.5–10.4%**, mean 7.5% | indistinguishable from the proxy by eye |

At 2 m, 0.0002 lands at 1.1–4.5%. About 3.6 points of the 0.3 m number is the 1024
normal-map bound rather than geometry — a no-decimation control measures 0.1%.

**Whole showcase table, every part getting an LOD: 71.27 MB → 31.04 MB (−56.5%) and
9,116,141 → 6,654,324 triangles (−27.0%).**

Note the shape of that: **the win is bytes, not triangles.** A control that removes
1% of triangles is already 45–48% smaller, purely from dropping `TANGENT` and
re-quantising through Draco. This asset class cannot give up much geometry without
looking wrong, and it does not have to.

Two things worth carrying:
- The Gothic church was hit as hard as the village (18.6–23.8% edge loss at the old
  config), so the original regression was **catalogue-wide**, not one artist's set.
- The crease re-bake's own win is now measured rather than projected: the showcase
  table went 85.07 MB → 71.27 MB and 26,217,059 → 8,017,987 stored vertices, with the
  triangle count **identical to the digit** (9,116,141 both times) — which is the
  cleanest confirmation available that crease shading changes shading, never geometry.

## Current production state

- `lod_glb_path` is NULL on both tables, so `?variant=lod` falls back to the proxy.
  **Verified this session from outside, without database access:** the LOD and
  preview variants return byte-identical responses and the header
  `X-Preview-Variant: preview`. That check is worth repeating any time you need to
  know whether the tier is live.
- All 42 meshes carry crease-shaded proxies. That stays.
- The config change is **committed code, not deployed**, and takes effect only
  through a re-bake.

## Finishing it

Everything below needs your production access. Terminal is Windows `cmd.exe`.

**1. Deploy** the backend and worker (the worker image carries
`config/proxyBake.defaults.json`). To try it without waiting for a deploy, set
`PROXY_BAKE_LOD_SIMPLIFY_ERROR=0.0002` on the worker service instead — the env
override exists for exactly this.

**2. Re-bake ONE model you can recognise.** The SE Asian village is the model that
broke and the one all the evidence above is about:

```
railway run npm run backfill:planner-lod -- --model 0385633e-ef61-4843-b6d8-11518ce17028 --force --dry-run
railway run npm run backfill:planner-lod -- --model 0385633e-ef61-4843-b6d8-11518ce17028 --force
```

That is 28 meshes, roughly 4 minutes across 5 workers. Artist uploads queue behind
it.

**3. LOOK AT IT.** Not at the job status — at the model:

```
https://artifactarmoury.com/planner/view/0e30e3c2-22f9-4286-b327-80c47092fa34
```

Zoom all the way in on a roof and a carved wall panel. The failure mode to look for
is tiles and lattice losing their edges and going soft, not anything dramatic. If
anything looks wrong, the kill switch is below and it is live within five minutes
now.

**4. Then the rest**, in batches so live uploads are not stuck behind the whole
catalogue:

```
railway run npm run backfill:planner-lod -- --force --dry-run
railway run npm run backfill:planner-lod -- --limit 25 --force
```

**5. Re-measure honestly.** Load that planner table and compare against the
**71.27 MB / 9,116,141 triangle** baseline above — not the pre-crease 85.07 MB, which
would flatter the LOD with a win the re-bake already delivered.

### Kill switch (instant, no deploy)

```
railway run npm run db:query -- "UPDATE models SET lod_glb_path = NULL"
railway run npm run db:query -- "UPDATE model_parts SET lod_glb_path = NULL"
```

## Before changing any `plannerLod*` default again

```
cd backend
npm run qa:lod -- --set "South East Asian village"
```

It pulls the production proxies, builds candidates with the shipped code, renders
them against their proxies through Blender at the three planner distances, scores
edge loss worst-first and exits non-zero over a threshold. Needs Blender
(`BLENDER_PATH`, or on PATH); without it, it says loudly that nothing was looked at.

It prints "NOW OPEN THE IMAGES" for a reason. The number ranks candidates. It does
not approve them.

## Still open / not done

- **Nothing has been run against a real Postgres.** Local dev is `DB_MOCK=true`, so
  the backfill's new `--model` filter is typechecked but unexercised. Run the
  `--dry-run` first and check the mesh count looks like one model's worth.
- **The proxy still carries `TANGENT`.** It is 15–38% of the file and the LOD drops it
  with no visible cost — which raises the obvious question for the product page too.
  Not tested there, and it is a separate decision: that page is where close
  inspection actually happens.
- **A per-model `proxy_bake_config` override was not needed.** The error bound adapts
  on its own; every one of the 32 parts landed in a 4.5–10.4% band without one. The
  mechanism is still there (`models.proxy_bake_config`, merged by `loadBakeConfig`)
  if some future asset class needs it.
- **Triangle relief is modest (−27%).** If the planner turns out to be GPU-bound
  rather than download-bound, this config will not fix that, and the honest next step
  would be the second unwrap+bake at LOD resolution described in `PROXY_BAKE.md` —
  about +25 s per bake in the most failure-prone part of the pipeline.
