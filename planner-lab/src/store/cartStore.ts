// src/store/cartStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
