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
| Backend API | Railway (service root dir = `backend`) | `https://api.artifactarmoury.com` (custom domain; underlying Railway service is `confident-purpose`, still reachable at `https://confident-purpose-production-3e3f.up.railway.app`) |
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
`FRONTEND_URL`, `STRIPE_MOCK=false`, `PAYMENTS_ENABLED=true` (**flipped live 2026-08-31** — real
Stripe payments, real Connect payouts; a real test payment has gone through in production. Live
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are set and the webhook is registered), `PRINT_FARM_PROVIDER=mock`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`,
and `WATERMARK_SECRET` (falls back to `JWT_SECRET` if unset). Do **not** set `PORT` or `DB_MOCK`.
Owner full-fidelity GLBs (041) are on by default; knobs are `FULL_GLB_ENABLED` (`false` disables),
`FULL_GLB_INLINE` (force the API server to drain the queue; defaults to on only when
`PROXY_BAKE_ENABLED` is off), `FULL_GLB_MAX_TRIS` (1M — a memory ceiling, ~1.1 KB RSS/triangle) and
`FULL_GLB_POSITION_BITS` (16).
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
   Never modifies the file. Threshold `FINGERPRINT_MATCH_THRESHOLD` (**default 0.08**
   — was 0.2, which false-positived two different-but-similar models e.g. two houses;
   real re-uploads score ~0.0–0.04 so 0.08 keeps them caught) + a compactness guard
   `FINGERPRINT_COMPACTNESS_TOLERANCE` (default 0.10). `findGeometryDuplicate` logs
   `Geometry dedup check {closestDistance, threshold, matched}` on every upload — check
   Railway logs to tune. Failed dedup does **not** store a fingerprint, so rejected
   uploads never become match candidates.
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

## Pricing model — DIGITAL STL ONLY + BUNDLES (built 2026-07-03)
The marketplace sells **digital STL downloads only** for now (print-and-ship is a
later feature). Consequences, all built this session (migration **008**):
- **Every model is `fulfillment_type='stl'`.** Default flipped to `'stl'` and all
  existing rows migrated; the create-model form no longer asks (both create routes
  in `routes/models.ts` hard-insert `'stl'`; the frontend fulfilment `<select>` is
  gone). `transformers.ts` defaults to `'stl'`.
- **Buy once per customer.** `POST /api/orders` now takes `items:[{modelId}|{bundleId}]`,
  requires a signed-in user, has **no shipping** (order shipping_* columns made
  nullable), sets `fulfillment_status='delivered'` on confirm and **does not** submit
  to the print farm. It rejects re-buying a model you already own (a bundle is only
  rejected if you own **every** model in it). New **`GET /api/orders/entitlements`**
  → `{modelIds}` drives the UI (Download vs Add-to-cart). Download entitlement +
  per-buyer watermark path are unchanged.
- **Mock checkout is now real** (`pages/Checkout.tsx`, was a stub): cart → create
  order → confirm (mock Stripe returns `succeeded`) → downloads unlock. `ordersApi`
  was realigned to the actual backend routes (the old `/payment-intent`,
  `/confirm-payment`, `/receipt`, `/invoice` calls were dead).
- **Cart generalised** (`store/cartStore.ts`) to `{kind:'model'|'bundle', id, …}`,
  **own-once (no quantity)**, dedupe key `kind:id`, persist **version 3** (migrates old
  `{modelId,quantity}` lines). Updated `CartDrawer`, `ModelCard`, `ModelDetails`, and
  the planner's `addLayoutToShopCart` (now adds each unique model once — you buy the
  STL once and print any number).
- **Bundles** = an artist groups several of **their own** models under one name + one
  price; buying grants download of each STL. Tables `bundles` + `bundle_items`
  (schema.sql + 008); `order_items` gained `bundle_id`/`bundle_name`. A bundle purchase
  **expands into one `order_items` row per constituent model** (price split across
  models proportional to `base_price`, remainder to the last), so per-model entitlement
  + watermark "just work". Backend `routes/bundles.ts` (CRUD + publish/unpublish;
  publish needs ≥2 models, thumbnail, desc≥20, price>0) mounted at `/api/bundles`.
  Frontend: `api/endpoints/bundles.ts`, artist `ArtistBundles`/`CreateBundle`/`EditBundle`
  (+ `BundleForm`, model multiselect, thumbnail via the presign path — avoids the latent
  `/models/:id/thumbnail` bug), public `pages/BundleDetails.tsx` at `/bundles/:id`,
  "My Bundles" nav in `DashboardLayout`, routes in `app.tsx`. Both projects typecheck clean.
- **Bundles marketplace + planner surfacing (built 2026-07-03):** a public **Bundles**
  browse page at `/bundles` (`pages/Bundles.tsx`, grid of published bundles → `/bundles/:id`)
  with a **"Bundles" nav link** in `Header` (desktop + mobile). Only **published** bundles
  appear anywhere public — a draft bundle shows only in the artist's `/artist/bundles`. The
  public `GET /api/bundles` list includes each bundle's members. In the **planner**, "My
  items" now also shows an **artist's own** published bundles (compare `bundle.artistId` to
  the signed-in user), on top of owned + basket ones — so a creator sees their bundle without
  buying it. Print-farm/"order a print" is deferred by design.
- **Planner price is buy-once (fixed 2026-07-03):** the "Your build" BOM used to multiply a
  model's price by how many copies were on the table. Digital STLs are bought **once** (print
  any number), so `bom.total` now sums each unique model's price a single time and each row
  shows `£price` with `×N` as a piece count only (`ui/App.tsx`). (`core/pricing.ts` is legacy
  print-cost maths and isn't used for this total.)
- **Planner palette has TWO tabs now (built 2026-07-03):** *Catalogue* (all published
  models, as before) and ***My items*** = the models/bundles the user **owns or has in
  their shop basket**. Bundles render as **expandable group tiles** (click to reveal the
  member models, each individually placeable) so a buyer sees them grouped *and*
  separately. **Placing a Catalogue model auto-adds it to the shop basket** (so it shows
  under My items) via `store.addPlacedModelToShopCart(assetId)` called from `addInstance`
  — it's **bundle-aware** (skips models you own, already have, or that are covered by an
  owned/in-cart bundle, so checkout's "appears more than once" guard never trips) and adds
  with `cartStore.addItem(item, /*openDrawer*/ false)` so the shop drawer doesn't pop over
  the planner. Data: `loadAssetCatalogue` now also loads `bundlesApi.list()` (public list
  now includes member `models`) + `ordersApi.getEntitlements()` (now returns
  `{modelIds, bundleIds}`) into store `bundles`/`ownedModelIds`/`ownedBundleIds`.
  UI in `ui/App.tsx` (`paletteTab`, `expandedBundles`, `renderModelTile`), styles
  `tb-palette-tabs`/`tb-tab`/`tb-bundle`/`tb-chev`/`tb-pill.bundle`. `getEntitlements` now
  returns `{models,bundles}` Sets — `ModelDetails`/`BundleDetails` updated accordingly.

## Multi-part "set" models (built 2026-07-03, migration 009)
A single piece of terrain can be **several STL files** (e.g. Gothic Ruin = 4 parts, or
one STL per floor). A model now optionally carries **extra parts**: **one listing, one
price, one purchase**, download = a **ZIP of all parts** (each watermarked), and in the
planner **each part is individually placeable**, grouped under a **SET** tile (reusing the
bundle group UI). Distinct from a **bundle** (which groups *independently-listed* models).
- **Schema (009 + schema.sql):** `models.part_count` (1 = ordinary model); the model's own
  `stl_file_path`/`glb_file_path`/dims are **part 1 (primary)**; extra parts live in new
  `model_parts` (per-part stl/glb/dims/file_hash/geometry_fingerprint/status/order).
- **Upload:** `POST /from-upload` accepts `parts:[{rawKey,filename,name?}]` (each its own
  presigned `raw/` upload); `processUploadedModel` processes the primary then
  `processModelParts` (per-part GLB via `convertSTLtoGLBPure` + fingerprint dedup + dims).
  The model stays `processing` until **all** parts are ready. `findGeometryDuplicate` now
  scans **`model_parts` too**, so a stolen file re-uploaded as a "part" is still caught.
  CreateModel.tsx has an "Extra parts (optional)" multi-file input.
- **Download (`GET /:id/download`):** if `part_count>1` → streams a **ZIP** (`archiver` dep,
  added) of the primary + each part, each run through `watermarkedSTLBuffer`. Single-STL
  models unchanged. Entitlement is still per **model**.
- **Marketplace:** `GET /:id` returns `part_count` + a `parts` array; `ModelDetails.tsx`
  shows a **"SET · N parts"** badge, the part list, and a "Download ZIP (N parts)" button.
  `browse.searchModels` exposes `part_count`. Multi-part models still show as one product card.
- **Planner:** new `GET /api/models/sets` → published multi-part models + parts. The planner
  **excludes multi-part models from the flat Catalogue** (`loadAssetsFromAPI` filters
  `partCount>1`) and instead `loadSetsFromAPI` (`core/assets.ts`) registers **each part as a
  placeable asset** (primary asset id = modelId; extras = `part:<partId>`; mm→m aabb,
  `scaleToFit`). Store holds `sets`/`setPartAssets`; "My items" renders bundles + sets as one
  expandable group list (`SET` vs `BUNDLE` pill), gated on the parent **model** owned/in-basket/own.
  Placing a part → `addPlacedModelToShopCart` adds the **parent model** once (buy-once). Only
  the **primary** part carries the price so the "Your build" total counts a set once (extras £0).

## Grouped listings — several named models in one product (built 2026-08-23, migration 038)
An artist selling a **"Small Village"** (a Village Tower of 3 parts, a Tavern of 2, a Well of 1)
lists it **once, at one price**. On top of 009's flat part list, every file now belongs to a
named **component** ("included model"):
- **Schema (038 + schema.sql):** `model_parts.group_index` (0 = the component that owns the
  model's own primary STL; 1..N added after it) + `model_parts.group_name`, and
  `models.primary_group_name` (name of component 0; **NULL = ungrouped**, i.e. a plain single
  model or a flat 009-style set — old rows keep working untouched).
- **Upload UI (`CreateModel.tsx`):** the old "Model file" + "Extra parts" inputs are replaced by a
  **component list** — each block has a name ("Village Tower") and takes **multiple part files**,
  with an **"Add another model"** button below. First file of the first block = the primary. Names
  are required as soon as there's more than one component. One progress bar spans **all** files
  ("Uploading… 40% · tower-roof.stl — file 4 of 11").
- **API:** `POST /from-upload` takes `primaryGroupName` plus `groupIndex`/`groupName` per part.
  Caps: `MAX_EXTRA_PARTS` 60 (was 20), `MAX_COMPONENTS` 20. Default part names count **within**
  their component. `GET /:id` and `GET /sets` return `group_index`/`group_name` +
  `primary_group_name`.
- **Download ZIP** nests each component in its **own folder** (`village-tower/roof.stl`) when the
  listing is grouped; ungrouped sets stay flat. Entry names are de-duplicated, since two
  components may legitimately reuse a part name.
- **Product page** shows `GROUP · N models` with a per-component breakdown (plain sets keep the
  old `SET · N parts` list). **Planner** labels a part by its component ("Village Tower — Roof")
  instead of the listing name; parts still sit flat under one SET tile (nested palette = follow-up).

## Upload failures are now told to the artist (2026-08-23)
Processing runs in the background *after* the artist has left the upload form, so a rejection
only ever landed in `models.processing_error` and was never shown — the model just sat there
with no preview (hit live: a 7-part "Houses" upload was rejected as a duplicate and the seller
was told nothing). Fixed on three fronts:
- **Notification on every failure.** `markModelFailed()` (the single choke point for upload-time
  rejections) and `failJob()` in `proxyBake/queue.ts` (permanent bake failures) both now
  `createNotification({type:'model.upload_failed'})` to the artist, with the reason in the body
  and a link to `/artist/models`. The bell renders title/body generically, so no UI work needed.
- **My Models shows the reason** (`ArtistModels.tsx`), not a bare "Preview failed" pill: the row
  gets a red block with `processingError` + advice, and the badge reads **Rejected** vs
  **Upload failed**. `publishBlocker()` returns the real reason — it used to say "re-upload this
  model", which is actively wrong for a duplicate (re-uploading fails identically).
  `isDuplicateRejection()` matches both the new and the pre-2026-08-23 wordings.
- **Duplicate messages are clearer and don't leak.** Dedup scans *every* artist's models
  (that's the anti-theft point), but the old message pasted the clashing model's **name** into
  the error — handing a stranger another artist's listing name, and reading as gibberish
  ("matches \"Model 2\"") to someone who's never seen it. `duplicateMessage()` now names the
  model **only when the uploader owns it** (where it's actually actionable) and otherwise says
  "already on the marketplace"; part rejections name **which file** clashed.
- **The artist is now exempt from dedup (migration 039).** Dedup exists to stop THEFT, so it
  only rejects a match against **another artist**. An artist may upload the same file as many
  times as they like — that's how a piece gets sold **individually and inside a set**. This
  required dropping the **UNIQUE constraint on `models.file_hash`** (from schema.sql's inline
  `UNIQUE` *and* migration 006's unique index — 039 drops both and re-creates a plain index),
  or the second upload would have died on a constraint violation instead.
  `findGeometryDuplicate(fp, excludeId, uploaderId)` now returns `{foreign, own}` and **foreign
  always wins**, so a file matching both the uploader's model and a stranger's is still
  rejected. Applied at all four dedup sites (direct upload, parts, new-version replace, legacy
  multipart create). Self-matches are collected and roll up into **one** informational
  notification per upload (`model.duplicate_allowed`) — an accidental double upload is now
  otherwise invisible. `duplicateMessage()` lost its "your own model" branch as unreachable.
  `npm run test:stage4` still passes (it exercises the fingerprint maths directly).

## PayPal at checkout (built 2026-08-25)
PayPal is accepted **through Stripe**, not as a second processor: same PaymentIntent, same
webhook, same settlement, same Connect payouts — one integration instead of two reconciliation
paths. `automatic_payment_methods` already surfaces every method enabled on the account, so the
Payment Element grows a PayPal tab on its own.
- **Still required, and only you can do it:** activate PayPal in the Stripe Dashboard
  (Settings → Payment methods). **Marketplaces on Connect must submit the onboarding request
  first** — until that's approved the tab will not appear, however correct the code is.
- **`return_url` was the real code change.** Cards settle in place under
  `redirect: 'if_required'`, but PayPal always hands off to a hosted approval page; without a
  `return_url` Stripe *rejects the confirm* rather than degrading. `Checkout.tsx` now passes
  `/checkout?order=<id>` and handles the come-back leg (Stripe appends `payment_intent` +
  `redirect_status`), because no in-page `confirmPayment` promise survives the round trip.
- **StrictMode gotcha, cost an hour:** the page mounts → unmounts → mounts, so state set by the
  first mount is thrown away, and `setSearchParams` (a router navigation) causes *another*
  remount that did the same. Fixed by stripping the query with `window.history.replaceState`
  (no popstate → React Router never sees it) and memoising the confirm **promise** at module
  scope in `returnConfirms`, so one request goes out and every mount subscribes to it. A ref
  guard does NOT work here — refs die with the discarded mount. Verified: one `/confirm` call.
- **`orders.payment_method`** (already CHECK'd to `'stripe'|'paypal'`) is now actually written.
  It's read **off the PaymentIntent**, never trusted from the client, since the buyer can switch
  method inside the Payment Element after the order row exists. NB `payment_method_types` is
  **not** a usable signal — with automatic methods it lists everything enabled on the account,
  so `[0]` would relabel card orders as PayPal; `paymentMethodOf()` reads the attached
  PaymentMethod (webhooks arrive unexpanded, hence `resolvePaymentMethod()` re-fetches).
- **Async settlement handled:** a `processing` intent no longer 500s or unlocks downloads — the
  order is marked `processing` and a "Payment processing" screen tells the buyer their files
  will appear once it clears. The webhook finishes the order.
- **Confirm is now idempotent.** Redirect returns make double-confirm genuinely reachable
  (reload the return URL, or the webhook racing the request). The claim is atomic —
  `UPDATE … WHERE id=$1 AND payment_status <> 'succeeded'` — and only the request that actually
  claims the row sends the receipt and counts the sale.
- **Test checkout** gained a Card / PayPal toggle (mock intent ids carry `_paypal`) so the path
  is exercisable without live keys. Live mode shows no picker — Stripe renders its own tabs.
- Verified in-browser on the mock path: toggle flips, cancelled-return shows its message and
  keeps the cart, confirm fires exactly once and surfaces the backend's response.

## Tax-inclusive pricing (built 2026-08-25, migration 040)
Buyers now see the price they will actually pay, from the first product card. Artist
prices are **NET**; the buyer picks their country and every buyer-facing surface renders
**net + that country's VAT**. Nothing new appears at checkout — the panel there only
*breaks out* tax the buyer has been looking at all along.
- **Artist earnings are untouched.** `order_items.unit_price` stays net and commission is
  still computed on net, so payouts and the earnings ledger are unaffected. Tax lives at
  the order level only (`orders.tax` + new `tax_country` / `tax_rate`, snapshotted because
  rates change and a historical order must report what was charged).
- **Rates live in the backend** (`services/vat.ts`, served by `GET /api/tax/countries`), so a
  rate change ships with a backend deploy and the storefront can't disagree with the charge.
  UK + EU-27 standard rates; everywhere else is zero-rated. **These need verifying before
  launch and re-checking periodically** — the real fix is Stripe Tax (~0.5%/txn), which the
  single `rateFor()` lookup is shaped to be swapped for.
- **Frontend:** `store/taxStore.ts` (persisted country, guessed from browser locale, never
  overriding an explicit choice), `components/common/CountrySelect.tsx` (header + checkout).
  `PriceDisplay` is where net becomes gross, which is why every buyer-facing price routes
  through it. **Artist/admin screens deliberately do NOT** — they show net, which is what an
  artist earns on. Cart drawer's "Taxes calculated at checkout" line is gone; it now states
  the VAT-inclusive total.
- **TWO money bugs were caught by testing, both would have shipped silently:**
  1. *Displayed ≠ charged.* The frontend grossed up in one step, the backend added a
     separately rounded VAT line — they disagreed by **1p on floating-point ties** (at 25%
     VAT a £4.10 model displayed £5.13, charged £5.12). Both now work in **integer pence**
     with the same expression. `grossFromNet`/`vatFromNet` in taxStore.ts and `vatPenceOn`
     in vat.ts **must be changed together**.
  2. *Baskets didn't add up.* VAT on the basket total ≠ sum of per-line VAT: lines of £5.13
     + £0.73 displayed against a £5.85 total. VAT is now charged **per cart line, then
     summed** (`vatOnLines` / `grossFromLines`), so the visible lines always reach the
     total. A bundle is **one** line at its own price, even though it expands into several
     `order_items`.
- **`npm run test:vat`** (`scripts/test-vat-parity.ts`) guards both: 2M price/country
  combinations + 160k multi-line baskets, asserting displayed == charged, the breakdown
  reconciles, and the lines sum to the total. Run it after touching either rounding path.
- Verified in-browser: header picker auto-detects locale, switching country re-prices the
  whole basket live (GB 20% → HU 27% → US 0%), and the previously-mismatching Swedish case
  now displays exactly what the backend charges.
- **Still open:** EU VAT needs **two pieces of non-contradictory location evidence** — a
  self-declared dropdown is not enough on its own. The card/PayPal country from Stripe is
  the natural second piece and isn't wired up yet.

## VAT: we are the deemed supplier, and that is not escapable
Worth knowing before pricing decisions. Under EU/UK platform rules (Art. 9a of Implementing
Reg. 282/2011) the presumption that the *platform* supplies the customer is **irrebuttable** if
the platform sets the T&Cs, authorises the charge, **or** authorises delivery. We do all three —
and delivery control is the watermarking pipeline itself, so it can't be given up. Consequence:
VAT is owed on the **full price the buyer pays**, not on our commission, with **no threshold**
for EU B2C digital sales (non-Union OSS registration from the first sale; the €10k threshold is
for EU-established sellers, not UK ones). **The pricing side of this is now built** — see
"Tax-inclusive pricing" above: listed prices are net, destination VAT is added at checkout, and
commission is computed on the net. What remains is not code: **OSS registration and filing**,
and verifying the rate table. **Get an accountant on this before launch.**
Note Stripe *direct charges* (`application_fee_amount`, artist as merchant of record) is the
only structural alternative, and it's a bad trade here: a 3-artist cart becomes 3 charges = 3×
the fixed fee, disputes land on artists, and it still may not escape the delivery-control test.

## Owner full-fidelity GLB in the planner (built 2026-08-26, migration 041)
The GLB the planner draws is a **preview proxy**: decimated to `PREVIEW_TARGET_TRIS` and,
on the bake path, carrying an embossed watermark round the model's base — deliberately
useless on a print bed. Someone who has **bought** the model already holds the STL, so
there is nothing left to protect them from: they now get the real mesh instead.
- **Second, independent pipeline.** `full_glb_jobs` (041) is a separate queue from
  `proxy_bake_jobs` and **never touches `models.processing_status`** — a model goes
  `ready`, and the artist leaves the upload form, on exactly the schedule it did before.
  A late/failed/skipped owner build just means the buyer keeps seeing the proxy, i.e. the
  pre-041 behaviour, so a failure notifies **nobody** (unlike a failed preview bake, which
  leaves a listing with no picture and must reach the artist).
- **Who builds it.** The bake worker drains this queue too, but **strictly second** — only
  when no preview bake is waiting, so an owner backlog can never delay an artist's preview.
  The build is pure Node (no Blender); it lives in the worker to keep its CPU off the web
  dyno. With no worker deployed, `services/fullGlb/inline.ts` drains it in the API server
  instead (default ON only when `PROXY_BAKE_ENABLED` is off), so switching the worker off
  degrades this to "slower", not "silently dead".
- **What "owner GLB" means (revised 2026-08-31 — see follow-up note below).**
  `convertSTLtoGLBFull` (fileProcessor.ts) is the preview converter with the watermark
  removed and its decimation made much lighter: **no `simplify()` at all** unless the
  source is denser than `OWNER_GLB_TARGET_TRIS` (default **3× `PREVIEW_TARGET_TRIS`**,
  i.e. 240k), in which case it's trimmed toward that budget at a **much tighter error**
  (`FULL_GLB_SIMPLIFY_ERROR`, default 0.001 vs the preview's 0.004). Most listings never
  approach the budget and pass through with every triangle intact. `weld()` merges only
  *bitwise-identical* vertices, so positions are untouched by it; crease normals are
  rebuilt at the same 45° as the preview so an owner's model doesn't suddenly shade
  differently from the one they were looking at before they bought it. Draco is the other
  approximation and POSITION is raised to **16 bits** (`FULL_GLB_POSITION_BITS`)
  ≈ 4.6 µm on a 300 mm model. **The STL the buyer downloads is untouched by all of it.**
- **One URL, two variants.** `GET /api/models/:id/preview.glb` (and `/parts/:partId/…`)
  now serves the owner copy when the viewer is entitled — artist, admin, or a buyer with a
  `succeeded` order, the same rule as `/:id/download`. Keeping it on one URL puts the
  entitlement decision on the server and means the planner needs **no ownership logic at
  load time** (which matters: `loadAssetCatalogue` registers assets *before* it fetches
  entitlements). `?variant=preview` forces the proxy. **No frontend change was needed.**
- **Cache lifetime dropped 3600s → 300s** on that route, with an ETag. The response is now
  viewer-dependent, so an hour-long cache would keep serving the proxy to someone who just
  bought the model. It can't go to `no-cache`: `previewRateLimit` is 150 requests / 15 min
  and a planner load is dozens of them, so reload bursts must still hit the browser cache.
- **The R2 key is random on purpose.** The bucket is public through the CDN and model ids
  are public, so `previews/<modelId>/full.glb` would have been a free, un-watermarked,
  full-resolution copy of every paid mesh. Keys are `owner-glb/<modelId>/<leaf>-<16 random
  bytes>.glb`, live only in `models.full_glb_path` / `model_parts.full_glb_path`, and are
  **never returned by any API** (not even in the ETag, which hashes them). Don't "helpfully"
  expose that column. Locking the bucket down is still the proper fix.
- **Backfill is required after deploying.** 041 only enqueues on new uploads and file-version
  replacements, so the existing catalogue would sit at `full_glb_status = NULL` forever:
  `railway run npm run backfill:full-glb -- --dry-run`, then without the flag. It queues
  most-sold-first and is safe to re-run.
- **`npm run test:fullglb`** proves the claim against the real service fn: on a mesh over
  the owner budget, the GLB decodes to no more than that budget (and to the exact source
  count when under it); the owner mesh stays meaningfully denser than the public preview;
  and the bbox survives decimation + Draco (0.00365% drift on a 307k-tri fixture, decimated
  to 240k → 4.70 MB).
- **Untested against a real Postgres:** there is no local DB (dev is `DB_MOCK`), so migration
  041 and the queue SQL have not actually been executed. Watch the first Railway deploy.
- **`FULL_GLB_MAX_TRIS` is a MEMORY ceiling, and the guard runs before conversion.**
  Measured peak RSS of the real pipeline: **307k tris → 419 MB, 614k → 704 MB, 1.23M →
  1318 MB** — about **1.1 KB of RSS per source triangle**, near-linear, at only ~8.6s even
  at 1.23M. So time isn't the constraint, memory is. Default is **1M ≈ 1.1 GB peak**; size it
  to whatever is building (the bake worker, or the API server itself when the inline drainer
  is on, where a 1 GB spike is far worse). The cap is checked from the **binary STL header**
  before anything is parsed — checking it after conversion, which the first cut did, guards
  nothing: the OOM happens *during* the conversion, the container dies mid-job, the row sits
  `running` until the stale lock expires, and the retry OOMs identically — which would take
  out the preview bakes this queue is supposed to stay out of the way of.
- **Known cost, accepted:** even a lightly-decimated dense mesh is heavier to raster than
  the public preview. Instancing shares the geometry, so N copies of one piece cost one
  upload, but an owner filling a table with many outlier-dense models will still see more
  framerate cost than a non-owner viewing the same table.

### Owner GLB given a light decimation budget (2026-08-31)
Originally this pipeline applied **zero** decimation regardless of source size — a genuine
"every triangle" full-fidelity copy. That meant an artist who uploaded a very dense mesh (up
toward the `FULL_GLB_MAX_TRIS` memory ceiling, ~1M tris) handed every owner of it the full
weight on their planner table, with no ceiling on the render cost. Changed so the owner tier
is now **capped at `OWNER_GLB_TARGET_TRIS`** (default 3× the public preview's budget) and only
decimated at all above that — using the same `weld → simplify → crease-normals → weld/dedup`
shape as the preview converter, just with a far tighter error bound (`FULL_GLB_SIMPLIFY_ERROR`,
default 0.001 vs the preview's 0.004) so the trim is close to invisible. **No watermark either
way** — that was already true and is unaffected. The overwhelming majority of listings are
still well under the new budget and get literally unchanged, full-fidelity treatment; this only
bites the outlier dense uploads that were the actual framerate risk. `FullGlbResult` /
`FullGlbBuildResult` now carry both `triangles` (what was actually written) and
`sourceTriangles` (the pre-decimation STL count) — the `FULL_GLB_MAX_TRIS` memory-ceiling check
in `build.ts`'s ASCII-STL backstop is checked against `sourceTriangles` (the number that
actually drove peak RSS), not the post-decimation count. `npm run test:fullglb` updated and
re-verified against the real `sandbags.stl` fixture (307k → 240k tris, 0.00365% bbox drift).
Backward compatible: an artist's existing owner GLBs stay as they are until the model is
re-uploaded / gets a new file version (or a backfill script is run) — nothing re-triggers a
rebuild on its own.

## On-screen PREVIEW watermark REMOVED from the planner (2026-08-30)
`scene/previewWatermark.ts` blended a tiled "ARTIFACT ARMOURY · PREVIEW" mark, in screen space,
over every marketplace piece the viewer didn't own. **It is gone** — file deleted, along with
`InstancedScene.setWatermarkPredicate`/`shouldWatermark` and the predicate wired up in
`ThreeStage.tsx`. Rationale: it duplicated protection the geometry already carries (the bake
emboss, the decimation, the stripped interior/underside faces that make a ripped proxy
unprintable) and the per-buyer AES watermark in the STL header, while making the planner look
worse than the product it sells. **No claim anywhere depended on it** — `CreatorProtection.tsx`
promises the proxy is *unprintable*, never that it is visibly marked, so that page stayed true
as written; check it again before reinstating or removing any other protection.

## "Previews aren't your final print" popup (built 2026-08-30)
The planner draws a decimated proxy, which reads to a buyer as "this model is low quality"
rather than "this is a preview". `ui/PreviewQualityNotice.tsx` shows the two side by side once,
with the explanation and an acknowledgement checkbox.
- **The images are real pipeline output, not a mock-up** (generated 2026-08-30), at
  `frontend/public/assets/preview-quality/{planner-preview,stl-detail}.png`; paths are the
  exported `PREVIEW_IMG`/`STL_IMG` constants at the top of the component. A missing file
  renders a labelled placeholder naming the expected path, **not** a broken image. Source:
  `top.stl` (2,064,876 tris) through the **actual** `convertSTLtoGLB` (→80k, a 26× cut) and
  `convertSTLtoGLBFull` (→2.06M), rendered in Three.js with `ThreeStage.tsx`'s exact lighting,
  identical camera, whole model in frame. Method + "if you replace these" rules are in that
  folder's `README.md`. **Smooth models don't work** — sandbags/barrel were tried and the two
  shots came out nearly identical (and anything under the 80k budget isn't decimated at all).
- **KNOWN LIMITATION: at the ~215px the popup renders them, the two shots read as identical.**
  A whole-model view of a 26× decimation simply doesn't resolve at thumbnail size — the
  differences (rivet crispness, faceting on the circular vents, plank-line fineness) only
  appear around 600px+. An earlier cropped-in pair *did* read at thumbnail size but showed a
  wall detail rather than a model. If this needs to land visually, the options are a
  click-to-enlarge, a magnified inset beside the whole-model shot, or a wider modal — none
  are built.
- **The checkbox is what persists the dismissal.** `Got it` is disabled until it's ticked and
  writes `aa_planner_preview_quality_ack_v1`; Esc / the X close for this session only, so
  nobody is trapped in a modal and nobody is silently recorded as having understood it.
- **Timing avoids modal pile-up.** The first-visit effect waits for `sceneReady` and holds off
  while `tourActive` or `showHelp` is up (the buyer/artist walkthroughs already fire on first
  visit), then opens 600ms later against a table the user can actually see.
- Re-openable any time from **Help → "Preview vs print"** (`onShowPreviewQuality` prop on
  `HelpOverlay`); its backdrop is z-index 45 so it sits above the help overlay's 40.
- Verified in-browser: auto-opens on first visit, button stays disabled until ticked, closes and
  persists, does not reappear after reload, re-opens from Help, and the 4:3 frames lay out
  correctly with real images in place.

## Planner on tablets (built 2026-08-23)
The planner was **hard-gated to ≥1024px** (`pages/Planner.tsx`) and had **zero touch
handling** — a touch pointer always reports `button === 0` and never fires `wheel`, so
`BuilderCamera`'s right-drag/middle-drag/wheel handlers could never see it: on an iPad the
camera was frozen solid. Touch is now a **separate input path**, so no desktop control changed:
- **Gestures** (`scene/BuilderCamera.ts`): fingers are tracked in a `touches` map. **Two**
  fingers = pinch → zoom (via the extracted `zoomToward()`, shared with the wheel), twist →
  orbit, vertical drag → pitch. Mouse buttons keep their exact handlers.
- **One finger** (`scene/ThreeStage.tsx`): tap = place/select (the existing `maybe`/`maybePlace`
  movement threshold already distinguishes tap from drag), drag on a **piece** = move it (as on
  desktop), drag on **empty table** = pan the camera (`kind:'pan'` → `cam.panByScreenDelta`).
  Box-select is desktop-only. A second finger sets `gestureLatch`, cancels the in-flight drag
  (**and closes any terrain stroke**), and suppresses the trailing tap until all fingers lift;
  `pointercancel` resets everything (iOS steals touches).
- **On-screen controls**: rotate / place-level / delete have no finger equivalent, so a
  `.tb-touchbar` cluster renders **only** when `matchMedia('(pointer: coarse)')` matches
  (`ui/useDeviceLayout.ts`). Driven by a new store `stageApi` (`rotate`, `nudgeLevel`) that
  ThreeStage registers alongside `cameraApi`. Help overlay swaps to a gesture reference.
- **Compact layout** (`≤1100px`): the fixed 250px palette / 270px basket become **drawers**
  behind edge handles (one open at a time; picking a model closes it). `≤760px` they go full
  width. Touch bumps every icon button to 44px. The width gate is now **640px** — tablets in,
  phones still out.
- **Untested on real hardware**: synthetic pointer events verified the handlers run clean and
  the layout was checked at 1440/1024/700px, but multi-touch was never exercised on a device.

## Contact page (built 2026-08-29, migration 043)
The Contact page (`frontend/src/pages/Contact.tsx`) was a static "email us" stub — now a real
form: name, email, subject, message, and up to 5 file attachments, open to anonymous visitors
(pre-filled from the account if signed in). Mirrors the `routes/reports.ts` proof-upload pattern.
- **Backend** `routes/contact.ts`, mounted at `/api/contact`, both endpoints on `optionalAuth`
  (works signed-out or in): `POST /presign-attachment` (rate-limited via `uploadRateLimit`) signs
  an R2 PUT under the `contact/` prefix for images/PDF/zip/txt; `POST /` (rate-limited via
  `emailRateLimit`, 3/hour/IP-or-user) validates the fields, **writes the message to
  `contact_messages` + `contact_message_attachments` first**, then emails support — the DB write
  happens before the email send so a message survives even if Resend is down or misconfigured
  (`services/email.ts`'s `sendEmail()` logs and swallows failures by design, it never throws).
- **Email** (`services/email.ts`): `sendContactMessageToSupport` → `SUPPORT_EMAIL` (env, defaults
  `support@artifactarmoury.com`) with `reply_to` set to the sender's own address, so support can
  just hit Reply; `sendContactConfirmation` → a courtesy "we got it" reply to the sender. `sendEmail`
  gained a `replyTo` param (maps to Resend's `reply_to` field — **not** `replyTo`, that's silently
  ignored by the SDK's types).
- **Attachments** are served straight off the public R2 CDN via `publicUrl(key)` in the email body
  (same trust model as `model_report_attachments`: the bucket is public through the CDN, so the
  32-hex-char random key is what keeps them unguessable — no signed download URL needed).
- **No admin inbox built** — messages are queryable via `npm run db:query` if needed
  (`SELECT * FROM contact_messages ORDER BY created_at DESC`); a dashboard is a follow-up if
  volume ever justifies it.
- **Known DB_MOCK-only crash**: `POST /api/contact` 500s in local dev (`DB_MOCK=true`) because the
  mock `db.query()` returns `{rows:[]}` for the `INSERT ... RETURNING id`, so `r.rows[0].id` throws
  — the exact same shape as the pre-existing gap in `routes/reports.ts`. Confirmed harmless against
  a real DB: this is a mock-only artifact, not a bug in the new route. Verified in-browser: form
  renders, client + server validation both fire correctly (empty required field, <10-char message),
  the request reaches the backend and gets rejected/accepted as expected, and `/presign-attachment`
  round-trips a real signed R2 PUT URL under `contact/` using the project's live R2 credentials.

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
  to `PREVIEW_TARGET_TRIS`=150k, error 0.004) → **crease-angle normals**
  (`PREVIEW_CREASE_ANGLE`=45° — pure smooth normals over-softened models; crease
  keeps hard edges crisp) → re-weld/dedup → **Draco** compress. (First pass used 60k
  + smooth normals; user found it lost too much detail + too smooth, hence 150k +
  crease.) sandbags 307k→150k tris (~3MB GLB). New deps:
  `@gltf-transform/functions`+`/extensions`,
  `meshoptimizer`, `draco3dgltf`. The **STL buyers download/print is untouched** —
  only the preview changes (now smooth-shaded, slightly decimated). Draco is safe
  because the ONLY consumer of these GLBs is the planner's `loaders.ts` (DRACOLoader
  wired, decoder at `/draco/`); marketplace pages use PNG thumbnails, and
  `assets.ts loadGLTFScene` (bare loader, no Draco) is dead code. Existing models
  need a **re-upload** to regenerate the optimised GLB (same re-upload also fixes
  orientation). Tune via `PREVIEW_TARGET_TRIS`.
- **Per-model footprint mask (planner):** placement/stacking used each piece's
  bounding-box rectangle, so placing a piece anywhere in a model's square (beside it,
  or in an L-corner's opening) made it stack. Now `core/footprintMask.ts` rasterizes
  each model's top-down silhouette into a 64² bitmap (computed from GLB geometry in
  `loaders.ts` at load), derives a per-cell mask at the current grid size + rotation
  (rotation is correct-by-construction: cell centres rotated by the same Y-matrix the
  mesh uses; validated on an L-shape), and `footprintCellsFor()` returns only covered
  cells (offsets cached per asset|grid|rot for perf). Wired into `placedCells`
  (elevation → surfaceTop/collision) and `ghostCells` (ThreeStage). Falls back to the
  full rectangle while the GLB loads or for degenerate masks. Validated on STLs:
  floor→full, barrel→filled disc (empty bbox corners), sandbags→solid. KNOWN cosmetic:
  the green/red `cellHi` placement highlight still draws the bbox square, not the mask
  shape (follow-up).
- **Per-account + collaborative planner DONE (share-link → edit-a-copy):** the 3D
  planner now loads/saves via the account-scoped **tables API** instead of
  `localStorage`. `App.tsx` takes `{ tableId?, shareToken? }`; a load effect fetches
  (`tablesApi.getById` / `getSharedTable`), maps the server shape via new
  `state/tableMapping.ts` (`serializeLayout`/`deserializeLayout` ↔ `table_config` +
  `layout_data.models`, incl. `pitchDeg`/`level`), and applies it via a new store
  action `applyLayout`. **Save** (`handleSave`): guests → toast + `/login`; owner of a
  loaded table → `updateTable`; new/scratch or a shared copy → `createTable` then
  navigate to `/planner/t/:id` (and it becomes owned). Routes: `/planner` (scratch),
  `/planner/t/:id` (edit own), `/planner/s/:token` (open a shared table as an editable
  copy). `Planner.tsx` reads params→props; `EditTable` passes its `:id`. `MyTables.tsx`
  now lists the user's server tables (Open → `/planner/t/:id`, **Share link** — makes it
  public + copies `…/planner/s/:token`, Delete). Backend `user_tables` API is
  **email-based** (trusts `user_email` in body/query — pre-existing; a JWT-auth
  hardening is a good follow-up). Frontend typechecks clean.
- **Model stacking (planner):** the planner already auto-rests pieces on the surface
  under the cursor, but `surfaceTop` only counted modular tiles with
  `elevation.heightUnits` — uploaded models (no metadata) contributed 0, so they
  never stacked. Added `surfaceUnits(asset)` in `core/elevation.ts` that falls back
  to real height (`aabb.y / LEVEL_HEIGHT`, fractional) for models without metadata;
  `surfaceTop`/`occupyUnits` use it. Now placing a model over another auto-stacks on
  its **exact** top (base level is fractional → `levelToY` gives the exact Y; only the
  collision grid rounds, so visuals are pixel-perfect). Side-by-side / open-corner
  placement is unaffected (different footprint cells). To bury/intersect instead,
  PageDown (+ hold Alt to permit overlap). `placementLevel` badge now rounds.
- **Login fixes:** `Login.tsx` never redirected after a successful sign-in (Register
  did) — added `navigate('/')`. And there were **two `<Toaster>`s** (app.tsx root +
  MainLayout) — duplicate react-hot-toast Toasters run conflicting dismiss timers so
  toasts wouldn't auto-dismiss; removed the MainLayout one (keep exactly one at the
  app root). (The planner-footprint "can't place inside an L-corner" request was
  dropped — holding **Alt** already allows free/overlapping placement; it's a
  tutorial/discoverability gap, not a bug.)
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
