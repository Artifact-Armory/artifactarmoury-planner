# Table Surface Textures — CC0 Sourcing Guide

The planner's table material system ([tableMaterials.ts](frontend/src/table-top-terrain-builder/src/core/tableMaterials.ts))
is **live now** with procedural placeholder albedo, so the picker works without any
downloads. To upgrade a material to full PBR, drop a real CC0 set into R2 and flip one flag.

## License rule (commercial site)
Use **CC0 only** — public domain, free for commercial use, no attribution required.
- **Poly Haven** — https://polyhaven.com/textures (all CC0)
- **ambientCG** — https://ambientcg.com (all CC0)
- **CGBookcase** — https://cgbookcase.com (CC0) — only if a look is missing above

❌ Do **not** use CC-BY / NC / ND / SA or any non-CC0 texture. If you source from
anywhere else, verify the license is CC0 **before** committing/uploading.

## Maps to grab (per material)
Download the full PBR set and keep at least: **albedo/diffuse, normal, roughness, AO**
(grab displacement too if offered). The material wires all four — not just colour.

## Suggested CC0 sources per material
Verify the exact current slug on the site (names occasionally change); all are CC0.

| Material | ambientCG | Poly Haven |
|---|---|---|
| `grass` | `Grass001`, `Grass004` | `aerial_grass_rock`, `brown_mud_leaves_01` |
| `sand`  | `Ground033`, `Sand002` | `sand_01`, `desert_sand` |
| `wood`  | `WoodFloor043`, `Planks011` | `wood_planks`, `wooden_planks_*` |
| `snow`  | `Snow006`, `Snow002` | `snow_02`, `snow_field_aerial` |
| `stone` | `Rock035`, `PavingStones070` | `cobblestone_floor_*`, `rock_ground` |

ambientCG download (example): the **1K-JPG** zip from
`https://ambientcg.com/view?id=Grass001` → contains `*_Color.jpg`, `*_NormalGL.jpg`,
`*_Roughness.jpg`, `*_AmbientOcclusion.jpg`. Use the **GL** normal (Three.js is OpenGL-style).

## Downscale before storing (1K–2K)
Table surfaces tile over a wide area and are rarely seen close-up, so 1K/2K is plenty —
keeps repo + R2 storage/egress small.

```bash
# ImageMagick — resize a folder of source maps to 2048px JPG, q85
mkdir -p out
for f in *.jpg *.png; do
  magick "$f" -resize 2048x2048 -quality 85 "out/${f%.*}.jpg"
done
```

## Naming + layout in R2
Store **one tileable set per material** (not per table size) under the shared asset CDN,
alongside the GLB catalogue:

```
<R2_BUCKET>/textures/<id>/albedo.jpg
                         /normal.jpg
                         /roughness.jpg
                         /ao.jpg
```
`<id>` ∈ `grass | sand | wood | snow | stone`. The frontend reads
`${VITE_ASSET_BASE_URL}/textures/<id>/<map>.jpg`.

## Upload (reuses the Part B R2 script)
```bash
# after resizing into ./textures/grass/{albedo,normal,roughness,ao}.jpg etc.
cd backend
npm run upload:r2 -- ../path/to/textures textures   # uploads dir → r2://textures/...
```
(See [R2_SETUP.md](R2_SETUP.md) for the script + the env vars it needs.)

## Flip the material to PBR
In [tableMaterials.ts](frontend/src/table-top-terrain-builder/src/core/tableMaterials.ts),
set `pbr: true` on each material once its four maps are uploaded:

```ts
{ id: 'grass', label: 'Grass', color: 0x4a6b32, roughness: 0.95, speckle: 26, pbr: true },
```

With `pbr: true` **and** `VITE_ASSET_BASE_URL` set, the material loads the real maps from
the CDN; otherwise it keeps the procedural placeholder. No code changes beyond the flag.
