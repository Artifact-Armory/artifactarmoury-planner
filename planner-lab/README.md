# Planner Lab

A standalone copy of the Artifact Armoury 3D table planner, for long-term
tweaking without touching the real site. This folder is **not** part of the
`frontend/` build and Cloudflare Pages never sees it (its root dir is
`frontend`) — it's a completely separate Vite app living at the repo root,
with its own `package.json`, dev server, and dependencies.

## What's copied in here

- `src/table-top-terrain-builder/` — the planner itself, copied verbatim
  from `frontend/src/table-top-terrain-builder/`.
- `src/api/` — the full API client (`frontend/src/api/`), copied verbatim so
  the planner can load real models/bundles/orders/tables.
- `src/store/{authStore,cartStore,taxStore,onboardingStore}.ts` — copied
  verbatim so login, the shop basket, VAT-inclusive pricing, and the
  first-visit tours all behave exactly as they do on the live site.
- `src/components/common/Logo.tsx`, `src/components/taxonomy/FacetRail.tsx`,
  `src/components/help/{OnboardingTour,tourSteps}.tsx` — the handful of
  shared UI pieces the planner itself renders (the catalogue filter rail,
  the logo shown while loading, the guided tour).
- `src/config/features.ts`, `src/utils/cn.ts` — small shared utilities the
  above depend on.
- `src/index.css`, `postcss.config.js`, Tailwind v4 setup — copied so the
  planner (and FacetRail) render pixel-identical to production.
- `public/draco/` — the Draco decoder the planner's GLTFLoader needs.
- `public/assets/preview-quality/` — the two images the "previews aren't
  your final print" popup shows.

**Deliberately NOT copied**: the marketplace pages, header/nav, dashboard,
checkout, etc. `src/main.tsx` here mounts the planner directly inside just a
`<BrowserRouter>` + toast host — there's no site chrome around it.

## Data source: the REAL production backend

`.env` points `VITE_API_BASE_URL` at `https://api.artifactarmoury.com` and
`VITE_ASSET_BASE_URL` at the real CDN. That means:

- The catalogue, textures, and pricing you see are real production data.
- Logging in uses your real account against the real database.
- **Anything that writes** — saving/sharing a table, adding to the cart,
  checking out — is a real write against production. Be careful with
  destructive or purchase-y actions; this app has no `DB_MOCK` safety net.
- If you want a fully offline sandbox instead, point `.env` at a local
  backend (`cd backend && npm run dev`, which runs `DB_MOCK=true`) — the
  catalogue will just be empty since the mock returns no rows.

## Running it

```bash
cd planner-lab
npm install
npm run dev
```

Opens on **http://localhost:3100** (deliberately a different port from the
real frontend's :3000, so both can run side by side).

```bash
npm run typecheck
```

## Relationship to the real site

This is a fork, not a symlink — edits here never touch `frontend/`, and
`frontend/` deploys are completely unaffected by whatever happens in this
folder. If a change made here is worth keeping, port it back into
`frontend/src/table-top-terrain-builder/` (and whichever shared file it
touched) by hand; nothing here auto-syncs.

Being a fork also means it will drift: if `frontend/`'s planner or its
shared dependencies (the API client, the stores, `FacetRail`, etc.) change
after this copy was made, this folder won't pick that up automatically.
