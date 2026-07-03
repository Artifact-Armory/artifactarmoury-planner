# Artifact Armoury — project guide for Claude Code

A marketplace + 3D tabletop-terrain planner. Buyers browse/purchase 3D-printable
terrain models; a full-screen planner lets them lay out a table and push the
whole build into the cart. Sellers ("artists") upload STLs that are processed,
watermarked on download, and protected against re-upload.

## Stack (the real one — ignore any Ruby/Rails mentions in old docs)
- **Frontend:** React 18 + Vite 5 + TypeScript + Tailwind. 3D planner uses
  **Three.js 0.160 (vanilla, no R3F)** + Zustand, at
  `frontend/src/table-top-terrain-builder/` (route `/planner`).
- **Backend:** Node + Express + TypeScript, PostgreSQL (`pg`), Stripe (mockable).
- **Assets:** Cloudflare **R2** (S3-compatible) behind the CDN domain
  `assets.artifactplanner.com`.

## Live deployment (all separate services)
| Piece | Where | URL |
|---|---|---|
| Backend API | Railway (service root dir = `backend`) | `https://confident-purpose-production-3e3f.up.railway.app` |
| Postgres | Railway managed | (private, referenced via `${{Postgres.DATABASE_URL}}`) |
| Frontend | Cloudflare **Pages** (root dir = `frontend`, build `npm install && npm run build`, output `dist`) | `https://artifactarmoury-planner.pages.dev` |
| Static assets | Cloudflare R2 bucket `artifact-armoury-assets` | `https://assets.artifactplanner.com` |
| Repo | GitHub `Artifact-Armory/artifactarmoury-planner` | deploys from **`main`** |

**To deploy: push to `main`.** Railway auto-redeploys the backend (runs
`npm run migrate` as its **Pre-Deploy Command**), and Cloudflare Pages
auto-rebuilds the frontend. There is **no Dockerfile** (Nixpacks/Railpack).

> The user runs all `git push` / terminal commands themselves — **always print
> the exact copy-paste command** (see memory `feedback-print-commands`). Pushing
> to `main` from here is also blocked by policy.

## Environment variables
**Backend (Railway):** `NODE_ENV=production`, `JWT_SECRET`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
`ALLOWED_ORIGINS` (comma-sep, **exact match, no spaces/trailing slash** — must include the pages.dev origin),
`FRONTEND_URL`, `STRIPE_MOCK=true`, `PAYMENTS_ENABLED=false`, `PRINT_FARM_PROVIDER=mock`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`,
and `WATERMARK_SECRET` (falls back to `JWT_SECRET` if unset). Do **not** set `PORT` or `DB_MOCK`.
**Frontend (Cloudflare Pages, baked in at build):** `VITE_API_BASE_URL` (backend URL),
`VITE_ASSET_BASE_URL=https://assets.artifactplanner.com`. Local values live in `frontend/.env`, `backend/.env` (gitignored; R2 keys are already in `backend/.env`).

## Local dev
- `cd backend && npm run dev` (runs in **`DB_MOCK=true`** mode → `db.query` returns
  `{rows:[]}` for everything, so routes doing `rows[0].x` crash — guard them).
- `cd frontend && npm run dev` (Vite on :3000). `npm run typecheck` in each project.
- Migrations: `backend/db/migrations/*.sql`, run by `scripts/migrate.ts` against
  `DATABASE_URL` (skipped when `DB_MOCK`). Current: **001–007**.

## Seller upload → anti-theft pipeline (built this session)
1. **Upload (async, preferred):** browser presigns (`POST /api/uploads/presign`,
   prefix `raw`) → PUTs STL straight to R2 → `POST /api/models/from-upload`
   creates a `processing` row and a **background job** (`processUploadedModel` in
   `routes/models.ts`) pulls it from R2 → SHA-256 dedup → **geometry fingerprint
   dedup** → `processSTL` + `generateGLB` → stores derived GLB → flips
   `processing_status` to `ready`/`failed`. Frontend `CreateModel.tsx` polls.
2. **Geometry fingerprint** (`services/fingerprint.ts`): rotation/scale/
   tessellation-invariant D2 shape descriptor + compactness. Catches re-uploads
   even after re-export/rotate/rescale/reorder. Stored in `models.geometry_fingerprint` (JSONB).
   Never modifies the file. Threshold `FINGERPRINT_MATCH_THRESHOLD` (default 0.2).
3. **Watermark** (`services/watermark.ts`): AES-256-GCM payload (modelId+buyerId+
   orderId) written into the binary STL's ignored **80-byte header** — traces a
   leaked file to the exact buyer by decrypting the header alone; **geometry
   bytes 84+ are untouched**; forged headers fail the GCM auth tag.
4. **Download** `GET /api/models/:id/download`: entitlement = artist OR buyer with
   a `succeeded` order (`order_items` ⋈ `orders`); streams the STL from R2
   stamping the watermark header on the fly (backpressure, low memory). Frontend
   "Download STL" button on `ModelDetails.tsx` fetches it as a blob.
5. **Purchase (mock):** `POST /orders` → `POST /orders/:id/confirm`; the Stripe
   mock returns `succeeded`, so a test purchase completes without real payment.

## Gotchas that have already bitten us
- **Postgres string numerics:** `DECIMAL`/`NUMERIC`/`AVG()`/`COUNT()` come back as
  **strings**. Coerce with `Number()` before `.toFixed()` etc. (`transformers.ts`,
  `utils/format.ts`).
- **Migrations lagged the code:** columns can exist in `src/db/schema.sql` but not
  in migrations. Add missing ones via `ADD COLUMN IF NOT EXISTS` (see 006/007).
- **ESM in a CommonJS build:** `@gltf-transform/core` is ESM-only → loaded via a
  `new Function('s','return import(s)')` dynamic import in `fileProcessor.ts`.
  Migrate scripts must use CommonJS `__dirname`, not `import.meta.url`.
- **CORS is exact-match, no trim** (`middleware/security.ts`) — `ALLOWED_ORIGINS`
  entries must match the browser Origin character-for-character.
- **R2 texture CORS:** the bucket CORS uses `AllowedOrigins: ["*"]` (public assets)
  so the 1-year immutable cache doesn't serve header-less responses. After
  changing R2/cache, **Purge Everything** in Cloudflare.
- **`Input` needs `forwardRef`** or react-hook-form can't read field values
  (broke Register/Login). Any new RHF-driven UI component must forward its ref.
- **On-demand rendering** in the planner: async assets (GLB/textures) must nudge
  `requestRender()` or they only appear on the next camera move. Shared
  `THREE.LoadingManager` in `scene/loadManager.ts` drives the loading bar.
- **Table-surface textures** are WebP on R2 at `textures/<id>/{albedo,normal,arm}.webp`
  (ARM packing). Optimizer: `backend npm run optimize:textures`.
- **Dead duplicate:** the nested `artifactarmoury-planner/` dir is junk (a stale
  copy with 100MB+ STLs) that got swept into git — safe to strip later; the live
  tree is the repo root. Cloudflare Pages has a **25MB/file limit** (why big GLBs
  can't ship with the site — they belong on R2).

## Git state
- `main` is the deploy branch. Its history was **force-pushed** on 2026-07-01 to
  make the local working copy authoritative over an older Jan-2026 GitHub publish.
- The old GitHub version is preserved on branch **`backup/github-jan-2026-publish`**
  (it had a different, component-based planner UI — LeftSidebar/TopToolbar/etc.).

## Current state / where we left off (Stage 4 end-to-end test)
- Full seller pipeline + anti-theft is built, typechecks, and is committed to `main`.
- Artist test account: **`firefox68@hotmail.co.uk`** — promoted via
  `UPDATE users SET role='artist', email_verified=true WHERE email='…'` (run in
  Railway Postgres). A fresh DB has no artists/admins.
- Verified working live: registration/login (after the `forwardRef` fix), upload →
  processing → `ready`, model view (after the numeric-coercion fix).
- **Anti-theft proven end-to-end (automated, `npm run test:stage4`):** against real
  binary STLs, using the exact production service fns, all pass —
  (1) watermark adds 0 bytes / leaves geometry byte-identical / header decodes to
  the issued buyer+order / a tampered header fails the GCM tag; (2) re-uploading the
  *downloaded* file matches the original fingerprint (distance 0.0000 → rejected);
  (3) stripped-header thief: trace fails but the fingerprint still catches it;
  (4) an unrelated model doesn't match (0.39, no false positive). Script:
  `backend/scripts/test-stage4-e2e.ts`.
- **Stage 4 PROVEN LIVE (2026-07-03) ✅ — full chain end-to-end on production:**
  (a) artist self-download traced (buyer=artist id, order=`0000…` sentinel);
  (b) a real *buyer* purchase→download→trace: buyer `callumjwhite95@hotmail.co.uk`
  (id `ea58abec…`, role `customer`) bought model "Gothic Ruin Corner"
  (`eaa273ff…`) and the trace of their downloaded STL decoded to
  buyer=`ea58abec…`, order=`9edeff99…` (a real non-zero order) — the watermark
  traces a leaked file to the exact buyer+purchase. The anti-theft feature is done.
- **Bug found & fixed during the test:** `POST /orders/:id/confirm` 500'd because it
  `JSON.parse()`d the **JSONB** `model_snapshot` column (pg already returns it
  parsed). Fixed in `routes/orders.ts` (parse only if it's a string). The crash was
  cosmetic — it fired *after* the `payment_status='succeeded'` commit — but it broke
  print-job submission for every order. **Push this fix.**
- **New tooling (this session):** `npm run db:query -- "<SQL>"`
  (`scripts/db-query.ts`) runs one-off SQL on prod from a laptop **without psql**
  (uses pg + `DATABASE_PUBLIC_URL`; run `railway run` linked to the **Postgres**
  service). This is the preferred one-off-SQL path now.
- **Checkout caveat:** the frontend checkout page is still a stub
  ("Stripe UI integration coming soon"), so the purchase above was driven by
  calling `POST /api/orders` + `/confirm` directly with the buyer's JWT (the mock
  `getPaymentIntent` returns `succeeded` for any id). The backend order flow works;
  only the checkout **UI** is unbuilt.
- **Artist "My Models" dashboard BUILT (2026-07-03):** `ArtistModels.tsx` and
  `EditModel.tsx` were empty stubs — now real. My Models lists all of the artist's
  models incl. **drafts** and still-processing/failed ones (via new
  `modelsApi.getMyModels` → `GET /models/my-models`), with status/processing badges
  and **Publish / Unpublish / Edit** actions; Publish is disabled with an inline
  reason until the model is ready + has a thumbnail + a ≥20-char description. Edit
  page loads the model, edits name/desc/category/tags/price (PATCH `/models/:id` —
  fixed `updateModel` from a wrong `PUT`), shows a live 0/20 description counter, and
  has **Save & publish**. Backend `my-models` query now also selects
  `processing_status`/`processing_error`; `mapModelRecord` now maps
  `status`/`visibility`/`processingStatus`/`downloadCount`.
- **Artist can now DELETE a model** (My Models → Delete, with a confirm). Hits the
  existing hard-`DELETE /models/:id`, which removes the row — and therefore its
  `geometry_fingerprint` + `file_hash` — so the artist can **re-upload the same
  model later** without the dedup blocking it. Caveat baked into the confirm text:
  it also deletes the R2 files and, via `order_items.model_id ON DELETE SET NULL`,
  any buyer who purchased it loses download access (their order row survives).
- **Planner "can't place a marketplace model" — FIXED (root cause):** the palette is
  built from the API catalogue (`loadAssetsFromAPI` → `store().assets`), but the
  scene's ghost/placement code resolved assets via `getAssetById`, which only knew
  the **local demo manifest**. So an API model highlighted on click but produced no
  ghost and couldn't be placed. Fix: `loadAssetsFromAPI` now calls a new
  `registerAssets()` (`core/assets.ts`) that merges the API assets into the by-id
  lookup. **Second planner fix (scale):** API models come from mm-authored STLs, so
  their GLB rendered ~1000x too big (mm treated as metres) — a piece filled the whole
  screen. `loadAssetsFromAPI` now sets `scaleToFit: true` and `loaders.ts` uniformly
  rescales the GLB to the model's real-world `aabb` (DB dims ÷ 1000); dev-manifest
  GLBs (already metres) are untouched. NOTE the two separate carts remain by design:
  the **shop basket**
  (`store/cartStore.ts`, `cart-storage`) vs the **planner** (its palette + its own
  table-derived basket). Flow is planner→cart (`addLayoutToShopCart`); shop-basket
  items do NOT appear on the planner table. That disconnect still confuses users —
  a UI clarification is a good follow-up.
- **Planner opens on a CLEAR table now:** the auto starter-layout was removed
  (`App.tsx`) — it had been placing 5 copies of the first API asset (its demo ids
  like `floor` aren't in the API catalogue, so `pick()` fell back to `assets[0]`).
- **Models were rendering ON THEIR SIDE — fixed at source:** `convertSTLtoGLBPure`
  copied STL verts straight through, but STL is **Z-up** and glTF is **Y-up**, so
  every pure-Node GLB lay on its side (Blender's exporter converts; prod has no
  Blender). Now rotates `(x,y,z)→(x,z,-y)` for positions + normals. **Only affects
  GLBs generated after deploy** — existing models must be re-processed (delete +
  re-upload) to get an upright GLB.
- **Manual tilt/pitch control ADDED:** placed pieces now have an optional
  `Instance.pitchDeg` (tilt about X, in addition to `rotationDeg` yaw). Tilt the
  selection with **T** / **Shift+T** (±`rotationStep`, 90° in snap mode) or the
  RotateCw/RotateCcw toolbar buttons that appear when pieces are selected.
  `store.tiltSelected(deltaDeg)` patches via `updateInstances` (undoable);
  `InstancedScene.composeMatrix` applies yaw×pitch about the base-centre. This is
  the robust fallback for any model whose STL wasn't Z-up. (Known minor: the
  selection outline stays upright; the ghost doesn't pitch — tilt is applied to
  already-placed pieces.)
- **Planner FPS drop when close + moving camera — mitigated:** the render loop
  continuously re-renders while the camera moves, so a heavy print-resolution GLB at
  close range (max fill) tanked the framerate. Added **adaptive resolution**
  (`ThreeStage` render loop: renders at `LOW_DPR` while `cam.update()` reports motion,
  snaps back to `FULL_DPR` when settled) and skipped hover-raycasts while a mouse
  button is held (camera orbit). ROOT CAUSE still open: `convertSTLtoGLBPure` keeps
  every triangle of the raw STL un-indexed — the proper fix is **decimating the
  preview GLB** on the backend (e.g. `@gltf-transform/functions` `simplify` +
  meshopt) so heavy uploads aren't million-triangle previews. Draco alone won't help
  render cost (same triangle count after decode); decimation reduces it.
- **Preview GLB optimisation DONE (decimate + Draco):** `convertSTLtoGLBPure` now
  builds the mesh **positions-only** (STL flat per-face normals were blocking
  welding/decimation — every edge a seam), then weld → **simplify** (meshopt, down
  to `PREVIEW_TARGET_TRIS`=60k, error 0.005) → recompute **smooth** normals → dedup →
  **Draco** compress. Verified: sandbags 307k→60k tris & 15MB→155KB; a ~690k-tri
  model → 60k & tiny. New deps: `@gltf-transform/functions`+`/extensions`,
  `meshoptimizer`, `draco3dgltf`. The **STL buyers download/print is untouched** —
  only the preview changes (now smooth-shaded, slightly decimated). Draco is safe
  because the ONLY consumer of these GLBs is the planner's `loaders.ts` (DRACOLoader
  wired, decoder at `/draco/`); marketplace pages use PNG thumbnails, and
  `assets.ts loadGLTFScene` (bare loader, no Draco) is dead code. Existing models
  need a **re-upload** to regenerate the optimised GLB (same re-upload also fixes
  orientation). Tune via `PREVIEW_TARGET_TRIS`.
- **Still-latent frontend bug (NOT fixed):** `modelsApi.uploadThumbnail` and
  `uploadModelFile` POST to `/models/:id/thumbnail` and `/models/:id/file`, but those
  routes **don't exist** (only `POST /models/:id/images`). So a draft with no
  thumbnail currently can't get one via the UI — publish will be blocked. Add the
  routes (or point the client at `/images`) before that path matters.
- **Known unfinished polish:** the demo starter models (`floor/bottom/top/…glb`,
  git-ignored, 100MB+ raw) aren't hosted, so the planner opens with grey **box
  fallbacks**. To fix: Draco-compress + upload to R2 at `assets/models/`.

## Operational how-tos
**Run one-off SQL on production** (promote an artist, inspect data, etc.):
- Railway → **Postgres** service → **Data**/**Query** tab → run SQL. Or via CLI:
  ```
  railway link              # select project, then the Postgres service
  railway connect Postgres  # opens a psql shell
  ```
  The private `DATABASE_URL` is **not** reachable from a laptop directly — use
  `railway connect` (or `DATABASE_PUBLIC_URL`), not a local `psql "$DATABASE_URL"`.
  Example — promote the test artist:
  ```sql
  UPDATE users SET role='artist', email_verified=true WHERE email='firefox68@hotmail.co.uk';
  ```
  (Role is baked into the JWT, so the user must **log out/in** after promotion.)

**Trace a downloaded STL's watermark** (identify which buyer a leaked file came
from). Run via `railway run` so the production `WATERMARK_SECRET` is injected:
  ```
  cd backend
  railway link    # link the backend service
  railway run npm run trace:watermark -- "C:\path\to\downloaded.stl"
  ```
  Prints the model / buyer / order IDs, or "no valid watermark" if the header was
  stripped — in which case the **geometry fingerprint** is the fallback proof
  (it's already stored per model and rejects the re-upload automatically).

## Also see
- `memory/MEMORY.md` (+ files) — persistent user prefs & project state, auto-loaded.
- `RAILWAY_DEPLOYMENT_GUIDE.md`, `R2_SETUP.md`, `TABLE_TEXTURES.md` (older, partly
  superseded by this file).
