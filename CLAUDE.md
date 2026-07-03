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
- **Remaining to test:** download the watermarked STL → decode its header to prove
  buyer-tracing → re-upload the downloaded STL and confirm the **fingerprint
  rejects it**. Then the buyer purchase→download path with a second account.
- **Known unfinished polish:** the demo starter models (`floor/bottom/top/…glb`,
  git-ignored, 100MB+ raw) aren't hosted, so the planner opens with grey **box
  fallbacks**. To fix: Draco-compress + upload to R2 at `assets/models/`.

## Also see
- `memory/MEMORY.md` (+ files) — persistent user prefs & project state, auto-loaded.
- `RAILWAY_DEPLOYMENT_GUIDE.md`, `R2_SETUP.md`, `TABLE_TEXTURES.md` (older, partly
  superseded by this file).
