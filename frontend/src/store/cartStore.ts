// src/store/cartStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CartItem {
  modelId: string
  name: string
  artistName: string
  price: number
  imageUrl?: string
  quantity: number
}

interface CartState {
  items: CartItem[]
  subtotal: number
  totalItems: number
  isOpen: boolean

  addItem: (item: Omit<CartItem, 'quantity'>) => void
  removeItem: (modelId: string) => void
  updateQuantity: (modelId: string, quantity: number) => void
  clearCart: () => void
  toggleCart: () => void
  openCart: () => void
  closeCart: () => void
  getTotal: () => number
  getItemCount: () => number
}

const calculateTotals = (items: CartItem[]) => {
  const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0)
  const totalItems = items.reduce((count, item) => count + item.quantity, 0)
  return { subtotal, totalItems }
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      subtotal: 0,
      totalItems: 0,
      isOpen: false,

      addItem: (item) => {
        set((state) => {
          const existingItem = state.items.find((i) => i.modelId === item.modelId)

          if (existingItem) {
            const updatedItems = state.items.map((i) =>
              i.modelId === item.modelId
                ? { ...i, quantity: i.quantity + 1 }
                : i
            )
            const totals = calculateTotals(updatedItems)
            return {
              items: updatedItems,
              subtotal: totals.subtotal,
              totalItems: totals.totalItems,
              isOpen: true,
            }
          }

          const newItems = [...state.items, { ...item, quantity: 1 }]
          const totals = calculateTotals(newItems)
          return {
            items: newItems,
            subtotal: totals.subtotal,
            totalItems: totals.totalItems,
            isOpen: true,
          }
        })
      },

      removeItem: (modelId) => {
        set((state) => {
          const newItems = state.items.filter((item) => item.modelId !== modelId)
          const totals = calculateTotals(newItems)

          return {
            items: newItems,
            subtotal: totals.subtotal,
            totalItems: totals.totalItems,
          }
        })
      },

      updateQuantity: (modelId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(modelId)
          return
        }

        set((state) => {
          const newItems = state.items.map((item) =>
            item.modelId === modelId ? { ...item, quantity } : item
          )
          const totals = calculateTotals(newItems)
          return {
            items: newItems,
            subtotal: totals.subtotal,
            totalItems: totals.totalItems,
          }
        })
      },

      clearCart: () => {
        set({ items: [], subtotal: 0, totalItems: 0, isOpen: false })
      },

      toggleCart: () => {
        set((state) => ({ isOpen: !state.isOpen }))
      },

      openCart: () => {
        set({ isOpen: true })
      },

      closeCart: () => {
        set({ isOpen: false })
      },

      getTotal: () => {
        return get().items.reduce(
          (total, item) => total + item.price * item.quantity,
          0
        )
      },

      getItemCount: () => {
        return get().items.reduce((count, item) => count + item.quantity, 0)
      },
    }),
    {
      name: 'cart-storage',
      partialize: (state) => ({
        items: state.items,
        subtotal: state.subtotal,
        totalItems: state.totalItems,
      }),
      version: 2,
      migrate: (persisted, version) => {
        if (!persisted) {
          return {
            items: [],
            subtotal: 0,
            totalItems: 0,
            isOpen: false,
          }
        }

        if (version < 2) {
          const items = (persisted as any).items ?? []
          const totals = calculateTotals(items)
          return {
            items,
            subtotal: totals.subtotal,
            totalItems: totals.totalItems,
            isOpen: false,
          }
        }

        return {
          ...(persisted as any),
          isOpen: (persisted as any).isOpen ?? false,
        }
      },
    }
  )
)
