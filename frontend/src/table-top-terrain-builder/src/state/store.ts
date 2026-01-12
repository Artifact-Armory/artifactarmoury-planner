// src/state/store.ts
import { create } from 'zustand'
import * as THREE from 'three'
import type { Asset } from '../core/assets'
import type { BasketItem } from '../core/pricing'       // ← And this

export type Unit = 'm'|'cm'|'ft'|'in'
export type Table = { width: number; height: number; unitDisplay: Unit; gridSize: number }

export type Instance = {
  id: string
  assetId: string
  position: { x: number; z: number }
  rotationDeg: number  // ← Change from: 0|90|180|270
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
  selectedInstanceIds: string[]
  primaryInstanceId: string | null
}

interface AppState {
  table: Table
  scene: THREE.Scene | null
  camera: THREE.PerspectiveCamera | null
  renderer: THREE.WebGLRenderer | null

  assets: Asset[]
  selectedAssetId: string | null
  instances: Instance[]
  selectedInstanceIds: string[]
  primaryInstanceId: string | null
  showGrid: boolean
  snapToGrid: boolean
  measurement: { active: boolean; start: { x: number; z: number } | null; end: { x: number; z: number } | null }

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
  selectInstance: (id: string, mode?: 'replace' | 'append' | 'toggle') => void
  setSelectedInstances: (ids: string[]) => void
  clearSelection: () => void
  setPrimaryInstance: (id: string | null) => void
  toggleGrid: (value?: boolean) => void
  toggleSnapToGrid: (value?: boolean) => void
  setMeasurementActive: (active: boolean) => void
  setMeasurementPoint: (point: { x: number; z: number }) => void
  clearMeasurement: () => void
  setCameraMode: (mode: 'perspective' | 'top-down' | 'isometric') => void

  actions: {
    fitView: () => void
    loadAssetCatalogue: () => void
    addInstance: (i: Omit<Instance,'id'>) => string
    updateInstance: (id: string, patch: Partial<Omit<Instance,'id'|'assetId'>>) => void
    removeInstance: (id: string) => void
    removeInstances: (ids: string[]) => void
    clearInstances: () => void
    duplicateInstance: (id: string) => void
    duplicateInstances: (ids: string[]) => void
    rotateInstances: (ids: string[], degrees: number) => void
    
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
  }
}

// Helper to save history
function saveHistory(state: AppState): Partial<AppState> {
  const newHistory = state.history.slice(0, state.historyIndex + 1)
  newHistory.push({
    instances: JSON.parse(JSON.stringify(state.instances)),
    selectedInstanceIds: [...state.selectedInstanceIds],
    primaryInstanceId: state.primaryInstanceId,
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
  selectedInstanceIds: [],
  primaryInstanceId: null,
  showGrid: true,
  snapToGrid: true,
  measurement: { active: false, start: null, end: null },

  basket: [],
  purchasedAssetIds: new Set(),

  history: [],
  historyIndex: -1,
  maxHistory: 50,

  cameraMode: 'perspective',

  setTable: (t) => set(s => ({ table: { ...s.table, ...t } })),
  setRefs: (refs) => set(refs as any),
  setSelectedAsset: (id) => set({ selectedAssetId: id }),
  selectInstance: (id, mode = 'replace') =>
    set((state) => {
      const current = state.selectedInstanceIds
      let next: string[]
      if (mode === 'append') {
        next = current.includes(id) ? current : [...current, id]
      } else if (mode === 'toggle') {
        next = current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]
      } else {
        next = [id]
      }
      return {
        selectedInstanceIds: next,
        primaryInstanceId: next.length ? next[next.length - 1] : null,
      }
    }),
  setSelectedInstances: (ids) =>
    set(() => {
      const unique = Array.from(new Set(ids))
      return {
        selectedInstanceIds: unique,
        primaryInstanceId: unique.length ? unique[unique.length - 1] : null,
      }
    }),
  clearSelection: () => set({ selectedInstanceIds: [], primaryInstanceId: null }),
  setPrimaryInstance: (id) =>
    set((state) => {
      if (!id) {
        return { primaryInstanceId: null }
      }
      if (!state.selectedInstanceIds.includes(id)) {
        return {
          selectedInstanceIds: [id],
          primaryInstanceId: id,
        }
      }
      return { primaryInstanceId: id }
    }),
  toggleGrid: (value) =>
    set((state) => ({ showGrid: typeof value === 'boolean' ? value : !state.showGrid })),
  toggleSnapToGrid: (value) =>
    set((state) => ({ snapToGrid: typeof value === 'boolean' ? value : !state.snapToGrid })),
  setMeasurementActive: (active) => set({ measurement: { active, start: null, end: null } }),
  setMeasurementPoint: (point) =>
    set((state) => {
      if (!state.measurement.active) {
        return { measurement: { active: false, start: null, end: null } }
      }
      if (!state.measurement.start || state.measurement.end) {
        return { measurement: { active: true, start: point, end: null } }
      }
      return { measurement: { active: true, start: state.measurement.start, end: point } }
    }),
  clearMeasurement: () =>
    set((state) => ({ measurement: { active: state.measurement.active, start: null, end: null } })),
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
    
    loadAssetCatalogue: () => {
      // Assets are loaded via marketplace queries
    },
    
    addInstance: (i) => {
      const id = `i_${Math.random().toString(36).slice(2,10)}`
      set(s => {
        const instances = [...s.instances, { ...i, id }]
        return { instances, ...saveHistory({ ...s, instances }) }
      })
      get().actions.syncBasketWithTable()
      return id
    },
    
    updateInstance: (id, patch) => {
      set(s => {
        const instances = s.instances.map(inst => inst.id === id ? { ...inst, ...patch } : inst)
        return { instances, ...saveHistory({ ...s, instances }) }
      })
    },
    
    removeInstance: (id) => {
      if (!id) return
      get().actions.removeInstances([id])
    },

    removeInstances: (ids) => {
      const uniqueIds = Array.from(new Set(ids))
      if (uniqueIds.length === 0) return

      set((s) => {
        const idSet = new Set(uniqueIds)
        const instances = s.instances.filter((instance) => !idSet.has(instance.id))
        if (instances.length === s.instances.length) {
          return {}
        }
        const selection = s.selectedInstanceIds.filter((selectedId) => !idSet.has(selectedId))
        const primary = selection.length
          ? s.primaryInstanceId && selection.includes(s.primaryInstanceId)
            ? s.primaryInstanceId
            : selection[selection.length - 1]
          : null
        const snapshot = {
          ...s,
          instances,
          selectedInstanceIds: selection,
          primaryInstanceId: primary,
        } as AppState
        return {
          instances,
          selectedInstanceIds: selection,
          primaryInstanceId: primary,
          ...saveHistory(snapshot),
        }
      })
      get().actions.syncBasketWithTable()
    },

    clearInstances: () => {
      set((s) => ({
        instances: [],
        selectedInstanceIds: [],
        primaryInstanceId: null,
        ...saveHistory({ ...s, instances: [], selectedInstanceIds: [], primaryInstanceId: null } as AppState),
      }))
      get().actions.syncBasketWithTable()
    },

    duplicateInstance: (id) => {
      if (!id) return
      get().actions.duplicateInstances([id])
    },

    duplicateInstances: (ids) => {
      const uniqueIds = Array.from(new Set(ids))
      if (uniqueIds.length === 0) return

      set((s) => {
        const gridSize = s.table.gridSize || 0
        const instances = [...s.instances]
        const newSelection: string[] = []

        uniqueIds.forEach((instanceId, index) => {
          const original = s.instances.find((inst) => inst.id === instanceId)
          if (!original) return
          const newId = `i_${Math.random().toString(36).slice(2, 10)}`
          const offset = gridSize * (index + 1)
          instances.push({
            ...original,
            id: newId,
            position: {
              x: original.position.x + offset,
              z: original.position.z + offset,
            },
          })
          newSelection.push(newId)
        })

        if (newSelection.length === 0) {
          return {}
        }

        const snapshot = {
          ...s,
          instances,
          selectedInstanceIds: newSelection,
          primaryInstanceId: newSelection[newSelection.length - 1],
        } as AppState

        return {
          instances,
          selectedInstanceIds: newSelection,
          primaryInstanceId: newSelection[newSelection.length - 1],
          ...saveHistory(snapshot),
        }
      })
      get().actions.syncBasketWithTable()
    },

    rotateInstances: (ids, degrees) => {
      const uniqueIds = Array.from(new Set(ids))
      if (uniqueIds.length === 0 || degrees === 0) return

      set((s) => {
        let changed = false
        const instances = s.instances.map((inst) => {
          if (!uniqueIds.includes(inst.id)) {
            return inst
          }
          changed = true
          const next = (inst.rotationDeg + degrees) % 360
          const normalized = next < 0 ? next + 360 : next
          return { ...inst, rotationDeg: normalized }
        })

        if (!changed) {
          return {}
        }

        const snapshot = {
          ...s,
          instances,
        } as AppState

        return {
          instances,
          ...saveHistory(snapshot),
        }
      })
    },

    undo: () => {
      const s = get()
      if (s.historyIndex <= 0) return
      
      const newIndex = s.historyIndex - 1
      const state = s.history[newIndex]
      
      set({
        instances: JSON.parse(JSON.stringify(state.instances)),
        selectedInstanceIds: [...state.selectedInstanceIds],
        primaryInstanceId: state.primaryInstanceId,
        historyIndex: newIndex,
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
        selectedInstanceIds: [...state.selectedInstanceIds],
        primaryInstanceId: state.primaryInstanceId,
        historyIndex: newIndex,
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
      const layout = layouts.find((l) => l.id === id)
      if (!layout) return

      set((s) => {
        const nextInstances = JSON.parse(JSON.stringify(layout.instances))
        const nextTable = { ...layout.table }
        const snapshot = {
          ...s,
          table: nextTable,
          instances: nextInstances,
          selectedInstanceIds: [],
          primaryInstanceId: null,
        } as AppState
        return {
          table: nextTable,
          instances: nextInstances,
          selectedInstanceIds: [],
          primaryInstanceId: null,
          ...saveHistory(snapshot),
        }
      })
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
        set((s) => {
          const snapshot = {
            ...s,
            table,
            instances,
            selectedInstanceIds: [],
            primaryInstanceId: null,
          } as AppState
          return {
            table,
            instances,
            selectedInstanceIds: [],
            primaryInstanceId: null,
            ...saveHistory(snapshot),
          }
        })
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
      
      const basket: BasketItem[] = []
      counts.forEach((count, assetId) => {
        basket.push({
          assetId,
          quantity: count,
          isFirstPurchase: true,
          firstQty: 1,
          repeatQty: Math.max(0, count - 1)
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
