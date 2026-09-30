// src/store/cartStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import apiClient from '../api/client'

// Digital STL sales: you buy each model (or bundle) once, so there are no
// quantities — an item is either in the cart or it isn't.
export type CartItemKind = 'model' | 'bundle'

export interface CartItem {
  kind: CartItemKind
  id: string
  name: string
  artistName: string
  price: number
  /** Pre-sale price, when the item is discounted — shown struck-through in the cart. */
  originalPrice?: number
  imageUrl?: string
}

/** Stable dedupe/removal key for a cart line. */
export const cartKey = (kind: CartItemKind, id: string) => `${kind}:${id}`

interface CartState {
  items: CartItem[]
  subtotal: number
  totalItems: number
  isOpen: boolean

  addItem: (item: CartItem, openDrawer?: boolean) => void
  removeItem: (key: string) => void
  hasItem: (kind: CartItemKind, id: string) => boolean
  clearCart: () => void
  toggleCart: () => void
  openCart: () => void
  closeCart: () => void
  getTotal: () => number
  getItemCount: () => number
  /** Re-price every line against the server (sales start/end after add-to-cart). */
  syncPrices: () => Promise<void>
}

const calculateTotals = (items: CartItem[]) => ({
  subtotal: items.reduce((total, item) => total + item.price, 0),
  totalItems: items.length,
})

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      subtotal: 0,
      totalItems: 0,
      isOpen: false,

      addItem: (item, openDrawer = true) => {
        set((state) => {
          const idx = state.items.findIndex((i) => i.kind === item.kind && i.id === item.id)
          let items: CartItem[]
          if (idx >= 0) {
            // Own-once: don't duplicate, but refresh the line's price/details so a
            // sale that started (or ended) since it was added is reflected.
            items = state.items.slice()
            items[idx] = { ...items[idx], ...item }
          } else {
            items = [...state.items, item]
          }
          return { items, ...calculateTotals(items), isOpen: openDrawer ? true : state.isOpen }
        })
      },

      removeItem: (key) => {
        set((state) => {
          const items = state.items.filter((item) => cartKey(item.kind, item.id) !== key)
          return { items, ...calculateTotals(items) }
        })
      },

      hasItem: (kind, id) => get().items.some((i) => i.kind === kind && i.id === id),

      clearCart: () => set({ items: [], subtotal: 0, totalItems: 0, isOpen: false }),

      toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),
      openCart: () => set({ isOpen: true }),
      closeCart: () => set({ isOpen: false }),

      getTotal: () => get().items.reduce((total, item) => total + item.price, 0),
      getItemCount: () => get().items.length,

      // Lines snapshot their price when added, so a Sale that started afterwards
      // never reached the cart while the backend charged the sale price. Best-effort:
      // on failure the cart keeps what it had.
      syncPrices: async () => {
        const current = get().items
        if (!current.length) return
        try {
          const res = await apiClient.post('/api/cart/prices', {
            items: current.map((i) => ({ kind: i.kind, id: i.id })),
          })
          const fresh = new Map<string, { price: number; originalPrice?: number }>(
            (res.data?.prices ?? []).map((p: any) => [cartKey(p.kind, p.id), p]),
          )
          set((state) => {
            let changed = false
            const items = state.items.map((i) => {
              const p = fresh.get(cartKey(i.kind, i.id))
              if (!p || (p.price === i.price && p.originalPrice === i.originalPrice)) return i
              changed = true
              return { ...i, price: Number(p.price), originalPrice: p.originalPrice ?? undefined }
            })
            return changed ? { items, ...calculateTotals(items) } : state
          })
        } catch {
          /* keep the stored prices */
        }
      },
    }),
    {
      name: 'cart-storage',
      partialize: (state) => ({
        items: state.items,
        subtotal: state.subtotal,
        totalItems: state.totalItems,
      }),
      version: 3,
      migrate: (persisted, version) => {
        const empty = { items: [] as CartItem[], subtotal: 0, totalItems: 0, isOpen: false }
        if (!persisted) return empty

        // v1/v2 stored { modelId, quantity } lines — map them to model items.
        if (version < 3) {
          const oldItems = (persisted as any).items ?? []
          const items: CartItem[] = oldItems.map((i: any) => ({
            kind: 'model' as const,
            id: i.id ?? i.modelId,
            name: i.name ?? 'Model',
            artistName: i.artistName ?? '',
            price: Number(i.price ?? 0),
            imageUrl: i.imageUrl,
          }))
          return { ...empty, items, ...calculateTotals(items) }
        }

        return { ...(persisted as any), isOpen: false }
      },
    }
  )
)
