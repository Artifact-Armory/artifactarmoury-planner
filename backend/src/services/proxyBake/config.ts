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
  /** FLOOR on the decimated proxy's triangle count — the minimum target regardless
   *  of source complexity. Sources at/under this skip decimation entirely (unchanged
   *  from before adaptive budgeting). For anything above it, the actual target is
   *  computed adaptively from triangleRetainRatio/triangleBudgetCeiling (see
   *  bake_proxy.py's compute_adaptive_budget) — this field alone no longer decides
   *  the target for a dense source. A flat target hit detail-dense sources hardest
   *  (a 2.5M-tri architectural model was collapsing to a ~4.8% retain while a simple
   *  90k-tri tile kept 100%), so scaling by source size fixes the inversion. */
  triangleBudget: number
  /** Fraction of SOURCE triangles the adaptive budget targets for sources above the
   *  triangleBudget floor (default 0.22 = keep ~22%, raised 2026-08-18 from 0.09 —
   *  models were too aggressively decimated). Only takes effect once
   *  src_tris * triangleRetainRatio exceeds triangleBudget — typical/simple sources
   *  are unaffected and keep decimating to the flat floor as before. See
   *  bake_proxy.py's compute_adaptive_budget docstring for why the ceiling was NOT
   *  scaled up proportionally with this. */
  triangleRetainRatio: number
  /** Hard cap on the adaptive proxy triangle target, regardless of how large
   *  triangleRetainRatio * sourceTriangles gets. Protects the 20-min bake timeout
   *  and — since the worker is a single-threaded serial queue (proxyBakeWorker.ts)
   *  — protects every OTHER queued upload's wait time too, not just this one's.
   *  Default 300000, chosen deliberately BELOW what triangleRetainRatio=0.22 would
   *  imply for the densest known real source (~2.5M tris → ~490k) — that ratio has
   *  only been proven safe up to this ceiling; a prior 30%-retain/no-ceiling attempt
   *  on that same source did not complete in a reasonable time. Raise only after a
   *  real worker-side bake confirms a higher number stays comfortably under the
   *  timeout. */
  triangleBudgetCeiling: number
  /** Merge-by-distance threshold (mm) run on the imported source BEFORE decimate/
   *  smooth. STL has no shared-vertex topology — every triangle owns its own verts —
   *  so a model built from many separate touching shells (individual roof tiles,
   *  floor planks, etc.) imports as fully disconnected islands. DECIMATE followed by
   *  volume-preserving LaplacianSmooth is unstable on tiny disconnected islands: they
   *  can shrink/invert and scatter into fragments (shipped-as-"ready" on 2026-08-15's
   *  "Japan houses" mid/top parts — see incident notes). Welding fuses touching/
   *  near-coincident shells into one connected manifold first, so smoothing sees a
   *  normal mesh instead of hundreds of near-degenerate islands. 0 disables welding. */
  weldMergeDistanceMm: number
  /** Smoothing passes applied to the proxy to REMOVE printable surface relief
   *  (the anti-theft core). The detail is re-added as a normal map, which printers
   *  ignore — so the geometry a thief rips is a smooth blob. 0 disables smoothing
   *  (the old, broken behaviour where the proxy kept all its detail). */
  proxySmoothIterations: number
  /** Per-iteration smoothing factor (0..1) for the LEGACY plain Smooth modifier
   *  (only used when proxySmoothVolumePreserve is false). Higher = flatter. */
  proxySmoothFactor: number
  /** Use LaplacianSmooth WITH volume preservation instead of the plain Smooth
   *  modifier. Volume-preserving smoothing removes fine, printable surface relief
   *  without the shrinkage/corner-rounding that erodes the silhouette — and a normal
   *  map can fake surface detail but never a silhouette, so this is what keeps the
   *  proxy looking like the product. Default true. */
  proxySmoothVolumePreserve: boolean
  /** Per-iteration strength (lambda_factor) for the LaplacianSmooth path. */
  proxySmoothLambda: number
  /** Safety multiplier applied to the measured max proxy→source surface displacement
   *  when sizing the bake cage/ray distance, so rays always overshoot the source
   *  detail rather than falling short and baking a flat (detail-less) normal map. */
  bakeDisplacementSafety: number
  /** Smart-UV-project angle limit (degrees) for the proxy unwrap. */
  uvAngleLimitDeg: number
  /** Smart-UV-project / pack island margin (0..1 of UV space). */
  uvIslandMargin: number
  /** Emboss a watermark string into the PREVIEW proxy GEOMETRY so a mesh-rip carries
   *  it (a naive print is spoiled; the letters must be manually removed). The paid
   *  STL is never touched — only the preview proxy. */
  embossWatermarkEnabled: boolean
  /** The text embossed into the proxy (e.g. "PREVIEW"). Repeats up the pillar with
   *  a two-space separator, so a single word tiles legibly without its own. */
  embossWatermarkText: string
  /** Placement style: "pillars" (default) embosses N thin vertical text columns spaced
   *  around the model, each climbing bottom→top with a slight spiral twist; "bands" is
   *  the legacy four upright bands hugging the bottom edge. */
  embossStyle: 'pillars' | 'bands'
  /** Number of vertical pillars spaced evenly around the model (default 4). */
  embossPillarCount: number
  /** Pillar letter cap height as a fraction of the narrower footprint dimension. Small
   *  → slim ribbons that scale with the model without overwhelming the detail. */
  embossPillarWidthFrac: number
  /** Total spiral twist (degrees) each pillar sweeps from base to top. Small = a gentle
   *  spiral; 0 = dead-straight vertical columns. */
  embossPillarTwistDeg: number
  /** How far (engrave mode) each column reaches INWARD from its wall toward the centre,
   *  as a fraction of that wall's half-depth. ~1.0 reaches the central axis so a wall set
   *  back from the bounding box still gets carved (fixes markers that only appear at the
   *  single widest point). Lower it if the cuts look too deep. */
  embossPillarReachFrac: number
  /** Hard cap on how many times the text repeats up a pillar (bounds boolean cost on
   *  tall models). */
  embossPillarMaxRepeats: number
  /** Minimum solid-cell coverage (0..1) a candidate strip must hold across the whole
   *  glyph-height/width window before a wall placement counts it as usable. Each wall
   *  is raycast-sampled into a grid first (see bake_proxy.py's _locate_wall_text) to
   *  find real flat, outward-facing material instead of trusting the bbox blindly —
   *  this threshold is how much discretisation/mullion noise that search tolerates
   *  before treating a run as broken. Lower = more forgiving of gappy surfaces (windows,
   *  lattice) but risks landing partly on a real opening; higher = stricter but more
   *  walls get skipped as "no usable patch". */
  embossWallMinCoverage: number
  /** Raycast grid cell size = pillar cap height / this divisor. Higher = finer grid
   *  (better at finding thin solid strips like window mullions, more raycasts). */
  embossWallCellDivisor: number
  /** Text cap height as a % of the model's smaller horizontal footprint dimension.
   *  Used by the legacy "bands" style only; pillars derive their size from width-frac. */
  embossHeightPct: number
  /** Emboss depth as a % of the bbox diagonal. In engrave mode this is how deep the
   *  recess is cut; in raised mode it's how far the letters stand PROUD of the wall.
   *  Keep it modest in engrave mode so the mark stays subtle and never cuts through a
   *  thin wall. */
  embossDepthPct: number
  /** How far the emboss text plane is inset INWARD from the bbox side, as a % of the
   *  bbox diagonal. The band wraps the bottom edge on all four sides; the inset (plus
   *  the extrude) is what lets the boolean bite a wall standing back from the bbox
   *  extreme, so the mark reliably fuses to real geometry. */
  embossInsetPct: number
  /** Cut the text INTO the surface (engrave) instead of raising it. Default true:
   *  a boolean difference only removes material where the cutter meets real mesh, so an
   *  engraved mark can never leave floating text (the failure of the raised bands) and
   *  doesn't inflate the bounding box (no stacking gap). Subtler, too. */
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
  /** Run the poison-pills step (delete base + interior faces → non-watertight so the
   *  proxy won't slice/print). Toggle off to isolate it when diagnosing a preview that
   *  looks damaged in the planner — the interior-face heuristic can punch holes in
   *  visible surfaces on some meshes. */
  poisonPillsEnabled: boolean
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
    triangleRetainRatio: envNum('PROXY_BAKE_TRIANGLE_RETAIN_RATIO'),
    triangleBudgetCeiling: envNum('PROXY_BAKE_TRIANGLE_CEILING'),
    weldMergeDistanceMm: envNum('PROXY_BAKE_WELD_DISTANCE_MM'),
    proxySmoothIterations: envNum('PROXY_BAKE_SMOOTH_ITERS'),
    proxySmoothFactor: envNum('PROXY_BAKE_SMOOTH_FACTOR'),
    proxySmoothLambda: envNum('PROXY_BAKE_SMOOTH_LAMBDA'),
    bakeDisplacementSafety: envNum('PROXY_BAKE_DISPLACEMENT_SAFETY'),
    uvAngleLimitDeg: envNum('PROXY_BAKE_UV_ANGLE_DEG'),
    uvIslandMargin: envNum('PROXY_BAKE_UV_MARGIN'),
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
