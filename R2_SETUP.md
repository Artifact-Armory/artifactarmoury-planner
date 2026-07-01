# Cloudflare R2 — Asset Serving Setup

Move heavy/static files (GLB catalogue, thumbnails, table textures, future map blobs)
off the Railway app onto an R2 bucket served via Cloudflare's CDN. R2 has **zero egress
fees**, so Railway only ever serves the app shell, small JSON, and the API.

The code is wired and **falls back to local `/uploads` serving when R2 is unconfigured**,
so nothing breaks until you set the env vars below.

---

## 1. Create the bucket + custom domain (Cloudflare dashboard)
1. **R2 → Create bucket** (e.g. `artifact-armoury-assets`).
2. **Bucket → Settings → Public access → Custom Domains → Connect Domain**
   (e.g. `assets.yourdomain.com`). This routes the bucket through Cloudflare's CDN.
   ⚠️ Do **not** use the `*.r2.dev` dev URL in production — it's rate-limited.
3. **R2 → Manage API Tokens → Create API Token** (Object Read & Write for this bucket).
   Note the **Access Key ID** and **Secret Access Key**, and your **Account ID**.

## 2. Railway environment variables (backend service)
| Var | Example | Notes |
|---|---|---|
| `R2_ACCOUNT_ID` | `a1b2c3…` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | `…` | from the R2 API token |
| `R2_SECRET_ACCESS_KEY` | `…` | from the R2 API token (keep secret) |
| `R2_BUCKET` | `artifact-armoury-assets` | bucket name |
| `R2_PUBLIC_BASE_URL` | `https://assets.yourdomain.com` | the **custom domain**, no trailing slash |

When all five are present, `isR2Enabled()` flips on: uploads mirror to R2 and
`getFileURL()` returns CDN URLs. Missing any → automatic fallback to `/uploads`.

## 3. Frontend build env var (Railway frontend / Vite build)
| Var | Example | Notes |
|---|---|---|
| `VITE_ASSET_BASE_URL` | `https://assets.yourdomain.com` | same custom domain. Frontend loads GLBs/thumbnails/textures from here. |
| `VITE_API_BASE_URL` | `https://api.yourdomain.com` | the API origin (unchanged) |

> Bug fixed in this change: the frontend previously read `VITE_API_URL` (which was never
> set) when building GLB URLs. It now uses `VITE_ASSET_BASE_URL` → `VITE_API_BASE_URL`.

## 4. CORS policy (R2 bucket → Settings → CORS Policy)
GLBs are fetched cross-origin by the browser's WebGL loader. Without this they fail
**silently** (grey boxes). Paste this, replacing the origins:

```json
[
  {
    "AllowedOrigins": [
      "https://yourdomain.com",
      "https://www.yourdomain.com"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 86400
  }
]
```
- `GET`/`HEAD` for reads; `PUT` only needed for presigned browser uploads.
- Add `http://localhost:3000` while developing against the real bucket.

## 5. Cache headers
The upload paths set `Cache-Control: public, max-age=31536000, immutable` automatically,
and keys are content-hashed (random hash + extension) so immutable caching is safe.
Optionally add a Cloudflare Cache Rule on the custom domain to **Cache Everything** /
respect origin headers for `/*`.

## 6. Migrate existing assets
Upload the current static assets to R2 (run from `backend/`, with the R2_* vars set —
e.g. in `backend/.env`):

```bash
# planner dev GLBs  → r2://models/...
npm run upload:r2 -- ../frontend/public/assets/models models

# Draco decoder (if you want it on the CDN too) → r2://draco/...
npm run upload:r2 -- ../frontend/public/draco draco

# table textures (after downloading + resizing per TABLE_TEXTURES.md) → r2://textures/...
npm run upload:r2 -- ./textures textures
```
The script skips objects that already exist (pass `--force` to overwrite), sets the
correct `Content-Type` (`.glb` → `model/gltf-binary`), and prints each public URL.

For files already stored by the app under `UPLOAD_DIR` (uploaded products), either run
the script against that dir, or just let new uploads mirror to R2 going forward
(`uploadToStorage` now PUTs to R2 when enabled).

## 7. Presigned uploads (optional, for new product/blob uploads)
`POST /api/uploads/presign` (artist/admin auth) → `{ uploadUrl, publicUrl, key }`. The
browser then `PUT`s the file straight to R2 — bytes never touch Railway. Allowed key
prefixes: `models`, `thumbnails`, `images`, `textures`, `maps`.

## 8. Verify
- Network tab: GLBs load from `assets.yourdomain.com` with `200` + `model/gltf-binary`,
  no CORS errors; the Railway app no longer serves `/uploads/*.glb`.
- The planner renders real models (not grey boxes) — confirms Draco + CORS are good.
- `curl -I https://assets.yourdomain.com/models/<file>.glb` shows
  `cache-control: public, max-age=31536000, immutable`.
