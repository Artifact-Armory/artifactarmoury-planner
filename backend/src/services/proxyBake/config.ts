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
  /** Smoothing passes applied to the proxy to REMOVE printable surface relief
   *  (the anti-theft core). The detail is re-added as a normal map, which printers
   *  ignore — so the geometry a thief rips is a smooth blob. 0 disables smoothing
   *  (the old, broken behaviour where the proxy kept all its detail). */
  proxySmoothIterations: number
  /** Per-iteration smoothing factor (0..1) for the smooth modifier. Higher = flatter. */
  proxySmoothFactor: number
  /** Emboss a watermark string into the PREVIEW proxy GEOMETRY so a mesh-rip carries
   *  it (a naive print is spoiled; the letters must be manually removed). The paid
   *  STL is never touched — only the preview proxy. */
  embossWatermarkEnabled: boolean
  /** The text embossed into the proxy (e.g. "ARTIFACT ARMOURY · PREVIEW"). */
  embossWatermarkText: string
  /** Text cap height as a % of the model's smaller horizontal footprint dimension. */
  embossHeightPct: number
  /** Emboss thickness (how far the letters stand PROUD of the wall) as a % of the
   *  bbox diagonal. */
  embossDepthPct: number
  /** How far the emboss text plane is inset INWARD from the bbox side, as a % of the
   *  bbox diagonal. The band wraps the bottom edge on all four sides; the inset (plus
   *  the extrude) is what lets the boolean bite a wall standing back from the bbox
   *  extreme, so the mark reliably fuses to real geometry. */
  embossInsetPct: number
  /** Cut the text INTO the surface (engrave) instead of raising it. */
  embossEngrave: boolean
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

/** Parse a numeric env var, or undefined if unset/blank/non-numeric. */
function envNum(name: string): number | undefined {
  const v = process.env[name]
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Read (and cache) the global defaults file, then apply any env-var overrides.
 * The env overrides let us tune the worker live (a Railway variable change +
 * redeploy) without rebuilding the Docker image — handy for dialling in quality.
 */
export function loadDefaults(): ProxyBakeConfig {
  if (cachedDefaults) return cachedDefaults
  const raw = fs.readFileSync(DEFAULTS_PATH, 'utf8')
  const base = JSON.parse(raw) as ProxyBakeConfig
  const envOverrides: Partial<Record<keyof ProxyBakeConfig, number | undefined>> = {
    triangleBudget: envNum('PROXY_BAKE_TRIANGLE_BUDGET'),
    proxySmoothIterations: envNum('PROXY_BAKE_SMOOTH_ITERS'),
    proxySmoothFactor: envNum('PROXY_BAKE_SMOOTH_FACTOR'),
    embossHeightPct: envNum('PROXY_BAKE_EMBOSS_HEIGHT_PCT'),
    embossDepthPct: envNum('PROXY_BAKE_EMBOSS_DEPTH_PCT'),
    embossInsetPct: envNum('PROXY_BAKE_EMBOSS_INSET_PCT'),
    normalMapRes: envNum('PROXY_BAKE_NORMAL_RES'),
    aoMapRes: envNum('PROXY_BAKE_AO_RES'),
    aoSamples: envNum('PROXY_BAKE_AO_SAMPLES'),
    bakeExtrusionPct: envNum('PROXY_BAKE_EXTRUSION_PCT'),
    maxRayDistancePct: envNum('PROXY_BAKE_MAX_RAY_PCT'),
  }
  for (const k of Object.keys(envOverrides) as (keyof ProxyBakeConfig)[]) {
    if (envOverrides[k] !== undefined) (base as any)[k] = envOverrides[k]
  }
  cachedDefaults = base
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
