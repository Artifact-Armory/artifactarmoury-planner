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
  /** Placement style. "punch" (default): cuts a genuine THROUGH-HOLE spanning the
   *  model's ENTIRE depth on each side in embossPunchSides (front/right by default) —
   *  a die-punch straight through the whole volume, exiting whatever is on the far
   *  side. Deliberately skips the raycast wall-solidity search the other styles use
   *  to find "the best flat patch" — a full-depth cut doesn't need one, since face
   *  deletion just removes whatever is actually in the glyph's path regardless of
   *  surface type, so it's uniform across every model. See bake_proxy.py's
   *  _emboss_punch_through. "pillars": N thin vertical text columns spaced around the
   *  model, each climbing bottom→top on a real raycast-located flat patch of each
   *  wall (shallow recess/hole, not through-depth). "bands" is the legacy four
   *  upright bands hugging the bottom edge, always a boolean. */
  embossStyle: 'punch' | 'pillars' | 'bands'
  /** Which sides get a punch-through cut (style "punch" only). Each entry is one of
   *  "front"/"right"/"back"/"left" (same cardinal wall convention as the pillars
   *  style: front = +Y, right = +X, back = -Y, left = -X). Default ["front","right"]
   *  punches exactly those two faces straight through the model, per the original
   *  request — add "back"/"left" for more sides. */
  embossPunchSides: Array<'front' | 'right' | 'back' | 'left'>
  /** Punch-through letter boldness as a fraction of the model's OWN height (dz) —
   *  cap_h = model height * this fraction, same idea as embossHoleBoldnessFrac but a
   *  separate knob so tuning one style never silently retunes the other. Letter size
   *  always scales with the model, never a fixed mm size. */
  embossPunchBoldnessFrac: number
  /** Extra safety margin added on top of the exact distance to the OPPOSITE wall when
   *  sizing the punch-through cut's vertex-selection depth — as a fraction of that
   *  full-through distance (floored at 2mm absolute). Without this, a punch sized to
   *  land EXACTLY on the far wall's plane can miss it by a hair due to float/geometry
   *  noise and leave the far skin uncut (a dent, not a through-hole); the margin
   *  guarantees the far skin is included. */
  embossPunchReachMarginFrac: number
  /** Reading direction for the "pillars" style. "vertical" (default) forces every
   *  placement to climb bottom→top (the classic spine-label look) even on a wall whose
   *  only usable flat patch would otherwise read better horizontally. "auto" restores
   *  the previous behaviour of trying both orientations per wall and keeping whichever
   *  finds the longer legible run. Only read by the pillars style. */
  embossOrientation: 'vertical' | 'auto'
  /** When true (default), the "pillars" style cuts real THROUGH-HOLES — direct bmesh
   *  FACE DELETION under the glyph shape (see _cut_wall_text_hole in bake_proxy.py),
   *  not a boolean — instead of the shallow vertex-displacement relief the pillars
   *  style used before. A hole can't be shaded/lit away in a render or trivially
   *  patched over the way a shallow recess can, and it reads as unmistakably damaged
   *  geometry to a would-be thief. No CSG solver anywhere in this path (switched off
   *  booleans entirely 2026-08-19, after two separate production failures traced to
   *  them here — see _apply_wm_boolean's and remove_boolean_debris's history): face
   *  deletion can only ever remove existing topology from an already-located
   *  selection, so it cannot leave an unresolved cutter fragment or sever a sliver
   *  into a disconnected island the way a boolean could. The bake itself still never
   *  fails over a watermark problem, same "never die over the watermark" guarantee as
   *  everywhere else in this file. Set false to fall back to the displacement relief. */
  embossThroughHoles: boolean
  /** Greyscale threshold (0..1) on the cached watermark heightmap tile above which a
   *  face is deleted to form the hole — the tile is near-binary (white glyph on black
   *  background) so this mostly just needs to sit somewhere in the anti-aliased edge
   *  between the two; 0.5 is the natural midpoint. Only used when embossThroughHoles
   *  is true. */
  embossHoleThreshold: number
  /** Letter boldness for the default vertical through-hole cut, as a fraction of the
   *  wall's OWN height (embossOrientation="vertical" only) — cap_h = panel height *
   *  this fraction. Solving instead for "exactly one 'PREVIEW  ' period fits the
   *  panel height" (span / tile_aspect) was tried first and produced letters only
   *  ~15% of the panel height on real models (a word is ~6.6 cap-heights tall), which
   *  read as small even though it was technically full-height (confirmed live —
   *  "too small, only covers a very small portion of the model"). Sizing for boldness
   *  instead means the word may not fully fit — read_phase_offset_mm in
   *  _cut_wall_text_hole crops it from its natural start (the bottom of the panel)
   *  rather than an arbitrary centred slice, so a short run reads "PREV…" climbing
   *  from the base instead of a random fragment. Only used when embossThroughHoles
   *  is true and embossOrientation is "vertical" (the defaults). */
  embossHoleBoldnessFrac: number
  /** Depth reach multiplier for the default vertical through-hole cut only —
   *  select_reach_mm = min(wall's own physical reach, max(depth_mm*4, cap_h_full *
   *  this)). The shared _select_reach_mm default (cap_h*0.6, tuned for a shallow
   *  emboss recess) left the bold full-height cut confined to whatever thin
   *  trim/baseboard sat within that shallow band, since a real window's frame/
   *  lattice sits recessed well behind the nominal wall plane and was never close
   *  enough to the plane to be considered — no amount of increasing cap_h_full
   *  alone fixed this (confirmed live: the mark stayed a small blob at the panel's
   *  base instead of climbing through the window bay). 2.5x reaches far enough to
   *  pick up genuine structural material behind a typical reveal depth without
   *  reaching all the way to an opposite wall. */
  embossHoleReachFrac: number
  /** Number of vertical pillars spaced evenly around the model (default 4). */
  embossPillarCount: number
  /** Pillar letter cap height as a fraction of EACH WALL'S OWN width (default 0.64,
   *  doubled 2026-08-19 from 0.32 — was still too small to clearly see through the
   *  through-holes, per-user decision; 0.32 itself was raised 2026-08-18 from 0.17;
   *  changed 2026-08-19 from "narrower footprint dimension" to per-wall width so a
   *  narrow side gets proportionately smaller letters instead of the same size as a
   *  wide one — see bake_proxy.py's _cap_h_for_wall). For the default "vertical"
   *  (climbing) orientation this is the WIDTH of the text column across the wall,
   *  not how far up it reaches — glyphs are rotated 90° to read bottom-to-top.
   *  Vertical reach is controlled separately by embossVerticalMarginFrac (the
   *  "full height of the model" setting). Also clamped against the model's own
   *  height (`dz * 0.8`, raised from 0.64 the same day) just so this column
   *  width isn't clamped back down to something stingy on a tall, narrow wall —
   *  not because it affects reach. Scales with the model either way — a bigger
   *  source gets proportionally bigger letters/holes, not a fixed mm size. At
   *  0.64 a single glyph is already over half a typical wall's width — the
   *  practical ceiling before letters start overlapping
   *  is close; a further increase should probably come with a lower
   *  embossPillarCount instead. */
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
  /** Fraction of the model's own height (dz) kept clear at the very top and
   *  bottom of the vertical search band each pillar's climbing text is allowed
   *  to reach into (default 0.01 = 1% per side, shrunk 2026-08-19 from a fixed
   *  6% per "make the watermark full height of the model" — PROPORTIONAL to
   *  each model's own dz, so it auto-scales for any model size rather than
   *  needing per-size tuning). This sets the maximum possible vertical reach —
   *  _locate_wall_text_at still only places the run where actual contiguous
   *  solid material exists within that band, so a wall broken up by windows/
   *  lattice can still fall short of full height on that one wall; that's a
   *  real geometry constraint, not something this setting can override without
   *  risking a hole cut through empty space. See bake_proxy.py's
   *  _emboss_pillars (z0/z1). */
  embossVerticalMarginFrac: number
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
  /** Run the debris-island cleanup pass after the emboss boolean (drops small
   *  disconnected mesh fragments a watermark hole can sever off — see
   *  remove_boolean_debris in bake_proxy.py). OFF by default (2026-08-19):
   *  this object-lifecycle code (separate/classify/delete/repoint-data/rejoin)
   *  had never run in production before the same day a bake crashed with
   *  "StructRNA of type Object has been removed", and the debris it fixes is
   *  a rare cosmetic defect — not worth the crash risk while unverified.
   *  Enable per-model via proxy_bake_config once proven safe on a real
   *  worker. */
  debrisCleanupEnabled: boolean
  /** After the emboss boolean, any disconnected mesh island whose bounding-box
   *  diagonal is smaller than this fraction of the whole proxy's diagonal is
   *  treated as boolean-cut debris (a thin sliver severed by a watermark hole,
   *  not real geometry) and deleted. Fixed 2026-08-19 after a production bake
   *  left a free-floating shard next to a wall corner near a watermark cut —
   *  present in the proxy, absent from the source. See remove_boolean_debris in
   *  bake_proxy.py. Only takes effect when debrisCleanupEnabled is true. */
  debrisIslandMinDiagFrac: number
  /** Face-count floor for the same debris check — an island under this many
   *  faces is dropped regardless of its bounding-box size. */
  debrisIslandMinFaces: number
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
  /** Render the 6-image source-vs-proxy comparison PNG (QA aid only — never shown
   *  to buyers). Off by default: it's pure Cycles render time added to every bake
   *  for zero product benefit. Flip on per-model (via proxy_bake_config override)
   *  when you actually want to eyeball a specific bake's quality. */
  validationRenderEnabled: boolean
  /** Square resolution of each validation render tile. Only used when
   *  validationRenderEnabled is true. */
  validationRenderPx: number
  /** Planner camera distances (metres) used for the three validation renders. Only
   *  used when validationRenderEnabled is true. */
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
    embossHoleThreshold: envNum('PROXY_BAKE_EMBOSS_HOLE_THRESHOLD'),
    embossHoleBoldnessFrac: envNum('PROXY_BAKE_EMBOSS_HOLE_BOLDNESS_FRAC'),
    embossHoleReachFrac: envNum('PROXY_BAKE_EMBOSS_HOLE_REACH_FRAC'),
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
