// backend/src/services/proxyBake/config.ts
//
// Configuration for the preview proxy bake pipeline. There is one set of global
// defaults (config/proxyBake.defaults.json) and optional per-model overrides
// stored on models.proxy_bake_config (thin geometry — blades, gaps between parts
// — often needs a tighter cage/ray distance than the default). loadBakeConfig
// deep-merges an override object over the defaults and returns the effective
// config that both the TS worker and the Blender script consume.

import fs from 'fs'
import path from 'path'

export interface ProxyBakeConfig {
  /** Target triangle count for the decimated proxy. */
  triangleBudget: number
  /** Baked tangent-space normal map resolution (kept PNG — see targetMaxFileMb note). */
  normalMapRes: number
  /** Baked ambient-occlusion map resolution. */
  aoMapRes: number
  /** Cycles samples for the AO bake (normal bakes need only 1). */
  aoSamples: number
  /** Cage extrusion, as a percentage of the bounding-box diagonal. */
  bakeExtrusionPct: number
  /** Max ray distance for selected-to-active baking, as a % of bbox diagonal. */
  maxRayDistancePct: number
  /** Proxy generation strategy. 'decimate' is default; the worker falls back to
   *  'voxel' automatically on pathological/non-manifold topology. */
  remeshStrategy: 'decimate' | 'voxel'
  /** Join multiple loose parts into one object before baking (records a warning). */
  joinLooseParts: boolean
  /** A base face points down when its normal Z is below this. */
  baseFaceZNormalThreshold: number
  /** A base face sits within this many mm of the minimum Z (the table). */
  baseFaceHeightMm: number
  /** Soft cap on the final GLB size (MB) — reported, used to flag near-misses. */
  targetMaxFileMb: number
  /** Hard cap on source complexity; above this the bake fails cleanly. */
  sourceTriangleCap: number
  /** Hard bake timeout (minutes); the worker kills Blender and fails the job. */
  bakeTimeoutMinutes: number
  /** BaseColor atlas resolution (only baked when the source has usable materials). */
  baseColorRes: number
  /** Square resolution of each validation render tile. */
  validationRenderPx: number
  /** Planner camera distances (metres) used for the three validation renders. */
  plannerMinCameraDistanceM: number
  plannerTypicalCameraDistanceM: number
  plannerFullTableCameraDistanceM: number
}

export type ProxyBakeConfigOverrides = Partial<ProxyBakeConfig>

const DEFAULTS_PATH =
  process.env.PROXY_BAKE_DEFAULTS_PATH ||
  path.resolve(process.cwd(), 'config/proxyBake.defaults.json')

let cachedDefaults: ProxyBakeConfig | null = null

/** Read (and cache) the global defaults file. */
export function loadDefaults(): ProxyBakeConfig {
  if (cachedDefaults) return cachedDefaults
  const raw = fs.readFileSync(DEFAULTS_PATH, 'utf8')
  cachedDefaults = JSON.parse(raw) as ProxyBakeConfig
  return cachedDefaults
}

/**
 * Effective config = defaults with any per-model overrides applied. Unknown keys
 * in the overrides are ignored; nullish override values fall back to the default.
 */
export function loadBakeConfig(overrides?: ProxyBakeConfigOverrides | null): ProxyBakeConfig {
  const defaults = loadDefaults()
  if (!overrides) return { ...defaults }
  const merged: ProxyBakeConfig = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof ProxyBakeConfig)[]) {
    const v = overrides[key]
    if (v !== undefined && v !== null) {
      // Types are validated at the DB/API boundary; here we trust the stored shape.
      ;(merged as any)[key] = v
    }
  }
  return merged
}
