// src/scene/previewWatermark.ts
//
// A visible "preview" watermark tiled across model surfaces in the planner, for
// pieces the viewer hasn't bought. It's a deterrent for casual screenshot/mesh
// theft — the paid STL is separately watermarked + entitlement-gated; this just
// makes the free on-screen preview obviously a preview.
//
// Implementation: a repeating text canvas texture, blended in *screen space*
// (gl_FragCoord) into each model material's final colour via onBeforeCompile — so
// the mark sits on the model (not a flat HTML overlay) and tiles regardless of the
// mesh's UVs (uploaded meshes have none). Materials are cloned so the shared,
// cached template materials are never mutated.
//
// The tile is a 2-up strip: the left half is stamped "cut in" (engraved — shadow
// on the light side, highlight on the dark side, reading as a sunken mark) and the
// right half "raised" (embossed — highlight/shadow reversed, reading as a bump on
// the surface). Because the strip repeats, the two treatments alternate every
// other watermark across the model instead of a single flat repeated stamp.

import * as THREE from 'three'

let _tex: THREE.CanvasTexture | null = null

const TILE = 340 // one watermark cell, in canvas px
// Screen-space repeat period (device px) for one TILE-sized cell — matches the
// original single-tile watermark's on-screen scale.
const CELL_PX = 110

type Bevel = 'engraved' | 'raised'

function drawBeveledLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  dy: number,
  fontPx: number,
  bevel: Bevel,
) {
  ctx.font = `bold ${fontPx}px Arial, sans-serif`
  const offset = 2.5
  const highlight = bevel === 'raised' ? -offset : offset // top-left for raised, bottom-right for engraved
  const shadow = bevel === 'raised' ? offset : -offset

  // Shadow stroke first (the side facing away from the "light").
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillText(text, shadow, dy + shadow)
  // Highlight stroke (the side facing the "light").
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.fillText(text, highlight, dy + highlight)
  // Flat mid-tone fill on top so the mark still reads as legible text, not just a
  // pair of offset strokes.
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(text, 0, dy)
}

/** Paint one watermark cell, centred at (cx, cy), in either bevel style. */
function paintCell(ctx: CanvasRenderingContext2D, cx: number, cy: number, bevel: Bevel) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-Math.PI / 6) // diagonal
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  drawBeveledLine(ctx, 'ARTIFACT ARMOURY', -18, 30, bevel)
  drawBeveledLine(ctx, '· PREVIEW ·', 16, 22, bevel)
  ctx.restore()
}

/** Build (once) a tiled, alternating engraved/embossed "PREVIEW" texture. */
function watermarkTexture(): THREE.CanvasTexture {
  if (_tex) return _tex
  const c = document.createElement('canvas')
  c.width = TILE * 2
  c.height = TILE
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  paintCell(ctx, TILE * 0.5, TILE * 0.5, 'engraved')
  paintCell(ctx, TILE * 1.5, TILE * 0.5, 'raised')
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.needsUpdate = true
  _tex = tex
  return tex
}

// Cache one watermarked variant per source material so we don't recompile shaders
// or leak clones across rebuilds. Keyed by the original material's uuid.
const cache = new Map<string, THREE.Material>()

function wrapOne(base: THREE.Material): THREE.Material {
  const existing = cache.get(base.uuid)
  if (existing) return existing

  const mat = base.clone()
  const tex = watermarkTexture()
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWatermark = { value: tex }
    shader.fragmentShader =
      'uniform sampler2D uWatermark;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          // The tile strip is 2x1 cells (engraved | raised) so the x period covers
          // both; the alternating pair repeats every ~220px in device pixels.
          vec4 aaWm = texture2D(uWatermark, gl_FragCoord.xy / vec2(${(CELL_PX * 2).toFixed(1)}, ${CELL_PX.toFixed(1)}));
          // Blend toward the mark's own colour (white highlight / black shadow)
          // rather than a flat tint, so the bevel actually reads as relief.
          gl_FragColor.rgb = mix(gl_FragColor.rgb, aaWm.rgb, aaWm.a * 0.6);
        }`,
      )
  }
  // Distinct program cache key so it doesn't collide with the un-watermarked variant.
  ;(mat as any).customProgramCacheKey = () => 'aa-preview-watermark'
  mat.needsUpdate = true
  cache.set(base.uuid, mat)
  return mat
}

/** Return a watermarked clone of a material (or per-element for a material array). */
export function watermarkedMaterial(
  base: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  return Array.isArray(base) ? base.map(wrapOne) : wrapOne(base)
}

/** Free cached watermark materials (call when tearing the scene down). */
export function disposeWatermarkMaterials(): void {
  for (const m of cache.values()) m.dispose()
  cache.clear()
}
