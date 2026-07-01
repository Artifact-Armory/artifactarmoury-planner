# Terrain Planner — Railway Deployment Checklist

The planner is part of the React/Vite **frontend** (`frontend/`). It is **not** a
separate service. This checklist covers what the planner overhaul needs in
production on Railway + CloudFront. Ordered; do them top to bottom.

## 0. Confirm the stack (already true in this repo)
- Frontend: React 18 + Vite 5 + TypeScript + Three.js 0.160 (vanilla, no R3F).
- Backend: Node + Express + Postgres + Stripe.
- Deploy target: **Railway** for app/API, **CloudFront** for GLB delivery.

## 1. Build
```bash
cd frontend
npm ci
npm run build      # outputs frontend/dist
```
- `npm run build` (Vite/esbuild) is the production build. It **passes**.
- `npm run typecheck` still reports a handful of **pre-existing** errors in
  unrelated files (`api/endpoints/admin.ts`, `orders.ts`, `tables.ts`,
  `components/auth/ProtectedRoute.tsx`). These are type-only and do **not** block
  `vite build`. They predate this work; fix separately if desired.
- Fixed here: `MainLayout` imported `./Footer` while the file is `footer.tsx` —
  this would have broken the build on Railway's **case-sensitive Linux** FS.

## 2. SPA routing (critical)
`/planner` and `/checkout` are client-side routes. Whatever serves `frontend/dist`
**must fall back to `index.html`** for unknown paths, or a hard refresh on
`/planner` 404s.
- If the Express backend serves the SPA: add a catch-all that returns
  `dist/index.html` for non-API GET requests.
- If Railway serves `dist` as a static site / via `serve`: enable the SPA/"rewrite
  to index.html" option.

## 3. Draco decoder (the "don't break the GLB pipeline" item)
- The frontend previously had **no `DRACOLoader`**, so Draco-compressed GLBs could
  not decode. The decoder is now **self-hosted** at `frontend/public/draco/`
  (`draco_decoder.wasm`, `draco_decoder.js`, `draco_wasm_wrapper.js`) and Vite
  copies it to `dist/draco/`. The loader points at `/draco/`.
- Ensure the static host serves `.wasm` as **`application/wasm`** (Vite preview and
  most CDNs do; verify on your host).
- If you put the frontend behind CloudFront, make sure `/draco/*` is **not**
  stripped and is cached.

## 4. GLB delivery via CloudFront (catalogue models)
In production the catalogue loads from the API (`/api/browse`), whose records carry
`glbUrl` pointing at S3/CloudFront. For those to render in WebGL:
- **MIME:** serve `.glb` as `model/gltf-binary`.
- **Caching:** content-hashed filenames + `Cache-Control: public, max-age=31536000, immutable`.
- **CORS (required):** GLTFLoader fetches cross-origin, so CloudFront/S3 must return
  `Access-Control-Allow-Origin` for the frontend origin (and respond to `OPTIONS`).
  Without this the models fail silently and fall back to grey boxes.
- The repo's existing `CLOUDFRONT_*` guides already describe the distribution; just
  confirm CORS + the two headers above.

## 5. Environment variables
**Frontend (build-time, `VITE_` prefix):**
- `VITE_API_BASE_URL` → your API origin (e.g. `https://api.yourdomain.com`).
- `VITE_STRIPE_PUBLISHABLE_KEY` → `pk_live_...` (planner → cart → `/checkout`).

**Backend (Railway service vars):** as per `task.md` / `RAILWAY_DEPLOYMENT_GUIDE.md`
- `DATABASE_URL`, `JWT_SECRET`, `UPLOAD_DIR`, `EMAIL_FROM`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `FRONTEND_URL` (CORS / redirect), `BASE_URL`

## 6. The USP path: planner → cart → checkout
- "Add all to basket" pushes the bill-of-materials into the **real** shop cart
  (`useCartStore`, persisted in `localStorage` under `cart-storage`).
- The global `CartDrawer` is **not** mounted on the full-screen `/planner` route, so
  the planner shows its own confirmation with a **Go to checkout** button →
  `/checkout`. Confirm `/checkout` + Stripe are live so this completes a real order.

## 7. Verify after deploy
- Load `/planner` directly (tests SPA fallback) — palette + populated default table.
- DevTools Network: GLBs `200` (`model/gltf-binary`, CORS ok), `draco_decoder.wasm`
  `200` (`application/wasm`). Console clean.
- Place pieces → "Add all to basket" → "Go to checkout" reaches a working cart.

## 8. Optional (not blocking)
- Initial JS bundle is ~1.06 MB (Three.js dominates). Consider lazy-loading the
  planner route (`React.lazy(() => import('./pages/Planner'))`) so the shop pages
  don't pay for Three.js. Optional `manualChunks` to split `three`.
- `npx update-browserslist-db@latest` to silence the caniuse-lite warning.
