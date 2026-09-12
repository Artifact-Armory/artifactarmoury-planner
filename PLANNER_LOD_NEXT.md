# Planner LOD — live, retuned twice, catalogue backfill outstanding

The tier is **on in production for the "South East Asian village" model** and off
(no `lod_glb_path`) for everything else. This file is the current state and what is
left to do. Full background is in `CLAUDE.md`'s "Planner LOD + crease shading"
section and `backend/PROXY_BAKE.md`.

## How it got here

1. Shipped at a fixed **50,000-triangle budget** with a loose **0.01** error bound.
   Destroyed the catalogue — carved panels to lumpy blobs, roof tiles gone. Rolled
   back by nulling `lod_glb_path`.
2. Retuned to an **error-led** config at **0.0002**, measured at 4.5–10.4% edge loss
   on 32 real parts. Deployed, re-baked, went live.
3. **The artist looked at it and it was still too soft** on carved panelling. Now
   **0.00005** with the normal map left as baked: **0.6–2.0% across all 28 parts**.

Step 3 is the one to remember. The metric ranked the candidates correctly at every
stage and still could not tell "scores well" from "good enough". A rendered
side-by-side against the proxy passed too. What settled it was the person who made
the models saying it looked wrong.

| | value | why |
|---|---|---|
| `plannerLodSimplifyError` | **0.00005** | ~12 microns on a 250 mm piece. A geometric tolerance adapts per model; a triangle count cannot, which is how the first attempt failed. |
| `plannerLodNormalMapSize` | **0** | Leave the baked map alone. At 1024 the map cap, not the mesh, was the dominant error. |
| `plannerLodTriangleBudget` | 50000 | A floor the collapse never reaches. Not a ceiling — meshopt returns `max(target, what the error allows)`. |
| `plannerLodMinReduction` | 0.25 of **bytes** | Was triangles, which is the wrong quantity for a download tier. |
| LOD `Cache-Control` | `max-age=300` | The cache lifetime is the kill switch's blast radius. |

**Whole showcase table: 71.27 MB → 38.72 MB (−45.7%), 9,116,141 → 8,387,382
triangles (−8.0%).** 27 of 28 ship; one texture-dominated part comes out 24.4%
smaller, just under the gate, and correctly keeps the proxy.

**The tier is a download optimisation and essentially nothing else** — only 8% of
triangles come off, and a no-decimation control is already 45–48% smaller from
dropping `TANGENT` and re-quantising through Draco. If planner framerate is ever the
problem, loosening the error bound is the wrong lever.

## The scaling bug found alongside it (fixed, unrelated to the LOD)

`fitToAABB` in `frontend/.../scene/loaders.ts` normalised every mesh by **height**,
against the DB dims. The bake's poison pill **deletes the base faces**, so a proxy is
legitimately shorter than the model — and the loader inflated it to compensate. Every
**top** part scaled ×1.0000; every **bottom**/**mid** scaled **×1.044 to ×1.119**. A
12% size difference between parts of one building, and `surfaceUnits` places the next
storey at the true DB height, so storeys pushed through the roofs above them.

Fixed by scaling from the **footprint** (X/Z survive the bake within 0.03%). Spread
drops to 0.06%.

- **Buyers have had this the whole time the proxy bake has been live.** The artist
  only saw it on 2026-09-11, because the owner full GLB has no poison pills and so
  scaled ×1.0 — and the planner stopped serving it the moment `plannerMeshUrl` began
  appending `?variant=lod`.
- **Saved tables will look different** after the fix. They were laid out against
  inflated parts, so pieces nudged flush may now show small gaps. That is the correct
  geometry appearing.

## What is left

Terminal is Windows `cmd.exe`; `railway run` must be linked to the **Postgres**
service (the backend's `DATABASE_URL` is a private host that will not resolve).

**1. Push and let both services redeploy.** The config only reaches the bake through
the worker image, and the scaling fix only reaches the planner through Cloudflare
Pages. **Confirm the deploy landed before backfilling** — a re-bake started early
rebuilds the old settings and, because writing `lod_glb_path` re-enables the tier, it
silently undoes the kill switch. That has already happened once. The backfill now
prints the last completed bake's own recorded `simplifyError` next to the local
config so the mismatch is visible before you enqueue.

**2. Re-bake the village at the new setting** (it is currently live at the old one):

```
railway run npm run backfill:planner-lod -- --model 0385633e-ef61-4843-b6d8-11518ce17028 --force
```

**3. Look at it.** https://artifactarmoury.com/planner/view/0e30e3c2-22f9-4286-b327-80c47092fa34
— zoom right in on carved panelling and roof tiles.

**4. Confirm which settings were actually used**, which is not the same as confirming
the job ran:

```
railway run npm run db:query -- "SELECT report->'plannerLod' FROM proxy_bake_jobs WHERE status='succeeded' ORDER BY updated_at DESC LIMIT 1"
```

**5. Then the rest of the catalogue**, batched so live uploads are not stuck behind it:

```
railway run npm run backfill:planner-lod -- --force --dry-run
railway run npm run backfill:planner-lod -- --limit 25 --force
```

### Kill switch (no deploy, live within five minutes)

```
railway run npm run db:query -- "UPDATE models SET lod_glb_path = NULL"
railway run npm run db:query -- "UPDATE model_parts SET lod_glb_path = NULL"
```

Verify from outside with no database access: `?variant=lod` answering
`X-Preview-Variant: preview`. **Note it orphans the LOD objects in R2** — each has a
random key held only in that column, so nulling it strands the object (~1 MB each,
unreachable and undeletable). Small, but it accumulates per use.

## Before changing any `plannerLod*` default again

```
cd backend
npm run qa:lod -- --set "South East Asian village"
```

Pulls the production proxies, builds candidates with the shipped code, renders them
against their proxies at the planner's camera distances, scores edge loss worst-first
and exits non-zero over a threshold. Needs Blender (`BLENDER_PATH`, or on PATH);
without it, it says loudly that nothing was looked at.

It prints "NOW OPEN THE IMAGES" for a reason, and the 0.0002 episode is the proof:
it scored fine and was still wrong.

## Still open

- **The proxy carries `TANGENT`.** 15–38% of its file, dropped by the LOD with no
  measurable cost (0.1% on the no-decimation control). The product page is where
  close inspection happens, so it is a separate decision — but it is a large free win
  sitting there untested.
- **Owners get the LOD in the planner, deliberately.** Their full-fidelity copy (041)
  is much of why an owner's table is heaviest. It is also why the artist perceives a
  bigger drop than any buyer does: they are comparing against the full mesh, not the
  proxy. Reconsider only as a product call.
- **`plannerLodMinReduction` at 0.25 now skips one real part** (24.4% smaller). That
  is the zero-loss outcome and costs ~0.5 MB, so it is left alone; lower the gate if
  the bytes ever matter more than the simplicity.
- **Nothing here has been exercised against a real Postgres locally** — dev is
  `DB_MOCK=true`. The backfill's `--model` filter and drift warning have run in
  production, but only via `railway run`.
