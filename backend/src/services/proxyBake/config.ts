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
  /** Master toggle for proxy triangle decimation (COLLAPSE/voxel remesh). Default
   *  **false** (2026-08-21, final — after a brief detour to `true` the same day).
   *  Sequence: turning this off entirely caused visible planner slowdown (this GLB
   *  IS the file the planner renders, so undecimated = the source's full triangle
   *  count straight into the browser — the FPS problem this pipeline was built to
   *  prevent). Turning it back on (retain 0.6, ceiling 300000) to fix that was
   *  **proven actively DESTRUCTIVE, not just lossy**, on a real dense multi-shell
   *  architectural model (a "Japan houses"-style building, 2.6M source triangles):
   *  a local Blender test comparing renders at IDENTICAL camera angles found
   *  Blender's DECIMATE(COLLAPSE) tearing visible holes through vases, lattice
   *  panels and railings — at EVERY tested reduction ratio (11% retain via the
   *  300k ceiling: severe; 34% retain via a 900k ceiling: still visibly damaged,
   *  just less). VOXEL remesh (the pipeline's existing fallback strategy) was
   *  tested too and was worse in a different way — it obliterates fine lattice/
   *  ornament detail entirely rather than corrupting it. Only fully-undecimated
   *  (this field false) reproduced the pristine source with no artefacts. This
   *  asset class (dense, many separate-but-touching thin shells — lattice bars,
   *  balusters, ornaments) is apparently NOT safe to decimate with the operators
   *  available here at any meaningfully lossy ratio; a proper fix would need a
   *  smarter/topology-aware simplifier or a separate planner-only LOD asset
   *  decoupled from this preview proxy — neither exists yet. Until then, per
   *  explicit user priority ("doesn't destroy the model" over planner speed),
   *  this stays false and dense models simply keep their full triangle count in
   *  the planner. triangleBudget/triangleRetainRatio/triangleBudgetCeiling below
   *  are unused while this is false — kept in the schema for a future fix or a
   *  per-model override on a source PROVEN safe to decimate. Smoothing
   *  (proxySmoothIterations) stays 0/off regardless. Geometry-based anti-theft is
   *  inherently weaker without decimation/smoothing; protection leans on the
   *  emboss watermark (embossStyle) and the download-time AES header watermark
   *  on the paid STL instead. */
  proxyDecimationEnabled: boolean
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
   *  triangleBudget floor (default 0.6 = keep ~60%, raised 2026-08-21 from 0.22 —
   *  per-user preference for fidelity over aggressive reduction, balanced against a
   *  real bake proving fully-off decimation made the planner visibly slow on a dense
   *  model). Only takes effect once src_tris * triangleRetainRatio exceeds
   *  triangleBudget — typical/simple sources are unaffected and skip decimation
   *  entirely (full source detail) as before. See bake_proxy.py's
   *  compute_adaptive_budget docstring for why the ceiling was NOT scaled up
   *  proportionally with this. */
  triangleRetainRatio: number
  /** Hard cap on the adaptive proxy triangle target, regardless of how large
   *  triangleRetainRatio * sourceTriangles gets. Protects the 20-min bake timeout
   *  and — since the worker is a single-threaded serial queue (proxyBakeWorker.ts)
   *  — protects every OTHER queued upload's wait time too, not just this one's.
   *  Left at 300000 when triangleRetainRatio was raised 0.22→0.6 (2026-08-21):
   *  worst-case OUTPUT triangle count for the densest known real source (~2.5M
   *  tris) is unchanged — still ceiling-bound at exactly this value either way
   *  (2.5M * 0.6 = 1.5M ≫ ceiling) — so the higher ratio only gives MORE detail to
   *  sources that weren't already ceiling-bound (roughly under ~500k tris at the
   *  new ratio), without reintroducing the timeout risk a raised ceiling would.
   *  Raise the ceiling itself only after a real worker-side bake confirms a higher
   *  number stays comfortably under the timeout. */
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
   *  ignore — so the geometry a thief rips is a smooth blob. 0 disables smoothing —
   *  default since 2026-08-21 (alongside proxyDecimationEnabled=false) so the
   *  preview keeps its full, undegraded detail rather than a melted/rounded
   *  silhouette; anti-theft then leans on the emboss watermark holes instead. */
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
  /** Placement style. "pillars" (default since 2026-08-21): N text placements
   *  (embossPillarCount) found via a real raycast wall-solidity search
   *  (_locate_wall_text) that only cuts where a genuinely flat, solid,
   *  outward-facing patch actually exists — this is what makes it SAFE on
   *  detailed models. "punch" (the default up to 2026-08-21): cuts a THROUGH-HOLE
   *  with NO solidity search at all — deliberately skips it, on the theory that
   *  face deletion is "uniform" regardless of what it hits. That theory held on a
   *  simple hollow test box but FAILED on a real richly-detailed architectural
   *  model: a local Blender test (multiple real bakes, camera-matched before/after
   *  renders) showed punch repeatedly landing on thin/fragile members — railings,
   *  posts, a decorative lantern sitting behind the wall — and tearing them into
   *  jagged, damage-looking geometry, however the reach/boldness knobs were tuned.
   *  Switching to "pillars" — which always searches for real solid material before
   *  cutting (embossOrientation controls which reading direction the search may
   *  use, see there; either way it's real material, never blind) — fixed this
   *  immediately on the same model: clean, legible text, zero visible damage
   *  elsewhere. "punch" is
   *  kept in the schema (still safe on simple flat-walled models, e.g. the
   *  synthetic box this pipeline was first validated against) but is no longer the
   *  default. "bands" is the legacy four upright bands hugging the bottom edge,
   *  always a boolean. */
  embossStyle: 'punch' | 'pillars' | 'bands'
  /** Which sides get a punch-through cut (style "punch" only). Each entry is one of
   *  "front"/"right"/"back"/"left" (same cardinal wall convention as the pillars
   *  style: front = +Y, right = +X, back = -Y, left = -X). Default ["front","right"]
   *  punches exactly those two faces straight through the model, per the original
   *  request — add "back"/"left" for more sides. */
  embossPunchSides: Array<'front' | 'right' | 'back' | 'left'>
  /** Punch-through letter size, as a fraction of the model's OWN height (dz) — cap_h
   *  = model height * this fraction, same idea as embossHoleBoldnessFrac but a
   *  separate knob so tuning one style never silently retunes the other. Letter size
   *  always scales with the model, never a fixed mm size. Since 2026-08-21 this sizes
   *  ONE REPEAT TILE of a small, sparse diagonal BAND (see embossPunchBandRows/
   *  embossPunchGapFrac/embossPunchDiagonalDeg and bake_proxy.py's
   *  _emboss_punch_through) rather than one bold word climbing the whole wall —
   *  default dropped from 0.35 (a single huge letterform) to 0.1. Tuned in three
   *  steps against real Blender renders (see bake_proxy.py's emboss docstring for
   *  the local-testing method): 0.045 was blurry/illegible even bug-free; 0.06
   *  read as legible text on a synthetic test mesh but was confirmed via a real
   *  downloaded PRODUCTION proxy (a genuinely dense, organically-detailed model,
   *  not a flat test box) to be too small to notice at a glance on a short wall —
   *  boldness scales off THAT WALL'S OWN height, which can be much shorter than
   *  a model's overall size; 0.1 was the smallest value that read as clearly
   *  present without approaching the original "damage-looking" territory. */
  embossPunchBoldnessFrac: number
  /** Rotation (degrees) of the punch-through text's read/height axes within each
   *  wall's own plane, measured from vertical ("up"). 0 = the original straight
   *  bottom-to-top climb; the default 45 reads diagonally, crossing the wall corner-
   *  to-corner (per-user "repeating pattern that crosses the models diagonally"). This
   *  is the NOMINAL angle — the actual per-model angle is this ± a random offset up to
   *  embossPunchDiagonalJitterDeg (see there). Only used by embossStyle="punch"; see
   *  bake_proxy.py's _emboss_punch_through. */
  embossPunchDiagonalDeg: number
  /** How much the per-model/per-side JITTER (see embossSeed in bake_proxy.py) may
   *  rotate the punch-through band away from embossPunchDiagonalDeg, in degrees
   *  either direction. Default 20 (i.e. the real angle lands somewhere in
   *  [25°, 65°] for the 45° default) — per-user request that the watermark's
   *  position "shift slightly so it's not always in the same position" to resist a
   *  script written against one specific leaked model's hole geometry. 0 disables
   *  angle jitter (always exactly embossPunchDiagonalDeg). */
  embossPunchDiagonalJitterDeg: number
  /** How far the per-model/per-side JITTER may shift the punch-through band's
   *  lateral centre away from the wall's own midline, as a fraction (0..1) of that
   *  wall's own half-width. Default 0.3. Same anti-script motivation as
   *  embossPunchDiagonalJitterDeg — the band isn't always dead-centre either. 0
   *  disables position jitter. */
  embossPunchPositionJitterFrac: number
  /** Cross-axis (band) width of the punch-through pattern, in units of its own
   *  cap_h — total band width = 2 * cap_h * this value. Default 1.2 (~2.4 glyph
   *  rows) — a narrow stripe, NOT the wall's full extent. Raised (2026-08-21) from
   *  an earlier "cover the whole wall" attempt that read as a fully perforated,
   *  shredded-looking mesh in a real bake rather than a legible small pattern —
   *  per-user "far too many watermarks... make them a lot smaller and less
   *  frequent". */
  embossPunchBandRows: number
  /** Real blank gap baked into the punch-through watermark's cached tile image
   *  (see bake_proxy.py's `_get_watermark_tile`'s `gap_frac` param), as a
   *  fraction of the word's own ink width — 1.5 (the default) means the gap is
   *  1.5x as wide as "PREVIEW" itself, so the word occupies the left 40% of
   *  each repeat period and the rest is blank. This is what turns a
   *  solid-tiled band into a sparse, spaced-out one (letter SIZE is unaffected;
   *  only the gap between occurrences grows). 0 = edge-to-edge tiling, no gap.
   *  Only affects "punch"; the "pillars" style keeps its original gapless tile
   *  (gap_frac=0, the default when unspecified).
   *
   *  FIXED 2026-08-21: this used to be `embossPunchGapChars`, trying to get the
   *  gap via literal trailing SPACE characters appended to the rendered string.
   *  That never worked — confirmed via a local Blender test, Blender's
   *  text-to-mesh conversion (and even the un-converted text object's own
   *  `Object.dimensions`) measures only a string's INK extent; trailing spaces
   *  contribute zero width regardless of count. Every caller of this tile
   *  (including the pre-existing "pillars" style's fixed 2-space gap) had
   *  therefore always tiled edge-to-edge with NO real gap since this feature's
   *  original implementation. Now the gap is real rendered blank pixels in the
   *  tile image itself (see _render_watermark_tile), which actually works. */
  embossPunchGapFrac: number
  /** Extra safety margin added on top of the exact distance to the OPPOSITE wall when
   *  sizing the punch-through cut's vertex-selection depth — as a fraction of that
   *  full-through distance (floored at 2mm absolute). Without this, a punch sized to
   *  land EXACTLY on the far wall's plane can miss it by a hair due to float/geometry
   *  noise and leave the far skin uncut (a dent, not a through-hole); the margin
   *  guarantees the far skin is included. */
  embossPunchReachMarginFrac: number
  /** Hard cap on the punch-through cut's vertex-selection depth, as a multiple of
   *  cap_h (the letter size), regardless of how far the exact-through-the-opposite-
   *  wall distance would otherwise reach. Default 8 — deep enough to clear typical
   *  wall thickness (a genuine through-hole in the outer skin) but shallow enough
   *  to leave a model's INTERIOR alone. Added 2026-08-21 after a local Blender test
   *  on a real, richly-detailed architectural model (not the simple hollow box this
   *  style was originally validated on) showed the punch reaching the model's full
   *  depth and tearing through a decorative interior prop (a lantern/finial) sitting
   *  well behind the outer wall, not just the wall itself — per-user "work on this
   *  until you can see a clear watermark that doesn't destroy the model". Only binds
   *  on models whose full through-distance exceeds this cap; a thin-walled model (or
   *  the original synthetic test box) is unaffected — the cut still reaches genuinely
   *  through in that case. Raise if a specific thick-walled model's mark isn't
   *  reaching daylight on the far side; lower if it's still catching interior detail. */
  embossPunchMaxReachFrac: number
  /** Reading direction for the "pillars" style's raycast wall-solidity search
   *  (_locate_wall_text) — placement ALWAYS goes through that search now (fixed
   *  2026-08-21; an earlier no-search "vertical" mode was found tearing through
   *  thin railings/posts, the same failure the search exists to prevent — see
   *  bake_proxy.py's _emboss_pillars docstring for the full history). This field
   *  only controls which reading direction(s) the search may use:
   *  "vertical" (default, changed from "auto" 2026-08-21): search ONLY the
   *  vertical bottom→top direction. Per-user request — a mark confined to a
   *  horizontal strip near the base can be removed with a single planar cut; a
   *  mark climbing a real vertical run of wall can't be isolated that cheaply.
   *  "auto": tries both vertical and horizontal, keeping whichever finds the
   *  longer legible run — may end up horizontal (e.g. hugging a baseboard) if
   *  that offers more contiguous solid material on a given wall. Both modes are
   *  equally SAFE (both go through the real solidity search); this is purely
   *  about resisting a trivial single-cut removal, not about damage. */
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
  /** Number of vertical pillars spaced evenly around the model (default 4).
   *  Briefly raised to 8 the same session (2026-08-21) chasing "repeat across
   *  the model so scalpers can't just chop a bit off", then reverted: on a
   *  real rectangular building, the 4 extra azimuths (evenly spaced past 4
   *  land at the CORNERS, not mid-wall) found zero solid material every
   *  single time — a diagonal direction on a box doesn't correspond to any
   *  real flat wall, so every extra search attempt was wasted compute for no
   *  additional placement. embossLateralSegments (splitting each EXISTING
   *  wall's own width instead — see there) is what actually delivers
   *  redundancy on this shape. Raise this past 4 only for genuinely
   *  non-rectangular models (e.g. a round tower) where non-cardinal azimuths
   *  DO correspond to real wall surface. */
  embossPillarCount: number
  /** Splits each wall's vertical search band (z0..z1) into this many equal
   *  height bands (default 3) and runs an INDEPENDENT _locate_wall_text
   *  search+cut in EACH one, instead of one search over the whole wall height.
   *  Per-user: "the watermark needs to repeat across the model so scalpers
   *  can't just chop a bit off and resell the model" — a single placement per
   *  wall (however solidly it's located) is still one identifiable region a
   *  scalper could crop away; independent per-band placements mean no single
   *  horizontal slice of the model removes every mark, only the ones that
   *  happen to fall within that slice — ON A MODEL THAT ACTUALLY HAS SOLID
   *  MATERIAL AT MULTIPLE HEIGHTS. Honest limitation, confirmed on a real dense
   *  test model this session: this can only place a mark where real material
   *  exists — a model whose walls are entirely open lattice/window above a
   *  solid base will have every non-base band skip cleanly every time,
   *  because there's genuinely nothing to cut a legible hole into up there.
   *  On that class of model, embossLateralSegments (splitting each wall's own
   *  WIDTH instead of its height — see there) is the lever that actually
   *  delivers redundancy, since it multiplies placements along material
   *  already confirmed solid rather than searching new directions that may
   *  not correspond to any real surface. A band with no usable material just
   *  skips, same as any other "nothing here" case — this only ever adds marks
   *  where real material allows it, never trades one placement for a worse
   *  one. 1 disables banding (the original one-search-per-wall behaviour). */
  embossVerticalBands: number
  /** Splits each wall's own WIDTH into this many equal lateral columns (default
   *  3) and runs an INDEPENDENT _locate_wall_text search+cut in EACH one, at
   *  the SAME letter size (cap_h stays sized off the whole wall, not the
   *  narrower column — see _cap_h_for_wall). Added alongside embossVerticalBands
   *  for the same "repeat across the model" request, after a real bake showed
   *  raising embossPillarCount past 4 (spreading placements to non-cardinal
   *  azimuths) wasted every extra attempt on a rectangular building — a
   *  diagonal direction doesn't correspond to any real flat wall, so nothing
   *  was ever found there. Splitting an EXISTING wall's width instead
   *  multiplies placements on the SAME solid band that already carried that
   *  wall's one mark (confirmed working: several independent columns along a
   *  building's solid base strip), which is what actually delivers "removing
   *  the mark means removing the whole band, not one small chunk of it". A
   *  column with no usable material just skips, same as any other "nothing
   *  here" case. 1 disables segmentation (one search across the whole wall
   *  width, the original behaviour). */
  embossLateralSegments: number
  /** Pillar letter cap height as a fraction of EACH WALL'S OWN width (default 0.15,
   *  dropped 2026-08-21 from 0.64 — see bake_proxy.py's _cap_h_for_wall). 0.64 was
   *  tuned back when this style always did one dead-centre, no-search, full-height
   *  cut per wall (the same failure mode "punch" was later found to have — see
   *  embossStyle's doc); now that placement always goes through the real
   *  solidity search (_locate_wall_text), 0.64 produced oversized text on
   *  whatever legible patch the search found. 0.15 was confirmed via a local test
   *  (real Blender bake, real complex model) to read as clean, legible "PREVIEW"
   *  text without visually dominating the wall — the search-and-shrink logic in
   *  _locate_wall_text still adapts this down further on any wall whose only
   *  usable patch is smaller than 0.15 would need. Also clamped against the
   *  model's own height (`dz * 0.8`) so this width isn't stingy on a tall, narrow
   *  wall. Scales with the model either way — a bigger source gets proportionally
   *  bigger letters/holes, not a fixed mm size. */
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
