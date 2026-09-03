// src/state/store.ts
import { create } from 'zustand'
import * as THREE from 'three'
import {
  loadAssets, loadAssetsFromAPI, loadSetsFromAPI, loadMyModelsForPlanner, getAssetById,
  type Asset, type PlannerSetData, type PlannerMyModel,
} from '../core/assets'
import {
  type Heightmap, type TerrainTool, createHeightmap, heightmapFitsTable, applyBrush,
} from '../core/heightmap'
import {
  type TerrainFeature, type TerrainFeatureType, defaultFeature, compositeHeightmap,
} from '../core/terrainFeatures'
import {
  type TerrainPath, defaultPath, translatePath,
} from '../core/terrainPaths'
import {
  type PaintMap, createPaintMap, paintFitsTable, applyPaintBrush, clonePaintMap,
} from '../core/paintmap'
import { useCartStore } from '@/store/cartStore'
import { bundlesApi } from '@/api/endpoints/bundles'
import { ordersApi } from '@/api/endpoints/orders'
import { analyticsApi } from '@/api/endpoints/analytics'
import { taxonomyApi, MODEL_CLASS_SLUG, type TaxFacet } from '@/api/endpoints/taxonomy'

/** Build the browse `terms` string from a class + facet-token selection. */
function buildCatalogueTerms(modelClass: string | null, terms: string[]): string | undefined {
  const tokens = modelClass ? [`${MODEL_CLASS_SLUG}:${modelClass}`, ...terms] : [...terms]
  return tokens.length ? tokens.join(',') : undefined
}

/**
 * Facet tree for the palette filter rail. Prefer live counts (zero-count terms
 * pruned) once real facets carry counts; if only the backfilled model-class facet
 * has any counts (an untagged catalogue), fall back to the full tree so the filters
 * are still usable.
 */
async function loadCatalogueFacets(termsStr: string | undefined): Promise<TaxFacet[]> {
  try {
    const counted = await taxonomyApi.getFacetsWithCounts({ terms: termsStr, hideZero: true })
    const realCounts = counted.filter((f) => f.terms.length && f.slug !== MODEL_CLASS_SLUG)
    if (realCounts.length > 0) return counted
    return await taxonomyApi.getTree()
  } catch {
    return []
  }
}

export type SnapBaseline = 'snap' | 'free'

/** A bundle as shown in the palette: a group tile that expands into its models. */
export type PlannerBundle = {
  id: string
  name: string
  thumbnail?: string
  price: number
  artistId?: string
  artistName?: string
  modelIds: string[] // members that exist in the loaded catalogue
}

/** Camera controls owned by ThreeStage, exposed so UI buttons can drive them. */
export interface CameraApi {
  frameTable: () => void
  frameSelection: () => void
  home: () => void
}

/**
 * Engine actions that live inside ThreeStage (ghost rotation, the manual
 * placement level) but have no keyboard on a tablet, so the touch control
 * cluster in the UI can drive them. Mirrors the R / PageUp / PageDown keys.
 */
export interface StageApi {
  /** Rotate the ghost if placing, else the current selection. dir: 1 = cw. */
  rotate: (dir: 1 | -1) => void
  /** Raise (+1) / lower (-1) the placement level, overriding auto-surface. */
  nudgeLevel: (delta: 1 | -1) => void
}

export type Unit = 'm'|'cm'|'ft'|'in'
export type Table = { width: number; height: number; unitDisplay: Unit; gridSize: number }

export type Instance = {
  id: string
  assetId: string
  position: { x: number; z: number }
  rotationDeg: number  // yaw about the vertical (Y) axis
  pitchDeg?: number    // tilt about the X axis (stand a model up / lay it flat); 0 = default
  level: number        // discrete elevation level of the piece's base (0 = table)
}

export type SavedLayout = {
  id: string
  name: string
  table: Table
  instances: Instance[]
  createdAt: number
}

interface HistoryState {
  instances: Instance[]
  selectedInstanceId: string | null
  // Terrain sculpt + texture painting are part of the same undo timeline as
  // placement, so a snapshot carries all three. `terrainDetail` is the raw
  // freehand-brush layer; `heightmap` (state field, NOT snapshotted here) is
  // always a derived recomposite of terrainDetail + terrainFeatures + the
  // current terrace step — see recompositeTerrain(). Landform stamps
  // (terrainFeatures) are part of the same timeline as the detail brush.
  terrainDetail: Heightmap | null
  terrainFeatures: TerrainFeature[]
  terrainPaths: TerrainPath[]
  paint: PaintMap | null
}

/** Deep-clone a height field for a history snapshot (Float32Array must be copied). */
function cloneHeightmap(hm: Heightmap | null): Heightmap | null {
  if (!hm) return null
  return { cols: hm.cols, rows: hm.rows, heights: new Float32Array(hm.heights) }
}

function cloneFeatures(features: TerrainFeature[]): TerrainFeature[] {
  return features.map((f) => ({ ...f }))
}

function clonePaths(paths: TerrainPath[]): TerrainPath[] {
  return paths.map((p) => ({ ...p, points: p.points.map((pt) => ({ ...pt })) }))
}

/**
 * A line in the planner's table-derived basket (one entry per distinct asset on
 * the table). Digital STLs are bought once, so `quantity` is a piece count for
 * display and `firstQty`/`repeatQty` only ever differ for print fulfilment.
 * Previously lived in `core/pricing.ts`, which was legacy print-cost maths.
 */
export interface BasketItem {
  assetId: string
  quantity: number
  fulfillment?: 'stl' | 'print'
  isFirstPurchase: boolean
  firstQty?: number
  repeatQty?: number
}

interface AppState {
  table: Table
  scene: THREE.Scene | null
  camera: THREE.PerspectiveCamera | null
  renderer: THREE.WebGLRenderer | null

  assets: Asset[]
  // Planner palette filters (model class + facet terms), driving the catalogue query.
  catalogueClass: string | null      // selected model class (null = all)
  catalogueTerms: string[]           // selected facet tokens (excl. model-class)
  catalogueFacets: TaxFacet[]        // facet tree w/ counts for the palette filter rail
  catalogueLoading: boolean          // true while re-querying the catalogue
  bundles: PlannerBundle[]           // published bundles (palette grouping)
  sets: PlannerSetData[]             // published multi-part "set" models (grouping)
  setPartAssets: Asset[]             // the sets' part assets (kept off the catalogue)
  myModels: PlannerMyModel[]         // the signed-in artist's own models (incl. drafts)
  ownedModelIds: Set<string>         // models the signed-in user has purchased
  ownedBundleIds: Set<string>        // bundles the signed-in user has purchased
  selectedAssetId: string | null
  instances: Instance[]
  selectedInstanceId: string | null
  selectedInstanceIds: string[]

  // Placement mode
  snapBaseline: SnapBaseline   // session baseline (toggled with G)
  altMomentary: boolean        // true while Alt is held (momentary opposite)
  placementLevel: number       // current elevation level the ghost will place at
  placementManual: boolean     // true when the level is a manual override (PageUp/Down)
  tableMaterial: string        // table surface material id (grass/sand/wood/snow/…)

  // Terrain sculpting (deformable table surface → printable tiles later).
  // The sculpt UI is hidden behind FEATURES.terrainSculpt; existing sculpted
  // tables still load and render, so no saved data is lost while it's off.
  //
  // Hybrid model, three additive layers: `terrainFeatures` (circular point
  // stamps — hill/plateau) + `terrainPaths` (drawn ditches — a polyline with
  // raised banks, NEVER dug below the base; see terrainPaths.ts's module doc
  // for why) + `terrainDetail` (the freehand brush, same field that used to
  // be the whole story). `heightmap` is NEVER written to directly by a
  // sculpt/stamp/path edit — it's always recomputed from the three authored
  // layers + terraceStep (compositeHeightmap), and is what every renderer/
  // consumer (ThreeStage, tile export) reads. This keeps their contract (a
  // single final Heightmap | null) completely unchanged by the stamp system.
  heightmap: Heightmap | null       // derived/cached — see compositeHeightmap()
  terrainDetail: Heightmap | null   // the freehand-brush layer (null = untouched)
  terrainFeatures: TerrainFeature[] // landform stamps (hill/plateau)
  terrainPaths: TerrainPath[]       // drawn ditches
  /** A ditch being drawn — one point per click so far, not yet committed to terrainPaths. */
  pathDrawing: { points: Array<{ x: number; z: number }> } | null
  terraceStep: number               // metres; 0 = smooth/continuous (not undoable — a display setting, like tableMaterial)
  selectedFeatureId: string | null  // point stamp currently shown in the landform property panel
  selectedPathId: string | null     // ditch currently shown in the landform property panel
  landformArmed: TerrainFeatureType | 'ditch' | null // next table click places/draws this
  terrainTool: TerrainTool     // 'none' = placement mode; otherwise a sculpt/paint brush
  brushRadius: number          // metres
  brushStrength: number        // 0..1
  terrainRev: number           // bumped on every sculpt so the scene re-syncs

  // Ground texture painting (an overlay of table materials brushed onto the surface)
  paint: PaintMap | null       // null = nothing painted (base material everywhere)
  paintMaterial: string        // material id the paint brush applies
  paintRev: number             // bumped on every paint dab so the scene re-bakes

  basket: BasketItem[]
  purchasedAssetIds: Set<string>

  // History for undo/redo
  history: HistoryState[]
  historyIndex: number
  maxHistory: number

  // Camera modes
  cameraMode: 'perspective' | 'top-down' | 'isometric'
  cameraApi: CameraApi | null
  stageApi: StageApi | null

  // View-only mode: a shopper opened a published table. Camera works, but all
  // placement/selection/editing is disabled (only the owning artist edits, via
  // their dashboard). Gated in ThreeStage input handlers.
  readOnly: boolean

  // Cross-artist collaboration. When an artist places another artist's model on a
  // showcase, we require a collaboration request. These fields drive the gate +
  // the confirmation modal (see ThreeStage.placeGhost + ui/App CollabRequestModal).
  currentUserId: string | null       // signed-in user id (for foreign-model detection)
  currentUserIsArtist: boolean        // only artists are gated (customers "shop the look")
  requestedCollaboratorIds: Set<string> // owners we've already consented to / requested this table
  pendingCollab: { artistId: string; artistName: string; commit: () => void } | null

  setTable: (t: Partial<Table>) => void
  setRefs: (s: Partial<Pick<AppState,'scene'|'camera'|'renderer'>>) => void
  setSelectedAsset: (id: string | null) => void
  setSelectedInstance: (id: string | null) => void
  setSelectedInstances: (ids: string[]) => void
  setCameraMode: (mode: 'perspective' | 'top-down' | 'isometric') => void
  setCameraApi: (api: CameraApi | null) => void
  setStageApi: (api: StageApi | null) => void
  setReadOnly: (v: boolean) => void
  setSnapBaseline: (b: SnapBaseline) => void
  toggleSnapBaseline: () => void
  setAltMomentary: (v: boolean) => void
  setPlacement: (level: number, manual: boolean) => void
  setTableMaterial: (id: string) => void

  setTerrainTool: (tool: TerrainTool) => void
  setBrush: (patch: Partial<{ radius: number; strength: number }>) => void
  setPaintMaterial: (id: string) => void
  /**
   * Arm a landform tool: 'hill'/'plateau' places one on the next table click;
   * 'ditch' starts point-by-point path drawing instead (see actions below).
   * Clears the brush/placement tools and any other landform selection.
   */
  setLandformArmed: (type: TerrainFeatureType | 'ditch' | null) => void
  /** Select a placed point stamp for the landform property panel (null = none). */
  setSelectedFeature: (id: string | null) => void
  /** Select a placed ditch for the landform property panel (null = none). */
  setSelectedPath: (id: string | null) => void
  /** 0 = smooth. A display setting like tableMaterial — not part of undo history. */
  setTerraceStep: (metres: number) => void

  // Collaboration gate
  setCurrentUser: (id: string | null, isArtist: boolean) => void
  setRequestedCollaborators: (ids: string[]) => void
  /** Ask the user to send a collaboration request before placing a foreign model. */
  openCollabPrompt: (artistId: string, artistName: string, commit: () => void) => void
  /** Resolve the prompt: accept places the piece (and marks the owner requested). */
  resolveCollab: (accept: boolean) => void

  actions: {
    /** Sculpt the surface at a world position with the active brush. Returns true if changed. */
    sculptTerrain: (worldX: number, worldZ: number) => boolean
    /** Paint (or erase) the active ground texture at a world position. Returns true if changed. */
    paintTerrain: (worldX: number, worldZ: number) => boolean
    /** Reset the surface back to flat (clears both the detail layer and every stamp). */
    resetTerrain: () => void
    /** Place a new landform stamp at a world position, select it, commits history immediately. */
    addTerrainFeature: (type: TerrainFeatureType, worldX: number, worldZ: number) => string
    /**
     * Reposition/resize/reheight a stamp WITHOUT committing history — for a live
     * drag or slider, same pattern as the sculpt brush stroke. Call
     * actions.commitHistory() once when the drag/slider interaction ends.
     */
    updateTerrainFeatureLive: (id: string, patch: Partial<Pick<TerrainFeature, 'x' | 'z' | 'radius' | 'height'>>) => void
    /** Delete a stamp — one-shot, commits history immediately. */
    removeTerrainFeature: (id: string) => void

    // Ditch path drawing (Manor-Lords-road style: click, click, click, Finish).
    /** Add a point to the ditch being drawn — starts a new draw if none is in progress. */
    addPathPoint: (worldX: number, worldZ: number) => void
    /** Remove the last placed point (e.g. Backspace) — clears the draw if that was the only one. */
    undoLastPathPoint: () => void
    /** Commit the in-progress draw as a TerrainPath (needs >=2 points) and select it, or no-op/cancel if too short. */
    finishPathDraw: () => void
    /** Discard the in-progress draw without committing anything. */
    cancelPathDraw: () => void
    /** Reposition/resize a committed ditch WITHOUT committing history — same live-drag pattern as stamps. */
    updateTerrainPathLive: (id: string, patch: Partial<Pick<TerrainPath, 'channelWidth' | 'bermWidth' | 'bermHeight'>>) => void
    /** Translate every point of a committed ditch by (dx, dz), live (no history) — for dragging the whole path. */
    moveTerrainPathLive: (id: string, dx: number, dz: number) => void
    /** Delete a ditch — one-shot, commits history immediately. */
    removeTerrainPath: (id: string) => void

    /** Clear all painted ground texture. */
    resetPaint: () => void
    /** Ensure a heightmap exists that fits the current table (creates/regenerates). */
    ensureHeightmap: () => void
    /** Ensure a paint map exists that fits the current table. */
    ensurePaintMap: () => void
    /** Push the current scene (instances + terrain + paint) as one undo step. */
    commitHistory: () => void
    /** Seed a baseline history entry if none exists, so the first edit is undoable. */
    ensureInitialHistory: () => void
    fitView: () => void
    loadAssetCatalogue: () => Promise<void>
    /** Re-query the palette catalogue for a class / facet-term selection. */
    setCatalogueFilter: (next: { modelClass?: string | null; terms?: string[] }) => Promise<void>
    loadStarterLayout: () => void
    addInstance: (i: Omit<Instance,'id'>) => string
    updateInstance: (id: string, patch: Partial<Omit<Instance,'id'|'assetId'>>) => void
    updateInstances: (patches: Array<{ id: string; patch: Partial<Omit<Instance,'id'|'assetId'>> }>) => void
    /** Tilt the current selection by deltaDeg about X (e.g. ±90 to stand up / lay flat). */
    tiltSelected: (deltaDeg: number) => void
    removeInstance: (id: string) => void
    removeInstances: (ids: string[]) => void
    clearInstances: () => void
    duplicateInstance: (id: string) => void
    duplicateInstances: (ids: string[]) => string[]
    addLayoutToShopCart: () => number
    
    // Undo/Redo
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    
    // Save/Load
    saveLayout: (name: string) => string
    loadLayout: (id: string) => void
    /** Replace the whole scene from an external source (e.g. a server-saved table). */
    applyLayout: (data: {
      table: Table
      tableMaterial?: string
      instances: Instance[]
      terrainDetail?: Heightmap | null
      terrainFeatures?: TerrainFeature[]
      terrainPaths?: TerrainPath[]
      terraceStep?: number
      paint?: PaintMap | null
    }) => void
    getSavedLayouts: () => SavedLayout[]
    deleteLayout: (id: string) => void
    exportLayout: () => string
    importLayout: (json: string) => void
    
    // Basket
    addToBasket: (assetId: string, quantity?: number) => void
    removeFromBasket: (assetId: string) => void
    updateBasketQuantity: (assetId: string, quantity: number) => void
    clearBasket: () => void
    markAsPurchased: (assetIds: string[]) => void
    addLayoutToBasket: () => void
    syncBasketWithTable: () => void
  }
}

// Helper to save history
function saveHistory(state: AppState): Partial<AppState> {
  const newHistory = state.history.slice(0, state.historyIndex + 1)
  newHistory.push({
    instances: JSON.parse(JSON.stringify(state.instances)),
    selectedInstanceId: state.selectedInstanceId,
    terrainDetail: cloneHeightmap(state.terrainDetail),
    terrainFeatures: cloneFeatures(state.terrainFeatures),
    terrainPaths: clonePaths(state.terrainPaths),
    paint: clonePaintMap(state.paint),
  })
  
  // Limit history size
  if (newHistory.length > state.maxHistory) {
    newHistory.shift()
    return { history: newHistory }
  }
  
  return { 
    history: newHistory,
    historyIndex: newHistory.length - 1
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  // gridSize is the snap/movement increment in metres (also the visible minor-line
  // spacing — see scene/helpers.ts GridHelper). 0.0127m = 1/2" — halved from 1" so
  // pieces can be nudged into finer positions.
  table: { width: 1.8288, height: 1.2192, unitDisplay: 'ft', gridSize: 0.0127 },
  scene: null,
  camera: null,
  renderer: null,

  assets: [],
  catalogueClass: null,
  catalogueTerms: [],
  catalogueFacets: [],
  catalogueLoading: false,
  bundles: [],
  sets: [],
  setPartAssets: [],
  myModels: [],
  ownedModelIds: new Set(),
  ownedBundleIds: new Set(),
  selectedAssetId: null,
  instances: [],
  selectedInstanceId: null,
  selectedInstanceIds: [],

  snapBaseline: 'snap',
  altMomentary: false,
  placementLevel: 0,
  placementManual: false,
  tableMaterial: 'grass',

  heightmap: null,
  terrainDetail: null,
  terrainFeatures: [],
  terrainPaths: [],
  pathDrawing: null,
  terraceStep: 0,
  selectedFeatureId: null,
  selectedPathId: null,
  landformArmed: null,
  terrainTool: 'none',
  brushRadius: 0.12,
  brushStrength: 0.5,
  terrainRev: 0,

  paint: null,
  paintMaterial: 'sand',
  paintRev: 0,

  basket: [],
  purchasedAssetIds: new Set(),

  history: [],
  historyIndex: -1,
  maxHistory: 50,

  cameraMode: 'perspective',
  cameraApi: null,
  stageApi: null,

  readOnly: false,

  currentUserId: null,
  currentUserIsArtist: false,
  requestedCollaboratorIds: new Set(),
  pendingCollab: null,

  setCurrentUser: (id, isArtist) => set({ currentUserId: id, currentUserIsArtist: isArtist }),
  setRequestedCollaborators: (ids) => set({ requestedCollaboratorIds: new Set(ids) }),
  openCollabPrompt: (artistId, artistName, commit) => set({ pendingCollab: { artistId, artistName, commit } }),
  resolveCollab: (accept) => {
    const p = get().pendingCollab
    if (!p) return
    if (accept) {
      set(s => ({ requestedCollaboratorIds: new Set(s.requestedCollaboratorIds).add(p.artistId) }))
      p.commit()
    }
    set({ pendingCollab: null })
  },

  setTable: (t) => set(s => ({ table: { ...s.table, ...t } })),
  setRefs: (refs) => set(refs as any),
  // Placement and terrain sculpting are mutually exclusive — picking a model to
  // place leaves sculpt mode (and any armed landform stamp).
  setSelectedAsset: (id) => set(s => ({
    selectedAssetId: id,
    terrainTool: id ? 'none' : s.terrainTool,
    landformArmed: id ? null : s.landformArmed,
    pathDrawing: id ? null : s.pathDrawing,
  })),
  setSelectedInstance: (id) =>
    set({ selectedInstanceId: id, selectedInstanceIds: id ? [id] : [] }),
  setSelectedInstances: (ids) =>
    set({ selectedInstanceIds: ids, selectedInstanceId: ids.length ? ids[ids.length - 1] : null }),
  setCameraMode: (mode) => set({ cameraMode: mode }),
  setCameraApi: (api) => set({ cameraApi: api }),
  setStageApi: (api) => set({ stageApi: api }),
  setReadOnly: (v) => set({ readOnly: v }),
  setSnapBaseline: (b) => set({ snapBaseline: b }),
  toggleSnapBaseline: () => set(s => ({ snapBaseline: s.snapBaseline === 'snap' ? 'free' : 'snap' })),
  setAltMomentary: (v) => set({ altMomentary: v }),
  setPlacement: (level, manual) => set(s =>
    s.placementLevel === level && s.placementManual === manual
      ? {}
      : { placementLevel: level, placementManual: manual }),
  setTableMaterial: (id) => set({ tableMaterial: id }),

  setTerrainTool: (tool) => {
    // Entering a sculpt/paint tool clears any pending model placement AND any
    // armed landform stamp (all mutually exclusive). Height tools need a
    // height field; paint tools need a paint map.
    if (tool === 'raise' || tool === 'lower' || tool === 'smooth' || tool === 'flatten') {
      get().actions.ensureHeightmap()
      set({ selectedAssetId: null, landformArmed: null, pathDrawing: null })
    } else if (tool === 'paint' || tool === 'erase') {
      get().actions.ensurePaintMap()
      set({ selectedAssetId: null, landformArmed: null, pathDrawing: null })
    }
    set({ terrainTool: tool })
  },
  setBrush: (patch) => set(s => ({
    brushRadius: patch.radius != null ? patch.radius : s.brushRadius,
    brushStrength: patch.strength != null ? patch.strength : s.brushStrength,
  })),
  setPaintMaterial: (id) => set({ paintMaterial: id }),
  setLandformArmed: (type) => set(s => ({
    landformArmed: type,
    // Arming a stamp leaves brush/paint/placement mode, same mutual exclusion
    // as the other tools. Switching to/away from any tool abandons an
    // in-progress ditch draw rather than silently keeping it half-finished.
    pathDrawing: type === 'ditch' ? s.pathDrawing : null,
    terrainTool: type ? 'none' : s.terrainTool,
    selectedAssetId: type ? null : s.selectedAssetId,
  })),
  // Only one landform property panel shows at a time — selecting one kind
  // clears the other, but deselecting (id=null, e.g. the panel's X button)
  // must NOT clobber an unrelated selection that wasn't part of this call.
  setSelectedFeature: (id) => set(s => ({ selectedFeatureId: id, selectedPathId: id ? null : s.selectedPathId })),
  setSelectedPath: (id) => set(s => ({ selectedPathId: id, selectedFeatureId: id ? null : s.selectedFeatureId })),
  setTerraceStep: (metres) => set(s => ({
    terraceStep: metres,
    heightmap: compositeHeightmap(s.terrainFeatures, s.terrainPaths, s.terrainDetail, s.table, metres),
    terrainRev: s.terrainRev + 1,
  })),

  actions: {
    ensureHeightmap: () => {
      const s = get()
      if (!heightmapFitsTable(s.terrainDetail, s.table)) {
        const terrainDetail = createHeightmap(s.table)
        set({
          terrainDetail,
          heightmap: compositeHeightmap(s.terrainFeatures, s.terrainPaths, terrainDetail, s.table, s.terraceStep),
          terrainRev: s.terrainRev + 1,
        })
      }
    },

    sculptTerrain: (worldX, worldZ) => {
      const s = get()
      if (s.terrainTool === 'none') return false
      let hm = s.terrainDetail
      if (!heightmapFitsTable(hm, s.table)) hm = createHeightmap(s.table)
      const changed = applyBrush(hm, s.table, worldX, worldZ, s.terrainTool, s.brushRadius, s.brushStrength)
      if (changed) {
        set({
          terrainDetail: hm,
          heightmap: compositeHeightmap(s.terrainFeatures, s.terrainPaths, hm, s.table, s.terraceStep),
          terrainRev: s.terrainRev + 1,
        })
      }
      return changed
    },

    addTerrainFeature: (type, worldX, worldZ) => {
      const t = get().table
      const hw = t.width / 2, hh = t.height / 2
      const f = defaultFeature(type, THREE.MathUtils.clamp(worldX, -hw, hw), THREE.MathUtils.clamp(worldZ, -hh, hh))
      set(s => {
        const terrainFeatures = [...s.terrainFeatures, f]
        const next = {
          terrainFeatures,
          heightmap: compositeHeightmap(terrainFeatures, s.terrainPaths, s.terrainDetail, s.table, s.terraceStep),
          terrainRev: s.terrainRev + 1,
          selectedFeatureId: f.id,
          selectedPathId: null,
        }
        return { ...next, ...saveHistory({ ...s, ...next }) }
      })
      return f.id
    },

    updateTerrainFeatureLive: (id, patch) => {
      set(s => {
        // Clamp x/z to the table — a repositioning drag reads the cursor's
        // ground point off the (unbounded) flat-plane raycast fallback
        // whenever it's past the terrain mesh's edge, so without this a stamp
        // dragged past the table border flies off into open space.
        const hw = s.table.width / 2, hh = s.table.height / 2
        const clamped: typeof patch = { ...patch }
        if (clamped.x != null) clamped.x = THREE.MathUtils.clamp(clamped.x, -hw, hw)
        if (clamped.z != null) clamped.z = THREE.MathUtils.clamp(clamped.z, -hh, hh)
        const terrainFeatures = s.terrainFeatures.map(f => f.id === id ? { ...f, ...clamped } : f)
        return {
          terrainFeatures,
          heightmap: compositeHeightmap(terrainFeatures, s.terrainPaths, s.terrainDetail, s.table, s.terraceStep),
          terrainRev: s.terrainRev + 1,
        }
      })
    },

    removeTerrainFeature: (id) => {
      set(s => {
        const terrainFeatures = s.terrainFeatures.filter(f => f.id !== id)
        const next = {
          terrainFeatures,
          heightmap: compositeHeightmap(terrainFeatures, s.terrainPaths, s.terrainDetail, s.table, s.terraceStep),
          terrainRev: s.terrainRev + 1,
          selectedFeatureId: s.selectedFeatureId === id ? null : s.selectedFeatureId,
        }
        return { ...next, ...saveHistory({ ...s, ...next }) }
      })
    },

    // ---- Ditch path drawing ----
    // Non-deforming while in progress (ThreeStage draws a flat preview
    // ribbon) — nothing touches terrainPaths/heightmap until finishPathDraw.
    addPathPoint: (worldX, worldZ) => {
      const s = get()
      if (s.landformArmed !== 'ditch') return
      const hw = s.table.width / 2, hh = s.table.height / 2
      const point = { x: THREE.MathUtils.clamp(worldX, -hw, hw), z: THREE.MathUtils.clamp(worldZ, -hh, hh) }
      set(st => ({
        pathDrawing: st.pathDrawing
          ? { points: [...st.pathDrawing.points, point] }
          : { points: [point] },
      }))
    },

    undoLastPathPoint: () => {
      set(s => {
        if (!s.pathDrawing || s.pathDrawing.points.length === 0) return {}
        const points = s.pathDrawing.points.slice(0, -1)
        return { pathDrawing: points.length ? { points } : null }
      })
    },

    finishPathDraw: () => {
      const s = get()
      const points = s.pathDrawing?.points ?? []
      if (points.length < 2) {
        // Nothing to commit — Finish with <2 points just backs out, same as Cancel.
        set({ pathDrawing: null, landformArmed: null })
        return
      }
      const path = defaultPath('ditch', points)
      set(st => {
        const terrainPaths = [...st.terrainPaths, path]
        const next = {
          terrainPaths,
          pathDrawing: null,
          landformArmed: null,
          heightmap: compositeHeightmap(st.terrainFeatures, terrainPaths, st.terrainDetail, st.table, st.terraceStep),
          terrainRev: st.terrainRev + 1,
          selectedPathId: path.id,
          selectedFeatureId: null,
        }
        return { ...next, ...saveHistory({ ...st, ...next }) }
      })
    },

    cancelPathDraw: () => set({ pathDrawing: null, landformArmed: null }),

    updateTerrainPathLive: (id, patch) => {
      set(s => {
        const terrainPaths = s.terrainPaths.map(p => p.id === id ? { ...p, ...patch } : p)
        return {
          terrainPaths,
          heightmap: compositeHeightmap(s.terrainFeatures, terrainPaths, s.terrainDetail, s.table, s.terraceStep),
          terrainRev: s.terrainRev + 1,
        }
      })
    },

    moveTerrainPathLive: (id, dx, dz) => {
      set(s => {
        const terrainPaths = s.terrainPaths.map(p => p.id === id ? translatePath(p, dx, dz, s.table) : p)
        return {
          terrainPaths,
          heightmap: compositeHeightmap(s.terrainFeatures, terrainPaths, s.terrainDetail, s.table, s.terraceStep),
          terrainRev: s.terrainRev + 1,
        }
      })
    },

    removeTerrainPath: (id) => {
      set(s => {
        const terrainPaths = s.terrainPaths.filter(p => p.id !== id)
        const next = {
          terrainPaths,
          heightmap: compositeHeightmap(s.terrainFeatures, terrainPaths, s.terrainDetail, s.table, s.terraceStep),
          terrainRev: s.terrainRev + 1,
          selectedPathId: s.selectedPathId === id ? null : s.selectedPathId,
        }
        return { ...next, ...saveHistory({ ...s, ...next }) }
      })
    },

    ensurePaintMap: () => {
      const s = get()
      if (!paintFitsTable(s.paint, s.table)) {
        set({ paint: createPaintMap(s.table), paintRev: s.paintRev + 1 })
      }
    },

    paintTerrain: (worldX, worldZ) => {
      const s = get()
      let pm = s.paint
      if (!paintFitsTable(pm, s.table)) pm = createPaintMap(s.table)
      const material = s.terrainTool === 'erase' ? null : s.paintMaterial
      const changed = applyPaintBrush(pm, s.table, worldX, worldZ, material, s.brushRadius)
      if (changed) set({ paint: pm, paintRev: s.paintRev + 1 })
      return changed
    },

    // "Reset terrain" clears both layers — the freehand detail AND every landform
    // stamp — back to a flat table. (Confirmed via a dialog in the UI already.)
    resetTerrain: () => set(s => ({
      terrainDetail: createHeightmap(s.table),
      terrainFeatures: [],
      terrainPaths: [],
      pathDrawing: null,
      heightmap: null,
      selectedFeatureId: null,
      selectedPathId: null,
      terrainRev: s.terrainRev + 1,
    })),

    resetPaint: () => set(s => ({ paint: createPaintMap(s.table), paintRev: s.paintRev + 1 })),

    // Camera framing is owned by the constrained BuilderCamera in ThreeStage.
    fitView: () => {
      get().cameraApi?.frameTable()
    },
    
    loadAssetCatalogue: async () => {
      let assets: Asset[]
      try {
        assets = await loadAssetsFromAPI()
        set({ assets })
      } catch {
        assets = loadAssets()
        set({ assets })
      }

      // Published bundles → palette groups (members filtered to loaded catalogue).
      try {
        const assetIds = new Set(assets.map((a) => a.id))
        const apiBundles = await bundlesApi.list()
        const bundles: PlannerBundle[] = apiBundles.map((b) => ({
          id: b.id,
          name: b.name,
          thumbnail: b.thumbnailUrl,
          price: b.price,
          artistId: b.artistId,
          artistName: b.artistName,
          modelIds: b.models.map((m) => m.id).filter((id) => assetIds.has(id)),
        }))
        set({ bundles })
      } catch {
        /* bundles are optional — ignore if unreachable */
      }

      // Published multi-part "set" models: each part becomes a placeable asset,
      // grouped under the set (kept off the flat catalogue).
      try {
        const { sets, partAssets } = await loadSetsFromAPI()
        set({ sets, setPartAssets: partAssets })
      } catch {
        /* sets are optional — ignore if unreachable */
      }

      // What the signed-in user already owns (guests get 401 → empty).
      try {
        const ent = await ordersApi.getEntitlements()
        set({ ownedModelIds: ent.models, ownedBundleIds: ent.bundles })
      } catch {
        set({ ownedModelIds: new Set(), ownedBundleIds: new Set() })
      }

      // The signed-in artist's own models (incl. unpublished drafts), so they can
      // lay out pieces before release. Empty for guests/customers (endpoint 403s).
      set({ myModels: await loadMyModelsForPlanner() })

      // Facet tree for the palette filter rail (counts when tagged, tree otherwise).
      set({ catalogueFacets: await loadCatalogueFacets(undefined) })
    },

    // Re-query the catalogue for a class / facet selection. Only the catalogue
    // assets + facet counts change here (bundles/sets/ownership are class-agnostic).
    setCatalogueFilter: async ({ modelClass, terms }) => {
      const s = get()
      const nextClass = modelClass !== undefined ? modelClass : s.catalogueClass
      const nextTerms = terms !== undefined ? terms : s.catalogueTerms
      set({ catalogueClass: nextClass, catalogueTerms: nextTerms, catalogueLoading: true })

      const termsStr = buildCatalogueTerms(nextClass, nextTerms)
      try {
        const assets = await loadAssetsFromAPI({ terms: termsStr })
        set({ assets })
      } catch {
        /* keep the previous catalogue on error */
      }
      set({ catalogueFacets: await loadCatalogueFacets(termsStr) })
      set({ catalogueLoading: false })
    },

    loadStarterLayout: () => {
      // A small, tidy default scene so the planner never opens onto an empty void.
      // Uses whatever assets are available; silently skips any that aren't loaded.
      const { assets, table } = get()
      if (!assets.length) return
      const byId = new Map(assets.map(a => [a.id, a]))
      const pick = (...ids: string[]) => ids.find(id => byId.has(id)) ?? assets[0]?.id
      // Spread across the table in absolute metres so pieces don't overlap.
      const hw = Math.min(table.width / 2 - 0.2, 0.55)
      const hh = Math.min(table.height / 2 - 0.2, 0.35)
      const plan: Array<{ id?: string; x: number; z: number; rot: number }> = [
        { id: pick('floor', 'bottom'), x: -hw, z: -hh, rot: 0 },
        { id: pick('bottom', 'top'), x: hw, z: -hh, rot: 0 },
        { id: pick('top', 'shutters'), x: hw, z: hh, rot: 90 },
        { id: pick('sandbags', 'barrel'), x: -hw, z: hh, rot: 0 },
        { id: pick('barrel', 'sandbags'), x: 0, z: 0, rot: 0 },
      ]
      const instances: Instance[] = []
      for (const p of plan) {
        if (!p.id || !byId.has(p.id)) continue
        instances.push({
          id: `i_${Math.random().toString(36).slice(2, 10)}`,
          assetId: p.id,
          position: { x: p.x, z: p.z },
          rotationDeg: p.rot,
          level: 0,
        })
      }
      set(s => ({
        instances,
        selectedInstanceId: null,
        selectedInstanceIds: [],
        ...saveHistory({ ...s, instances, selectedInstanceId: null }),
      }))
      get().actions.syncBasketWithTable()
    },

    addInstance: (i) => {
      const id = `i_${Math.random().toString(36).slice(2,10)}`
      // Apply the artist-baked default tilt (unless the caller set an explicit
      // pitch) so a model authored "lying down" stands upright when placed.
      const pitchDeg = i.pitchDeg ?? getAssetById(i.assetId)?.defaultPitchDeg ?? 0
      set(s => {
        const instances = [...s.instances, { ...i, id, pitchDeg }]
        return { instances, ...saveHistory({ ...s, instances }) }
      })
      get().actions.syncBasketWithTable()
      // Placing a model no longer auto-adds it to the shop basket — the planner's
      // right panel is a bill of materials for the table, and buying is an explicit
      // action ("Add all to basket"). This keeps an artist laying out their table
      // from silently filling their cart with other creators' pieces.
      // Purchase-intent analytics: log the placement against the parent model
      // (set parts count for their set). No-ops for demo/non-UUID asset ids.
      {
        const s = get()
        const parentSet = s.sets.find((set) => set.partAssetIds.includes(i.assetId))
        analyticsApi.placement(parentSet ? parentSet.id : i.assetId)
      }
      return id
    },

    updateInstance: (id, patch) => {
      set(s => {
        const instances = s.instances.map(inst => inst.id === id ? { ...inst, ...patch } : inst)
        return { instances, ...saveHistory({ ...s, instances }) }
      })
    },

    // Apply several transforms as one undoable step (drag/rotate of a multi-selection).
    updateInstances: (patches) => {
      if (!patches.length) return
      const byId = new Map(patches.map(p => [p.id, p.patch]))
      set(s => {
        const instances = s.instances.map(inst =>
          byId.has(inst.id) ? { ...inst, ...byId.get(inst.id)! } : inst,
        )
        return { instances, ...saveHistory({ ...s, instances }) }
      })
    },
    
    // Tilt every selected piece by deltaDeg about X, wrapped to [0,360). One
    // undoable step (updateInstances saves history).
    tiltSelected: (deltaDeg) => {
      const ids = get().selectedInstanceIds
      if (!ids.length) return
      const byId = new Map(get().instances.map(i => [i.id, i]))
      const patches = ids
        .map(id => {
          const i = byId.get(id)
          if (!i) return null
          const next = (((i.pitchDeg ?? 0) + deltaDeg) % 360 + 360) % 360
          return { id, patch: { pitchDeg: next } }
        })
        .filter((p): p is { id: string; patch: { pitchDeg: number } } => p !== null)
      get().actions.updateInstances(patches)
    },

    removeInstance: (id) => {
      set(s => {
        const instances = s.instances.filter(i => i.id !== id)
        const selectedInstanceId = s.selectedInstanceId === id ? null : s.selectedInstanceId
        return { instances, selectedInstanceId, ...saveHistory({ ...s, instances, selectedInstanceId }) }
      })
      get().actions.syncBasketWithTable()
    },
    
    removeInstances: (ids) => {
      if (!ids.length) return
      const remove = new Set(ids)
      set(s => {
        const instances = s.instances.filter(i => !remove.has(i.id))
        const selectedInstanceIds = s.selectedInstanceIds.filter(id => !remove.has(id))
        const selectedInstanceId =
          s.selectedInstanceId && remove.has(s.selectedInstanceId) ? null : s.selectedInstanceId
        return {
          instances,
          selectedInstanceId,
          selectedInstanceIds,
          ...saveHistory({ ...s, instances, selectedInstanceId }),
        }
      })
      get().actions.syncBasketWithTable()
    },

    clearInstances: () => {
      set(s => ({
        instances: [],
        selectedInstanceId: null,
        selectedInstanceIds: [],
        ...saveHistory({ ...s, instances: [], selectedInstanceId: null })
      }))
      get().actions.syncBasketWithTable()
    },

    duplicateInstance: (id) => {
      const instance = get().instances.find(i => i.id === id)
      if (!instance) return
      
      const newId = `i_${Math.random().toString(36).slice(2,10)}`
      const offset = get().table.gridSize
      
      set(s => {
        const instances = [...s.instances, {
          ...instance,
          id: newId,
          position: { x: instance.position.x + offset, z: instance.position.z + offset }
        }]
        return { instances, selectedInstanceId: newId, selectedInstanceIds: [newId], ...saveHistory({ ...s, instances, selectedInstanceId: newId }) }
      })
      get().actions.syncBasketWithTable()
    },

    duplicateInstances: (ids) => {
      const set0 = new Set(ids)
      const source = get().instances.filter(i => set0.has(i.id))
      if (!source.length) return []
      const offset = get().table.gridSize
      const newIds: string[] = []
      const copies: Instance[] = source.map(inst => {
        const newId = `i_${Math.random().toString(36).slice(2, 10)}`
        newIds.push(newId)
        return {
          ...inst,
          id: newId,
          position: { x: inst.position.x + offset, z: inst.position.z + offset },
        }
      })
      set(s => {
        const instances = [...s.instances, ...copies]
        return {
          instances,
          selectedInstanceId: newIds[newIds.length - 1] ?? null,
          selectedInstanceIds: newIds,
          ...saveHistory({ ...s, instances, selectedInstanceId: newIds[newIds.length - 1] ?? null }),
        }
      })
      get().actions.syncBasketWithTable()
      return newIds
    },

    // The USP: push the whole tabletop design into the real shop cart in one click.
    // Digital STLs are bought once (print as many copies as you like), so each
    // unique model on the table is added to the cart a single time.
    addLayoutToShopCart: () => {
      const { instances, assets } = get()
      const uniqueAssetIds = new Set(instances.map(inst => inst.assetId))
      const assetsById = new Map(assets.map(a => [a.id, a]))

      const cart = useCartStore.getState()
      let added = 0
      uniqueAssetIds.forEach(assetId => {
        const asset = assetsById.get(assetId)
        if (!asset) return
        if (cart.hasItem('model', assetId)) return // already in cart
        cart.addItem({
          kind: 'model',
          id: assetId,
          name: asset.name,
          artistName: asset.artistName ?? 'Artifact Armoury',
          price: asset.price ?? 0,
          imageUrl: asset.thumbnail,
        })
        added += 1
      })
      cart.openCart()
      return added
    },

    undo: () => {
      const s = get()
      if (s.historyIndex <= 0) return

      const newIndex = s.historyIndex - 1
      const state = s.history[newIndex]

      const terrainDetail = cloneHeightmap(state.terrainDetail)
      const terrainFeatures = cloneFeatures(state.terrainFeatures)
      const terrainPaths = clonePaths(state.terrainPaths)
      set({
        instances: JSON.parse(JSON.stringify(state.instances)),
        selectedInstanceId: state.selectedInstanceId,
        selectedInstanceIds: state.selectedInstanceId ? [state.selectedInstanceId] : [],
        terrainDetail,
        terrainFeatures,
        terrainPaths,
        pathDrawing: null,
        heightmap: compositeHeightmap(terrainFeatures, terrainPaths, terrainDetail, s.table, s.terraceStep),
        selectedFeatureId: null,
        selectedPathId: null,
        paint: clonePaintMap(state.paint),
        terrainRev: s.terrainRev + 1,
        paintRev: s.paintRev + 1,
        historyIndex: newIndex
      })
      get().actions.syncBasketWithTable()
    },

    redo: () => {
      const s = get()
      if (s.historyIndex >= s.history.length - 1) return

      const newIndex = s.historyIndex + 1
      const state = s.history[newIndex]

      const terrainDetail = cloneHeightmap(state.terrainDetail)
      const terrainFeatures = cloneFeatures(state.terrainFeatures)
      const terrainPaths = clonePaths(state.terrainPaths)
      set({
        instances: JSON.parse(JSON.stringify(state.instances)),
        selectedInstanceId: state.selectedInstanceId,
        selectedInstanceIds: state.selectedInstanceId ? [state.selectedInstanceId] : [],
        terrainDetail,
        terrainFeatures,
        terrainPaths,
        pathDrawing: null,
        heightmap: compositeHeightmap(terrainFeatures, terrainPaths, terrainDetail, s.table, s.terraceStep),
        selectedFeatureId: null,
        selectedPathId: null,
        paint: clonePaintMap(state.paint),
        terrainRev: s.terrainRev + 1,
        paintRev: s.paintRev + 1,
        historyIndex: newIndex
      })
      get().actions.syncBasketWithTable()
    },

    // Commit a terrain/paint stroke (or any external change) as one undo step.
    commitHistory: () => set(s => saveHistory(s)),

    // Ensure the timeline has a baseline snapshot so the very first edit (place,
    // sculpt or paint) can be undone back to the starting state.
    ensureInitialHistory: () => {
      const s = get()
      if (s.history.length === 0) set(saveHistory(s))
    },

    canUndo: () => get().historyIndex > 0,
    canRedo: () => get().historyIndex < get().history.length - 1,

    saveLayout: (name: string) => {
      const { table, instances } = get()
      const id = `layout_${Date.now()}_${Math.random().toString(36).slice(2,9)}`
      
      const layout: SavedLayout = {
        id,
        name,
        table: { ...table },
        instances: JSON.parse(JSON.stringify(instances)),
        createdAt: Date.now()
      }
      
      const saved = get().actions.getSavedLayouts()
      saved.push(layout)
      localStorage.setItem('terrain_layouts', JSON.stringify(saved))
      
      return id
    },

    loadLayout: (id: string) => {
      const layouts = get().actions.getSavedLayouts()
      const layout = layouts.find(l => l.id === id)
      if (!layout) return
      
      set(s => ({
        table: { ...layout.table },
        instances: JSON.parse(JSON.stringify(layout.instances)),
        selectedInstanceId: null,
        ...saveHistory({ 
          ...s, 
          instances: JSON.parse(JSON.stringify(layout.instances)),
          selectedInstanceId: null 
        })
      }))
      get().actions.syncBasketWithTable()
      get().actions.fitView()
    },

    applyLayout: ({ table, tableMaterial, instances, terrainDetail, terrainFeatures, terrainPaths, terraceStep, paint }) => {
      const clean: Instance[] = JSON.parse(JSON.stringify(instances))
      const detail = terrainDetail ?? null
      const features = terrainFeatures ?? []
      const paths = terrainPaths ?? []
      const step = terraceStep ?? 0
      const pm = paint ?? null
      const hm = compositeHeightmap(features, paths, detail, table, step)
      set((s) => ({
        table: { ...table },
        tableMaterial: tableMaterial ?? s.tableMaterial,
        instances: clean,
        terrainDetail: detail,
        terrainFeatures: features,
        terrainPaths: paths,
        pathDrawing: null,
        terraceStep: step,
        heightmap: hm,
        selectedFeatureId: null,
        selectedPathId: null,
        landformArmed: null,
        paint: pm,
        terrainRev: s.terrainRev + 1,
        paintRev: s.paintRev + 1,
        terrainTool: 'none',
        selectedInstanceId: null,
        selectedInstanceIds: [],
        // Reset the timeline to this loaded state as the baseline.
        history: [],
        historyIndex: -1,
        ...saveHistory({
          ...s, instances: clean, selectedInstanceId: null,
          terrainDetail: detail, terrainFeatures: features, terrainPaths: paths, paint: pm,
          history: [], historyIndex: -1,
        }),
      }))
      get().actions.syncBasketWithTable()
      get().actions.fitView()
    },

    getSavedLayouts: () => {
      const saved = localStorage.getItem('terrain_layouts')
      return saved ? JSON.parse(saved) : []
    },

    deleteLayout: (id: string) => {
      const layouts = get().actions.getSavedLayouts().filter(l => l.id !== id)
      localStorage.setItem('terrain_layouts', JSON.stringify(layouts))
    },

    exportLayout: () => {
      const { table, instances } = get()
      return JSON.stringify({ table, instances }, null, 2)
    },

    importLayout: (json: string) => {
      try {
        const { table, instances } = JSON.parse(json)
        set(s => ({
          table,
          instances,
          selectedInstanceId: null,
          ...saveHistory({ ...s, instances, selectedInstanceId: null })
        }))
        get().actions.syncBasketWithTable()
        get().actions.fitView()
      } catch (e) {
        console.error('Failed to import layout:', e)
      }
    },

    syncBasketWithTable: () => {
      const { instances, assets } = get()
      const counts = new Map<string, number>()
      instances.forEach(inst => {
        counts.set(inst.assetId, (counts.get(inst.assetId) || 0) + 1)
      })

      const assetsById = new Map(assets.map(a => [a.id, a]))

      const basket: BasketItem[] = []
      counts.forEach((count, assetId) => {
        const fulfillment: 'stl' | 'print' = assetsById.get(assetId)?.fulfillment ?? 'print'
        const isSTL = fulfillment === 'stl'
        basket.push({
          assetId,
          quantity: count,
          fulfillment,
          isFirstPurchase: true,
          firstQty: 1,
          repeatQty: isSTL ? 0 : Math.max(0, count - 1),
        })
      })

      set({ basket })
    },

    addToBasket: (assetId, quantity = 1) => {
      set(s => {
        const existing = s.basket.find(item => item.assetId === assetId)
        if (existing) {
          return {
            basket: s.basket.map(item =>
              item.assetId === assetId
                ? { ...item, quantity: item.quantity + quantity, repeatQty: (item.repeatQty || 0) + quantity }
                : item
            )
          }
        }
        return {
          basket: [...s.basket, { assetId, quantity, isFirstPurchase: true, firstQty: 1, repeatQty: quantity - 1 }]
        }
      })
    },

    removeFromBasket: (assetId) => {
      set(s => ({
        instances: s.instances.filter(inst => inst.assetId !== assetId),
        basket: s.basket.filter(item => item.assetId !== assetId)
      }))
    },

    updateBasketQuantity: (assetId, quantity) => {
      if (quantity <= 0) {
        get().actions.removeFromBasket(assetId)
        return
      }
      
      const { instances } = get()
      const currentCount = instances.filter(inst => inst.assetId === assetId).length
      
      if (quantity < currentCount) {
        const toRemove = currentCount - quantity
        const instancesOfType = instances.filter(inst => inst.assetId === assetId)
        const idsToRemove = instancesOfType.slice(0, toRemove).map(i => i.id)
        
        set(s => ({
          instances: s.instances.filter(inst => !idsToRemove.includes(inst.id))
        }))
        get().actions.syncBasketWithTable()
      }
    },

    clearBasket: () => {
      set({ basket: [], instances: [] })
    },

    markAsPurchased: (assetIds) => {
      set(s => ({
        purchasedAssetIds: new Set([...s.purchasedAssetIds, ...assetIds])
      }))
    },

    addLayoutToBasket: () => {
      // Already synced automatically
    }
  }
}))