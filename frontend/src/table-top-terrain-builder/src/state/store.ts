// src/state/store.ts
import { create } from 'zustand'
import * as THREE from 'three'
import { loadAssets, loadAssetsFromAPI, loadSetsFromAPI, type Asset, type PlannerSetData } from '../core/assets'
import {
  type Heightmap, type TerrainTool, createHeightmap, heightmapFitsTable, applyBrush,
} from '../core/heightmap'
import type { BasketItem } from '../core/pricing'       // ← And this
import { useCartStore } from '@/store/cartStore'
import { bundlesApi } from '@/api/endpoints/bundles'
import { ordersApi } from '@/api/endpoints/orders'
import { analyticsApi } from '@/api/endpoints/analytics'

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
}

interface AppState {
  table: Table
  scene: THREE.Scene | null
  camera: THREE.PerspectiveCamera | null
  renderer: THREE.WebGLRenderer | null

  assets: Asset[]
  bundles: PlannerBundle[]           // published bundles (palette grouping)
  sets: PlannerSetData[]             // published multi-part "set" models (grouping)
  setPartAssets: Asset[]             // the sets' part assets (kept off the catalogue)
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

  // Terrain sculpting (deformable table surface → printable tiles later)
  heightmap: Heightmap | null  // null = flat table (no surface edits yet)
  terrainTool: TerrainTool     // 'none' = placement mode; otherwise a sculpt brush
  brushRadius: number          // metres
  brushStrength: number        // 0..1
  terrainRev: number           // bumped on every sculpt so the scene re-syncs

  basket: BasketItem[]
  purchasedAssetIds: Set<string>

  // History for undo/redo
  history: HistoryState[]
  historyIndex: number
  maxHistory: number

  // Camera modes
  cameraMode: 'perspective' | 'top-down' | 'isometric'
  cameraApi: CameraApi | null

  setTable: (t: Partial<Table>) => void
  setRefs: (s: Partial<Pick<AppState,'scene'|'camera'|'renderer'>>) => void
  setSelectedAsset: (id: string | null) => void
  setSelectedInstance: (id: string | null) => void
  setSelectedInstances: (ids: string[]) => void
  setCameraMode: (mode: 'perspective' | 'top-down' | 'isometric') => void
  setCameraApi: (api: CameraApi | null) => void
  setSnapBaseline: (b: SnapBaseline) => void
  toggleSnapBaseline: () => void
  setAltMomentary: (v: boolean) => void
  setPlacement: (level: number, manual: boolean) => void
  setTableMaterial: (id: string) => void

  setTerrainTool: (tool: TerrainTool) => void
  setBrush: (patch: Partial<{ radius: number; strength: number }>) => void

  actions: {
    /** Sculpt the surface at a world position with the active brush. Returns true if changed. */
    sculptTerrain: (worldX: number, worldZ: number) => boolean
    /** Reset the surface back to flat. */
    resetTerrain: () => void
    /** Ensure a heightmap exists that fits the current table (creates/regenerates). */
    ensureHeightmap: () => void
    fitView: () => void
    loadAssetCatalogue: () => Promise<void>
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
    applyLayout: (data: { table: Table; tableMaterial?: string; instances: Instance[]; heightmap?: Heightmap | null }) => void
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
    /** Add a just-placed catalogue model to the shop cart (bundle-aware). */
    addPlacedModelToShopCart: (assetId: string) => void
  }
}

// Helper to save history
function saveHistory(state: AppState): Partial<AppState> {
  const newHistory = state.history.slice(0, state.historyIndex + 1)
  newHistory.push({
    instances: JSON.parse(JSON.stringify(state.instances)),
    selectedInstanceId: state.selectedInstanceId
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
  table: { width: 1.8288, height: 1.2192, unitDisplay: 'ft', gridSize: 0.0254 },
  scene: null,
  camera: null,
  renderer: null,

  assets: [],
  bundles: [],
  sets: [],
  setPartAssets: [],
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
  terrainTool: 'none',
  brushRadius: 0.12,
  brushStrength: 0.5,
  terrainRev: 0,

  basket: [],
  purchasedAssetIds: new Set(),

  history: [],
  historyIndex: -1,
  maxHistory: 50,

  cameraMode: 'perspective',
  cameraApi: null,

  setTable: (t) => set(s => ({ table: { ...s.table, ...t } })),
  setRefs: (refs) => set(refs as any),
  // Placement and terrain sculpting are mutually exclusive — picking a model to
  // place leaves sculpt mode.
  setSelectedAsset: (id) => set(s => ({ selectedAssetId: id, terrainTool: id ? 'none' : s.terrainTool })),
  setSelectedInstance: (id) =>
    set({ selectedInstanceId: id, selectedInstanceIds: id ? [id] : [] }),
  setSelectedInstances: (ids) =>
    set({ selectedInstanceIds: ids, selectedInstanceId: ids.length ? ids[ids.length - 1] : null }),
  setCameraMode: (mode) => set({ cameraMode: mode }),
  setCameraApi: (api) => set({ cameraApi: api }),
  setSnapBaseline: (b) => set({ snapBaseline: b }),
  toggleSnapBaseline: () => set(s => ({ snapBaseline: s.snapBaseline === 'snap' ? 'free' : 'snap' })),
  setAltMomentary: (v) => set({ altMomentary: v }),
  setPlacement: (level, manual) => set(s =>
    s.placementLevel === level && s.placementManual === manual
      ? {}
      : { placementLevel: level, placementManual: manual }),
  setTableMaterial: (id) => set({ tableMaterial: id }),

  setTerrainTool: (tool) => {
    // Entering a sculpt tool clears any pending model placement (mutually exclusive).
    if (tool !== 'none') { get().actions.ensureHeightmap(); set({ selectedAssetId: null }) }
    set({ terrainTool: tool })
  },
  setBrush: (patch) => set(s => ({
    brushRadius: patch.radius != null ? patch.radius : s.brushRadius,
    brushStrength: patch.strength != null ? patch.strength : s.brushStrength,
  })),

  actions: {
    ensureHeightmap: () => {
      const s = get()
      if (!heightmapFitsTable(s.heightmap, s.table)) {
        set({ heightmap: createHeightmap(s.table), terrainRev: s.terrainRev + 1 })
      }
    },

    sculptTerrain: (worldX, worldZ) => {
      const s = get()
      if (s.terrainTool === 'none') return false
      let hm = s.heightmap
      if (!heightmapFitsTable(hm, s.table)) hm = createHeightmap(s.table)
      const changed = applyBrush(hm, s.table, worldX, worldZ, s.terrainTool, s.brushRadius, s.brushStrength)
      if (changed) set({ heightmap: hm, terrainRev: s.terrainRev + 1 })
      return changed
    },

    resetTerrain: () => set(s => ({ heightmap: createHeightmap(s.table), terrainRev: s.terrainRev + 1 })),

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
      set(s => {
        const instances = [...s.instances, { ...i, id }]
        return { instances, ...saveHistory({ ...s, instances }) }
      })
      get().actions.syncBasketWithTable()
      // Placing a catalogue model you don't already own/have drops it into the
      // shop basket, so it surfaces in the palette's "My items" tab.
      get().actions.addPlacedModelToShopCart(i.assetId)
      // Purchase-intent analytics: log the placement against the parent model
      // (set parts count for their set). No-ops for demo/non-UUID asset ids.
      {
        const s = get()
        const parentSet = s.sets.find((set) => set.partAssetIds.includes(i.assetId))
        analyticsApi.placement(parentSet ? parentSet.id : i.assetId)
      }
      return id
    },

    // Add a just-placed model to the shop cart unless it's already owned, in the
    // cart, or covered by an owned/in-cart bundle (bundle+standalone would clash
    // at checkout). For a "set" part, the purchasable unit is the PARENT model.
    // Does not pop the cart drawer open.
    addPlacedModelToShopCart: (assetId) => {
      const s = get()
      // If the placed asset is a part of a set, buy the parent model (one purchase
      // unlocks all parts).
      const parentSet = s.sets.find(set => set.partAssetIds.includes(assetId))
      const modelId = parentSet ? parentSet.id : assetId

      if (s.ownedModelIds.has(modelId)) return
      const inOwnedBundle = s.bundles.some(b => s.ownedBundleIds.has(b.id) && b.modelIds.includes(modelId))
      if (inOwnedBundle) return

      const cart = useCartStore.getState()
      if (cart.hasItem('model', modelId)) return
      const cartBundleIds = new Set(cart.items.filter(it => it.kind === 'bundle').map(it => it.id))
      const inCartBundle = s.bundles.some(b => cartBundleIds.has(b.id) && b.modelIds.includes(modelId))
      if (inCartBundle) return

      // Name/price/thumbnail come from the set (parent) or the placed asset.
      let item
      if (parentSet) {
        item = { kind: 'model' as const, id: modelId, name: parentSet.name, artistName: 'Artifact Planner', price: parentSet.price, imageUrl: parentSet.thumbnail }
      } else {
        const asset = s.assets.find(a => a.id === assetId)
        if (!asset) return
        item = { kind: 'model' as const, id: assetId, name: asset.name, artistName: asset.artistName ?? 'Artifact Planner', price: asset.price ?? 0, imageUrl: asset.thumbnail }
      }
      cart.addItem(item, false) // don't open the drawer over the planner
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
          artistName: asset.artistName ?? 'Artifact Planner',
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
      
      set({
        instances: JSON.parse(JSON.stringify(state.instances)),
        selectedInstanceId: state.selectedInstanceId,
        selectedInstanceIds: state.selectedInstanceId ? [state.selectedInstanceId] : [],
        historyIndex: newIndex
      })
      get().actions.syncBasketWithTable()
    },

    redo: () => {
      const s = get()
      if (s.historyIndex >= s.history.length - 1) return

      const newIndex = s.historyIndex + 1
      const state = s.history[newIndex]

      set({
        instances: JSON.parse(JSON.stringify(state.instances)),
        selectedInstanceId: state.selectedInstanceId,
        selectedInstanceIds: state.selectedInstanceId ? [state.selectedInstanceId] : [],
        historyIndex: newIndex
      })
      get().actions.syncBasketWithTable()
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

    applyLayout: ({ table, tableMaterial, instances, heightmap }) => {
      const clean: Instance[] = JSON.parse(JSON.stringify(instances))
      set((s) => ({
        table: { ...table },
        tableMaterial: tableMaterial ?? s.tableMaterial,
        instances: clean,
        heightmap: heightmap ?? null,
        terrainRev: s.terrainRev + 1,
        terrainTool: 'none',
        selectedInstanceId: null,
        selectedInstanceIds: [],
        ...saveHistory({ ...s, instances: clean, selectedInstanceId: null }),
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