# Artifact Armoury brand artwork

Master files for the logo, kept in the repo so the site's derived assets can be
regenerated without hunting through Google Drive.

| File | What it is |
|---|---|
| `artifact-armoury-master.svg` | The Illustrator export. **Source of truth** — every asset below is traced from this. 160×160 artboard, white fill. |
| `artifact-armoury-lockup-black.png` | Full stacked lockup, black, 3500×3000, transparent. For print and anywhere vector isn't accepted. |
| `artifact-armoury-lockup-white.png` | Same, white. Transparent, so it looks blank in a light image viewer — that's expected. |

## How the site uses it

The vector paths were lifted out of the master and inlined into
`frontend/src/components/common/Logo.tsx`, which fills everything with
`currentColor`. That one component covers every placement:

- `variant="mark"` — the A-triangle and compass star alone (square)
- `variant="wordmark"` — ARTIFACT / ARMOURY with its rules
- `variant="horizontal"` — mark left, wordmark right; used in the header, footer and dashboard sidebar
- `variant="lockup"` — the primary stacked lockup; used on the home hero and the auth pages

Colour comes from a text utility on the element (`text-foreground`,
`text-white`, …), so the same component works on the white marketplace chrome
and over the dark hero video.

Static copies live in `frontend/public/` for the places that need a URL rather
than a React component: `logo.svg`, `logo-white.svg`, `logo-mark.svg`,
`logo-mark-white.svg`, `favicon.svg` (adapts to the browser's colour scheme),
`apple-touch-icon.png` and `og-image.png`.

## Geometry, if you need to re-derive anything

Measured in the master's 160×160 coordinate space:

- mark (triangle + star): `x 48.3–112.1`, `y 28.1–91.7`
- wordmark (ARTIFACT, ARMOURY, both rules): `x 5.1–155.3`, `y 98.6–131.0`
