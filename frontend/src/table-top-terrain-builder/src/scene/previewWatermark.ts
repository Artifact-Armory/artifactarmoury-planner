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

import * as THREE from 'three'

let _tex: THREE.CanvasTexture | null = null

/** Build (once) a tiled, semi-transparent "ARTIFACT ARMOURY · PREVIEW" texture. */
function watermarkTexture(): THREE.CanvasTexture {
  if (_tex) return _tex
  const size = 340
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  ctx.translate(size / 2, size / 2)
  ctx.rotate(-Math.PI / 6) // diagonal
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = 'bold 30px Arial, sans-serif'
  ctx.fillText('ARTIFACT ARMOURY', 0, -18)
  ctx.font = 'bold 22px Arial, sans-serif'
  ctx.fillText('· PREVIEW ·', 0, 16)
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
          // ~110px tiles in device pixels; alpha of the text drives the blend.
          vec4 aaWm = texture2D(uWatermark, gl_FragCoord.xy / 110.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.96), aaWm.a * 0.55);
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
