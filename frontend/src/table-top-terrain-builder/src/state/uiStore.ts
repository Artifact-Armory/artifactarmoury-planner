// src/state/uiStore.ts
import { create } from 'zustand'

type SidebarTab = 'marketplace' | 'collection'

interface ContextMenuPayload {
  x: number
  y: number
  targetIds: string[]
}

interface BuilderUIState {
  activePanel: SidebarTab | null
  basketOpen: boolean
  keyboardShortcutsOpen: boolean
  modelModal: {
    open: boolean
    modelId: string | null
  }
  contextMenu: {
    open: boolean
    x: number
    y: number
    targetIds: string[]
  }
  setActivePanel: (panel: SidebarTab | null) => void
  togglePanel: (panel: SidebarTab) => void
  setBasketOpen: (open: boolean) => void
  setKeyboardShortcutsOpen: (open: boolean) => void
  openModelModal: (modelId: string) => void
  closeModelModal: () => void
  openContextMenu: (payload: ContextMenuPayload) => void
  closeContextMenu: () => void
}

export const useBuilderUIStore = create<BuilderUIState>((set) => ({
  activePanel: null,
  basketOpen: false,
  keyboardShortcutsOpen: false,
  modelModal: {
    open: false,
    modelId: null,
  },
  contextMenu: {
    open: false,
    x: 0,
    y: 0,
    targetIds: [],
  },
  setActivePanel: (panel) => set({ activePanel: panel }),
  togglePanel: (panel) =>
    set((state) => ({ activePanel: state.activePanel === panel ? null : panel })),
  setBasketOpen: (open) => set({ basketOpen: open }),
  setKeyboardShortcutsOpen: (open) => set({ keyboardShortcutsOpen: open }),
  openModelModal: (modelId) =>
    set({ modelModal: { open: true, modelId } }),
  closeModelModal: () =>
    set({ modelModal: { open: false, modelId: null } }),
  openContextMenu: ({ x, y, targetIds }) =>
    set({
      contextMenu: {
        open: true,
        x,
        y,
        targetIds,
      },
    }),
  closeContextMenu: () =>
    set({
      contextMenu: {
        open: false,
        x: 0,
        y: 0,
        targetIds: [],
      },
    }),
}))
