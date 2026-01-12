// src/state/store.ts
import { create } from 'zustand'
import * as THREE from 'three'
import type { Asset } from '../core/assets'
import apiClient from '@/api/client'
import type { LibraryAsset } from '@/store/libraryStore'
import type { BasketItem } from '../core/pricing'       // ← And this
import { useCartStore } from '@/store/cartStore'

export type Unit = 'm'|'cm'|'ft'|'in'
export type Table = { width: number; height: number; unitDisplay: Unit; gridSize: number }

export type Instance = {
  id: string
  assetId: string
  position: { x: number; z: number }
  rotationDeg: number  // Y axis rotation (horizontal)
  rotationX?: number   // X axis rotation (tip forward/back)
  rotationZ?: number   // Z axis rotation (roll left/right)
  swapXZ?: boolean     // Swap X and Z dimensions
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
  selectedAssetId: string | null
  instances: Instance[]
  selectedInstanceId: string | null

  basket: BasketItem[]
  purchasedAssetIds: Set<string>

  // History for undo/redo
  history: HistoryState[]
  historyIndex: number
  maxHistory: number

  // Camera modes
  cameraMode: 'perspective' | 'top-down' | 'isometric'

  setTable: (t: Partial<Table>) => void
  setRefs: (s: Partial<Pick<AppState,'scene'|'camera'|'renderer'>>) => void
  setSelectedAsset: (id: string | null) => void
  setSelectedInstance: (id: string | null) => void
  setCameraMode: (mode: 'perspective' | 'top-down' | 'isometric') => void

  actions: {
    fitView: () => void
    loadAssetCatalogue: () => void
    addInstance: (i: Omit<Instance,'id'>) => void
    updateInstance: (id: string, patch: Partial<Omit<Instance,'id'|'assetId'>>) => void
    removeInstance: (id: string) => void
    clearInstances: () => void
    duplicateInstance: (id: string) => void
    
    // Undo/Redo
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    
    // Save/Load
    saveLayout: (name: string) => string
    loadLayout: (id: string) => void
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
    upsertLibraryAsset: (asset: LibraryAsset) => void
    removeLibraryAsset: (assetId: string) => void
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const DEFAULT_GRID_SIZE = 0.3048
const builderManagedModelIds = new Set<string>()

const normaliseUploadUrl = (path?: string | null): string | undefined => {
  if (!path) return undefined
  if (/^https?:\/\//i.test(path)) {
    return path
  }
  const normalised = path.replace(/^\/+/, '').replace(/^uploads\//i, '')
  const urlPath = `/uploads/${normalised}`
  return API_BASE_URL ? `${API_BASE_URL}${urlPath}` : urlPath
}

const normaliseDimension = (value?: number | null): number | undefined => {
  if (value === null || value === undefined) return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  if (numeric > 10) {
    // Likely provided in millimetres
    return numeric / 1000
  }
  return numeric
}

const buildFootprint = (width: number, depth: number, gridSize = DEFAULT_GRID_SIZE) => {
  return {
    cols: Math.max(1, Math.ceil(width / gridSize)),
    rows: Math.max(1, Math.ceil(depth / gridSize)),
  }
}

function convertLibraryAssetToSceneAsset(asset: LibraryAsset): Asset | null {
  const glbUrl = normaliseUploadUrl(asset.glb_file_path)
  if (!glbUrl) {
    return null
  }

  const width = normaliseDimension(asset.width) ?? 0.15
  const depth = normaliseDimension(asset.depth) ?? 0.15
  const height = normaliseDimension(asset.height) ?? 0.15

  const priceRaw = asset.base_price ?? 0
  const price = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw)

  const tags = Array.isArray(asset.tags) ? asset.tags : []
  const artistName =
    asset.artistName ?? asset.artist_name ?? asset.artist_display_name ?? 'Unknown Artist'

  return {
    id: asset.id,
    name: asset.name,
    tags,
    aabb: { x: width, z: depth, y: height },
    footprint: buildFootprint(width, depth),
    rotationStepDeg: 90,
    price: Number.isFinite(price) && price > 0 ? price : undefined,
    sku: asset.file_ref ?? undefined,
    model: glbUrl,
    thumbnail: normaliseUploadUrl(asset.thumbnail_path ?? asset.preview_url),
    assetLibraryId: asset.id,
    sourceModelId: asset.modelId ?? asset.model_id ?? undefined,
    artistName: artistName ?? undefined,
    previewUrl: normaliseUploadUrl(asset.preview_url),
  }
}

const syncCartWithModelCounts = (modelCounts: Map<string, { count: number; asset: Asset }>) => {
  const managedIds = new Set<string>([...builderManagedModelIds, ...modelCounts.keys()])
  const initialItems = useCartStore.getState().items

  initialItems.forEach((item) => {
    if (!managedIds.has(item.modelId)) {
      return
    }
    const target = modelCounts.get(item.modelId)
    if (!target || target.count <= 0) {
      useCartStore.getState().removeItem(item.modelId)
      return
    }
    if (item.quantity !== target.count) {
      useCartStore.getState().updateQuantity(item.modelId, target.count)
    }
  })

  modelCounts.forEach(({ count, asset }, modelId) => {
    const existing = useCartStore.getState().items.find((item) => item.modelId === modelId)
    if (!existing) {
      useCartStore.getState().addItem(
        {
          modelId,
          name: asset.name,
          artistName: asset.artistName ?? 'Unknown Artist',
          price: asset.price ?? 0,
          imageUrl: asset.thumbnail,
        },
        { openCart: false },
      )
      if (count > 1) {
        useCartStore.getState().updateQuantity(modelId, count)
      }
      return
    }

    if (existing.quantity !== count) {
      useCartStore.getState().updateQuantity(modelId, count)
    }
  })

  const updatedItems = useCartStore.getState().items
  updatedItems.forEach((item) => {
    if (managedIds.has(item.modelId) && !modelCounts.has(item.modelId)) {
      useCartStore.getState().removeItem(item.modelId)
    }
  })

  builderManagedModelIds.clear()
  modelCounts.forEach((_value, modelId) => {
    builderManagedModelIds.add(modelId)
    managedIds.add(modelId)
  })
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
  table: { width: 1.8288, height: 1.2192, unitDisplay: 'm', gridSize: 0.3048 },
  scene: null,
  camera: null,
  renderer: null,

  assets: [],
  selectedAssetId: null,
  instances: [],
  selectedInstanceId: null,

  basket: [],
  purchasedAssetIds: new Set(),

  history: [],
  historyIndex: -1,
  maxHistory: 50,

  cameraMode: 'perspective',

  setTable: (t) => set(s => ({ table: { ...s.table, ...t } })),
  setRefs: (refs) => set(refs as any),
  setSelectedAsset: (id) => set({ selectedAssetId: id }),
  setSelectedInstance: (id) => set({ selectedInstanceId: id }),
  setCameraMode: (mode) => set({ cameraMode: mode }),

  actions: {
    fitView: () => {
      const { camera, renderer, table, cameraMode } = get()
      if (!camera || !renderer) return
      
      const maxDim = Math.max(table.width, table.height)
      const distance = maxDim * 1.2 / Math.tan(THREE.MathUtils.degToRad(camera.fov/2))
      
      if (cameraMode === 'top-down') {
        camera.position.set(table.width/2, distance * 0.8, table.height/2)
        camera.lookAt(table.width/2, 0, table.height/2)
      } else if (cameraMode === 'isometric') {
        camera.position.set(distance * 0.7, distance * 0.7, distance * 0.7)
        camera.lookAt(table.width/2, 0, table.height/2)
      } else {
        camera.position.set(maxDim*0.6, distance, distance)
        camera.lookAt(table.width/2, 0, table.height/2)
      }
      
      ;(camera as any).controlsTarget?.set(table.width/2, 0, table.height/2)
      camera.updateProjectionMatrix()
    },
    
    loadAssetCatalogue: async () => {
      let nextAssets: Asset[] = []
      try {
        const response = await apiClient.get<{ assets: LibraryAsset[] }>('/api/library/assets', {
          params: { limit: 500 },
        })
        const assets = response.data?.assets ?? []
        const converted = assets
          .map(convertLibraryAssetToSceneAsset)
          .filter((asset): asset is Asset => Boolean(asset))
        nextAssets = converted
      } catch (error) {
        console.error('Failed to load asset library', error)
      }
      set(() => ({ assets: nextAssets }))
      get().actions.syncBasketWithTable()
    },
    
    addInstance: (i) => {
      const id = `i_${Math.random().toString(36).slice(2,10)}`
      set(s => {
        const instances = [...s.instances, { ...i, id }]
        return { instances, ...saveHistory({ ...s, instances }) }
      })
      get().actions.syncBasketWithTable()
    },
    
    updateInstance: (id, patch) => {
      set(s => {
        const instances = s.instances.map(inst => inst.id === id ? { ...inst, ...patch } : inst)
        return { instances, ...saveHistory({ ...s, instances }) }
      })
    },
    
    removeInstance: (id) => {
      set(s => {
        const instances = s.instances.filter(i => i.id !== id)
        const selectedInstanceId = s.selectedInstanceId === id ? null : s.selectedInstanceId
        return { instances, selectedInstanceId, ...saveHistory({ ...s, instances, selectedInstanceId }) }
      })
      get().actions.syncBasketWithTable()
    },
    
    clearInstances: () => {
      set(s => ({ 
        instances: [], 
        selectedInstanceId: null,
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
        return { instances, selectedInstanceId: newId, ...saveHistory({ ...s, instances, selectedInstanceId: newId }) }
      })
      get().actions.syncBasketWithTable()
    },

    undo: () => {
      const s = get()
      if (s.historyIndex <= 0) return
      
      const newIndex = s.historyIndex - 1
      const state = s.history[newIndex]
      
      set({ 
        instances: JSON.parse(JSON.stringify(state.instances)),
        selectedInstanceId: state.selectedInstanceId,
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
      const { instances } = get()
      const counts = new Map<string, number>()
      instances.forEach(inst => {
        counts.set(inst.assetId, (counts.get(inst.assetId) || 0) + 1)
      })

      const assetsById = new Map<string, Asset>()
      get().assets.forEach(asset => {
        assetsById.set(asset.id, asset)
      })

      const basket: BasketItem[] = []
      const modelCounts = new Map<string, { count: number; asset: Asset }>()

      counts.forEach((count, assetId) => {
        basket.push({
          assetId,
          quantity: count,
          isFirstPurchase: true,
          firstQty: Math.min(1, count),
          repeatQty: Math.max(0, count - 1)
        })

        const asset = assetsById.get(assetId)
        if (asset?.sourceModelId) {
          const existing = modelCounts.get(asset.sourceModelId)
          if (existing) {
            existing.count += count
          } else {
            modelCounts.set(asset.sourceModelId, { count, asset })
          }
        }
      })

      set({ basket })
      syncCartWithModelCounts(modelCounts)
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
      get().actions.syncBasketWithTable()
    },

    removeFromBasket: (assetId) => {
      set(s => ({
        instances: s.instances.filter(inst => inst.assetId !== assetId),
        basket: s.basket.filter(item => item.assetId !== assetId)
      }))
      get().actions.syncBasketWithTable()
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
        return
      }
      get().actions.syncBasketWithTable()
    },

    clearBasket: () => {
      set({ basket: [], instances: [] })
      get().actions.syncBasketWithTable()
    },

    markAsPurchased: (assetIds) => {
      set(s => ({
        purchasedAssetIds: new Set([...s.purchasedAssetIds, ...assetIds])
      }))
    },

    addLayoutToBasket: () => {
      // Already synced automatically
    },

    upsertLibraryAsset: (asset) => {
      const converted = convertLibraryAssetToSceneAsset(asset)
      if (!converted) return
      set((state) => {
        const existingIndex = state.assets.findIndex((item) => item.id === converted.id)
        if (existingIndex >= 0) {
          const next = [...state.assets]
          next[existingIndex] = { ...next[existingIndex], ...converted }
          return { assets: next }
        }
        return { assets: [...state.assets, converted] }
      })
      // Sync basket after adding asset to ensure pricing calculations work
      get().actions.syncBasketWithTable()
    },

    removeLibraryAsset: (assetId) => {
      set((state) => ({
        assets: state.assets.filter((asset) => asset.id !== assetId),
        instances: state.instances.filter((instance) => instance.assetId !== assetId),
      }))
      get().actions.syncBasketWithTable()
    }
  }
}))
