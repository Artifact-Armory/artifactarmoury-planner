import type { Table } from '../state/store'
import { type Heightmap, terrainDims, MAX_HEIGHT, MIN_HEIGHT, isFlat, sampleHeight, heightmapFitsTable } from './heightmap'
import { type TerrainPath, applyTerrainPaths } from './terrainPaths'

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

/** Authoritative surface evaluation in editor metres, shared by preview and manufacturing. */
export function evaluateTerrainHeight(features: TerrainFeature[], paths: TerrainPath[], detail: Heightmap | null, table: Table, terraceStep: number, x: number, z: number): number {
  return terraceHeight(applyTerrainPaths(paths, featuresHeightAt(features, x, z) + sampleHeight(detail, table, x, z), table, x, z), terraceStep)
}

export const TERRACE_STEPS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Off (smooth)' },
  { value: 0.005, label: 'Fine (5mm)' },
  { value: 0.01, label: 'Medium (10mm)' },
  { value: 0.02, label: 'Coarse (20mm)' },
]

export interface TerrainBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export function featureBounds(f: TerrainFeature): TerrainBounds {
  return { minX: f.x-f.radius, maxX: f.x+f.radius, minZ: f.z-f.radius, maxZ: f.z+f.radius }
}
export function unionBounds(a: TerrainBounds, b: TerrainBounds): TerrainBounds {
  return { minX: Math.min(a.minX,b.minX), maxX: Math.max(a.maxX,b.maxX), minZ: Math.min(a.minZ,b.minZ), maxZ: Math.max(a.maxZ,b.maxZ) }
}
export function pathBounds(p: TerrainPath, table: Table): TerrainBounds {
  // Edge paths offset whole regions, including beyond their endpoints.
  if (p.kind === 'cliff' || p.kind === 'shoreline') return { minX:-table.width/2,maxX:table.width/2,minZ:-table.height/2,maxZ:table.height/2 }
  const radius=p.channelWidth/2+p.bermWidth+Math.max(0.01,p.bermWidth)
  return { minX:Math.min(...p.points.map(v=>v.x))-radius,maxX:Math.max(...p.points.map(v=>v.x))+radius,minZ:Math.min(...p.points.map(v=>v.z))-radius,maxZ:Math.max(...p.points.map(v=>v.z))+radius }
}
export function gridBounds(hm: Heightmap, table: Table, b: TerrainBounds, halo=0) {
  return {
    i0:Math.max(0,Math.floor((b.minX+table.width/2)/table.width*(hm.cols-1))-halo),
    i1:Math.min(hm.cols-1,Math.ceil((b.maxX+table.width/2)/table.width*(hm.cols-1))+halo),
    j0:Math.max(0,Math.floor((b.minZ+table.height/2)/table.height*(hm.rows-1))-halo),
    j1:Math.min(hm.rows-1,Math.ceil((b.maxZ+table.height/2)/table.height*(hm.rows-1))+halo),
  }
}

/** Sample the semantic surface into the interactive height cache. Hard-face rendering and export use the boundary-aware mesh builder. */
export function compositeHeightmap(
  features: TerrainFeature[],
  paths: TerrainPath[],
  detail: Heightmap | null,
  table: Table,
  terraceStep: number,
  update?: { target: Heightmap | null; bounds: TerrainBounds },
): Heightmap | null {
  if (!update && features.length === 0 && paths.length === 0 && (!detail || isFlat(detail))) return null

  const { cols, rows } = terrainDims(table)
  const reuse = update && heightmapFitsTable(update.target,table)
  const heights = reuse ? update.target!.heights : new Float32Array(cols * rows)
  const bounds = reuse ? gridBounds({cols,rows,heights},table,update.bounds) : {i0:0,i1:cols-1,j0:0,j1:rows-1}
  for (let j = bounds.j0; j <= bounds.j1; j++) {
    const z = -table.height / 2 + (j / (rows - 1)) * table.height
    for (let i = bounds.i0; i <= bounds.i1; i++) {
      const x = -table.width / 2 + (i / (cols - 1)) * table.width
      const idx = j * cols + i
      heights[idx] = evaluateTerrainHeight(features, paths, detail, table, terraceStep, x, z)
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
