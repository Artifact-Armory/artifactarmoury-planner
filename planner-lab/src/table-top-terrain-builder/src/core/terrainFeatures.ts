// src/core/terrainFeatures.ts
//
// "Landforms" — the point-stamp layer of the hybrid terrain sculptor. A
// feature is a parametric shape (hill / plateau) placed at a world position
// with a radius and a height, kept as an editable, non-destructive list rather
// than baked straight into a height grid. That's the actual fix for why
// freehand brushing felt clunky: most of what a table needs is a small
// vocabulary of shapes, not 40 careful mouse dabs — and a stamp can be
// repositioned/resized after the fact instead of undo-redone into place.
//
// The ditch is NOT a circular stamp — it's a drawn polyline (click multiple
// points, Manor-Lords-road style) with raised banks instead of a dug pit, so
// it lives in terrainPaths.ts; compositeHeightmap() combines both layers.
//
// The detail brush (heightmap.ts) still exists as a *third*, additive layer
// on top, for final blending/roughening — see compositeHeightmap.
//
// Framework-free (pure data + math), same spirit as heightmap.ts, so this can
// ship to the backend later unchanged if tile export ever wants the feature
// list instead of (or alongside) the composited grid.

import type { Table } from '../state/store'
import { type Heightmap, terrainDims, MAX_HEIGHT, MIN_HEIGHT, isFlat } from './heightmap'
import { type TerrainPath, pathsHeightAt } from './terrainPaths'

export type TerrainFeatureType = 'hill' | 'plateau'

export interface TerrainFeature {
  id: string
  type: TerrainFeatureType
  /** World position (metres, table-centred), same frame as Instance.position. */
  x: number
  z: number
  /** Footprint radius (metres) — the shape fades to 0 contribution at this distance. */
  radius: number
  /**
   * Peak height (metres) at the centre. Positive for hill/plateau, negative for
   * depression — the sign IS the up/down direction, type mainly drives the
   * default value, the flat-top ratio, and the UI label/icon.
   */
  height: number
}

/** How much of the radius (from the centre out) stays at full height before falling off. */
const FLAT_RATIO: Record<TerrainFeatureType, number> = {
  hill: 0,          // smooth dome, no flat top
  plateau: 0.55,    // flat tableland, then a slope down at the rim
}

export const FEATURE_DEFAULTS: Record<TerrainFeatureType, { radius: number; height: number; label: string }> = {
  hill: { radius: 0.3, height: 0.08, label: 'Hill' },
  plateau: { radius: 0.35, height: 0.06, label: 'Plateau' },
}

export const FEATURE_RADIUS_RANGE = { min: 0.08, max: 1.0, step: 0.01 }
export const FEATURE_HEIGHT_RANGE = { min: MIN_HEIGHT, max: MAX_HEIGHT, step: 0.005 }

export function newFeatureId(): string {
  return `tf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function defaultFeature(type: TerrainFeatureType, x: number, z: number): TerrainFeature {
  const d = FEATURE_DEFAULTS[type]
  return { id: newFeatureId(), type, x, z, radius: d.radius, height: d.height }
}

/** This feature's height contribution (metres) at world (x, z); 0 outside its radius. */
export function featureContribution(f: TerrainFeature, x: number, z: number): number {
  const d = Math.hypot(x - f.x, z - f.z) / f.radius
  if (d >= 1) return 0
  const flat = FLAT_RATIO[f.type]
  if (d <= flat) return f.height
  const t = (d - flat) / (1 - flat)
  // Smoothstep falloff: 1 at the flat edge → 0 at the rim, no gradient discontinuity.
  const s = 1 - t * t * (3 - 2 * t)
  return f.height * s
}

/** Summed contribution of every feature at world (x, z), unclamped. */
export function featuresHeightAt(features: TerrainFeature[], x: number, z: number): number {
  let h = 0
  for (const f of features) h += featureContribution(f, x, z)
  return h
}

/** Snap a height to the nearest multiple of `step` (metres). step<=0 leaves it continuous. */
export function terraceHeight(h: number, step: number): number {
  if (step <= 0) return h
  return Math.round(h / step) * step
}

export const TERRACE_STEPS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Off (smooth)' },
  { value: 0.005, label: 'Fine (5mm)' },
  { value: 0.01, label: 'Medium (10mm)' },
  { value: 0.02, label: 'Coarse (20mm)' },
]

/**
 * Evaluate the final table surface = point stamps (additive) + ditch paths
 * (additive) + the freehand detail layer (additive) + optional terrace
 * quantisation, clamped to the printable range. Returns null for a table with
 * nothing authored at all (flat table — keeps the existing "no heightmap =
 * don't build a terrain mesh" fast path everywhere else untouched).
 *
 * `detail` must already be sized to `table` (heightmapFitsTable) if provided.
 */
export function compositeHeightmap(
  features: TerrainFeature[],
  paths: TerrainPath[],
  detail: Heightmap | null,
  table: Table,
  terraceStep: number,
): Heightmap | null {
  const hasDetail = !!detail && !isFlat(detail)
  if (features.length === 0 && paths.length === 0 && !hasDetail) return null

  const { cols, rows } = terrainDims(table)
  const heights = new Float32Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    const z = -table.height / 2 + (j / (rows - 1)) * table.height
    for (let i = 0; i < cols; i++) {
      const x = -table.width / 2 + (i / (cols - 1)) * table.width
      const idx = j * cols + i
      let h = featuresHeightAt(features, x, z) + pathsHeightAt(paths, x, z)
      if (hasDetail) h += detail!.heights[idx]
      h = terraceHeight(h, terraceStep)
      heights[idx] = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h))
    }
  }
  return { cols, rows, heights }
}

// ---- persistence (features are few + small, so plain JSON, no quantising) --

export function serializeFeatures(features: TerrainFeature[]): TerrainFeature[] | null {
  return features.length ? features : null
}

export function deserializeFeatures(data: any): TerrainFeature[] {
  if (!Array.isArray(data)) return []
  return data
    .map((f: any): TerrainFeature | null => {
      const type = f?.type
      // 'depression' was a same-session-only shape (circular, dug BELOW the
      // base — replaced by the ditch path system before anything real was
      // ever saved with it) — drop any stray one rather than render it wrong.
      if (type !== 'hill' && type !== 'plateau') return null
      const x = Number(f.x), z = Number(f.z), radius = Number(f.radius), height = Number(f.height)
      if (![x, z, radius, height].every(Number.isFinite) || radius <= 0) return null
      return { id: typeof f.id === 'string' && f.id ? f.id : newFeatureId(), type, x, z, radius, height }
    })
    .filter((f): f is TerrainFeature => f !== null)
}
