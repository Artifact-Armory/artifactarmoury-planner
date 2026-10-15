// src/core/terrainFeatures.ts
//
// Landforms: editable shapes (hill / plateau / ridge) layered on top of the
// freehand sculpt heightmap ("detail"). The surface the scene renders is always
// a derived composite of the two — features are never baked into the detail
// layer, so a landform stays movable and resizable after it is placed.
//
// Ported from the planner topography lab (2026-10-15). The lab's route/edge
// paths, terracing and manufacturing compiler are not part of this port.

import type { Table } from '../state/store'
import { type Heightmap, terrainDims, MAX_HEIGHT, MIN_HEIGHT, isFlat, sampleHeight, heightmapFitsTable } from './heightmap'

export type TerrainFeatureType = 'hill' | 'plateau'

export interface TerrainFeature {
  id: string
  type: TerrainFeatureType
  /** World position (metres, table-centred), same frame as Instance.position. */
  x: number
  z: number
  /** Footprint half-length along the feature's local X (metres); fades to 0 here. */
  radius: number
  /** Peak height (metres) at the centre. Negative dips below the table. */
  height: number
  // Optional fields; missing = the original circular, additive landform.
  /** Footprint half-width along local Z (metres). Defaults to `radius`. */
  radiusZ?: number
  /** Yaw of the footprint, degrees. */
  rotationDeg?: number
  /** Fraction of the footprint (0..0.9) held at full height. Defaults by type. */
  flatTop?: number
  /** 'merge' joins other merged landforms by max/min; 'add' sums. Default 'add'. */
  blend?: 'add' | 'merge'
}
export type TerrainFeaturePatch = Partial<Omit<TerrainFeature, 'id' | 'type'>>

/** Local footprint coordinates (u, v in -1..1) → world; shared by evaluation, picking and outlines. */
export function featurePoint(f: TerrainFeature, u: number, v: number) {
  const a = (f.rotationDeg ?? 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  const rz = f.radiusZ ?? f.radius
  return { x: f.x + u * f.radius * c - v * rz * s, z: f.z + u * f.radius * s + v * rz * c }
}

/** Normalised elliptical distance from the centre: 1 = footprint edge. */
export function featureDistance(f: TerrainFeature, x: number, z: number) {
  const a = (f.rotationDeg ?? 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  const dx = x - f.x, dz = z - f.z
  return Math.hypot((dx * c + dz * s) / f.radius, (-dx * s + dz * c) / (f.radiusZ ?? f.radius))
}

export const FEATURE_RADIUS_RANGE = { min: 0.04, max: 1.0 }
export const FEATURE_FLAT_TOP_MAX = 0.9

/** Drop non-finite values and clamp each field to its valid range. */
export function clampFeaturePatch(patch: TerrainFeaturePatch): TerrainFeaturePatch {
  const p = { ...patch }
  for (const key of ['x', 'z', 'radius', 'radiusZ', 'height', 'rotationDeg', 'flatTop'] as const)
    if (p[key] != null && !Number.isFinite(p[key])) delete p[key]
  for (const key of ['radius', 'radiusZ'] as const)
    if (p[key] != null) p[key] = Math.max(FEATURE_RADIUS_RANGE.min, Math.min(FEATURE_RADIUS_RANGE.max, p[key]!))
  if (p.height != null) p.height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, p.height))
  if (p.flatTop != null) p.flatTop = Math.max(0, Math.min(FEATURE_FLAT_TOP_MAX, p.flatTop))
  if (p.rotationDeg != null) p.rotationDeg = ((p.rotationDeg % 360) + 360) % 360
  if (p.blend != null && p.blend !== 'merge' && p.blend !== 'add') delete p.blend
  return p
}

/** How much of the footprint (from the centre out) stays at full height by default. */
export const FLAT_RATIO: Record<TerrainFeatureType, number> = {
  hill: 0,          // smooth dome, no flat top
  plateau: 0.55,    // flat tableland, then a slope down at the rim
}

export const FEATURE_DEFAULTS: Record<TerrainFeatureType, { radius: number; height: number; label: string }> = {
  hill: { radius: 0.3, height: 0.08, label: 'Hill' },
  plateau: { radius: 0.35, height: 0.06, label: 'Plateau' },
}

/** Ridge preset: a long, narrow hill with a slight crest. Same semantics as a hill. */
export const RIDGE_PRESET: TerrainFeaturePatch = { radius: 0.45, radiusZ: 0.14, height: 0.08, flatTop: 0.12 }

/** A hill stretched 2:1 or more reads as a ridge. */
export function featureLabel(f: TerrainFeature): string {
  const ratio = f.radius / (f.radiusZ ?? f.radius)
  return f.type === 'hill' && (ratio >= 2 || ratio <= 0.5) ? 'Ridge' : FEATURE_DEFAULTS[f.type].label
}

export function newFeatureId(): string {
  return `tf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function defaultFeature(type: TerrainFeatureType, x: number, z: number): TerrainFeature {
  const d = FEATURE_DEFAULTS[type]
  return { id: newFeatureId(), type, x, z, radius: d.radius, height: d.height }
}

/** This feature's height contribution (metres) at world (x, z); 0 outside its footprint. */
export function featureContribution(f: TerrainFeature, x: number, z: number): number {
  const d = featureDistance(f, x, z)
  if (d >= 1) return 0
  const flat = f.flatTop ?? FLAT_RATIO[f.type]
  if (d <= flat) return f.height
  const t = (d - flat) / (1 - flat)
  // Smoothstep falloff: 1 at the flat edge → 0 at the rim, no gradient discontinuity.
  return f.height * (1 - t * t * (3 - 2 * t))
}

/**
 * Combined landform height at world (x, z). Merged landforms take the highest
 * rise and deepest dip, so overlapping hills join instead of stacking; additive
 * ones (including every landform saved before `blend` existed) are summed on top.
 */
export function featuresHeightAt(features: TerrainFeature[], x: number, z: number): number {
  let h = 0, raised = 0, lowered = 0
  for (const f of features) {
    const value = featureContribution(f, x, z)
    if (f.blend === 'merge') { raised = Math.max(raised, value); lowered = Math.min(lowered, value) }
    else h += value
  }
  return h + raised + lowered
}

/** Authoritative surface height (metres) = landforms + freehand detail. */
export function evaluateTerrainHeight(features: TerrainFeature[], detail: Heightmap | null, table: Table, x: number, z: number): number {
  const d = heightmapFitsTable(detail, table) ? sampleHeight(detail, table, x, z) : 0
  return featuresHeightAt(features, x, z) + d
}

export interface TerrainBounds { minX: number; maxX: number; minZ: number; maxZ: number }

export function featureBounds(f: TerrainFeature): TerrainBounds {
  const a = (f.rotationDeg ?? 0) * Math.PI / 180, rz = f.radiusZ ?? f.radius
  const dx = Math.hypot(f.radius * Math.cos(a), rz * Math.sin(a))
  const dz = Math.hypot(f.radius * Math.sin(a), rz * Math.cos(a))
  return { minX: f.x - dx, maxX: f.x + dx, minZ: f.z - dz, maxZ: f.z + dz }
}

export function unionBounds(a: TerrainBounds, b: TerrainBounds): TerrainBounds {
  return { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) }
}

/** Grid index range covering world bounds (plus `halo` vertices). */
export function gridBounds(hm: { cols: number; rows: number }, table: Table, b: TerrainBounds, halo = 0) {
  return {
    i0: Math.max(0, Math.floor((b.minX + table.width / 2) / table.width * (hm.cols - 1)) - halo),
    i1: Math.min(hm.cols - 1, Math.ceil((b.maxX + table.width / 2) / table.width * (hm.cols - 1)) + halo),
    j0: Math.max(0, Math.floor((b.minZ + table.height / 2) / table.height * (hm.rows - 1)) - halo),
    j1: Math.min(hm.rows - 1, Math.ceil((b.maxZ + table.height / 2) / table.height * (hm.rows - 1)) + halo),
  }
}

/**
 * Sample landforms + detail into the height field the scene renders. With
 * `update`, only the vertices inside `bounds` are rewritten, in place, in the
 * existing target (so a drag doesn't reallocate or re-evaluate the whole table).
 * Returns null for a flat table with nothing on it (no update requested).
 */
export function compositeHeightmap(
  features: TerrainFeature[],
  detail: Heightmap | null,
  table: Table,
  update?: { target: Heightmap | null; bounds: TerrainBounds },
): Heightmap | null {
  const fittingDetail = heightmapFitsTable(detail, table) ? detail : null
  if (!update && features.length === 0 && (!fittingDetail || isFlat(fittingDetail))) return null
  // No landforms: the detail layer IS the surface (identical to pre-landform tables).
  if (!update && features.length === 0) return { ...fittingDetail!, heights: new Float32Array(fittingDetail!.heights) }

  const { cols, rows } = terrainDims(table)
  const reuse = update && heightmapFitsTable(update.target, table)
  const heights = reuse ? update!.target!.heights : new Float32Array(cols * rows)
  const b = reuse ? gridBounds({ cols, rows }, table, update!.bounds) : { i0: 0, i1: cols - 1, j0: 0, j1: rows - 1 }
  for (let j = b.j0; j <= b.j1; j++) {
    const z = -table.height / 2 + (j / (rows - 1)) * table.height
    for (let i = b.i0; i <= b.i1; i++) {
      const x = -table.width / 2 + (i / (cols - 1)) * table.width
      const idx = j * cols + i
      heights[idx] = featuresHeightAt(features, x, z) + (fittingDetail ? fittingDetail.heights[idx] : 0)
    }
  }
  return reuse ? update!.target : { cols, rows, heights }
}

export function cloneFeatures(features: TerrainFeature[]): TerrainFeature[] {
  return features.map((f) => ({ ...f }))
}

// ---- persistence (features are few + small, so plain JSON, no quantising) --

export function serializeFeatures(features: TerrainFeature[]): TerrainFeature[] | null {
  return features.length ? cloneFeatures(features) : null
}

/** Tolerant parse: drops anything malformed rather than failing the whole table. */
export function deserializeFeatures(data: any): TerrainFeature[] {
  if (!Array.isArray(data)) return []
  return data
    .map((f: any): TerrainFeature | null => {
      const type = f?.type
      if (type !== 'hill' && type !== 'plateau') return null
      const x = Number(f.x), z = Number(f.z), radius = Number(f.radius), height = Number(f.height)
      if (![x, z, radius, height].every(Number.isFinite) || radius <= 0) return null
      const out: TerrainFeature = {
        id: typeof f.id === 'string' && f.id ? f.id : newFeatureId(),
        type, x, z,
        radius: Math.max(FEATURE_RADIUS_RANGE.min, Math.min(FEATURE_RADIUS_RANGE.max, radius)),
        height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height)),
      }
      // Only carry optional fields that were actually stored, so an old landform
      // round-trips byte-for-byte and keeps its circular, additive behaviour.
      const optional = clampFeaturePatch({
        radiusZ: f.radiusZ == null ? undefined : Number(f.radiusZ),
        rotationDeg: f.rotationDeg == null ? undefined : Number(f.rotationDeg),
        flatTop: f.flatTop == null ? undefined : Number(f.flatTop),
        blend: f.blend === 'merge' || f.blend === 'add' ? f.blend : undefined,
      })
      for (const key of ['radiusZ', 'rotationDeg', 'flatTop', 'blend'] as const) {
        if (optional[key] !== undefined) (out as any)[key] = optional[key]
      }
      return out
    })
    .filter((f): f is TerrainFeature => f !== null)
}
