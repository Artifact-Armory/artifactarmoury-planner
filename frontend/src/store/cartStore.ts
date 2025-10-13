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
  
  // Actions
  addItem: (item: Omit<CartItem, 'quantity'>) => void
  removeItem: (modelId: string) => void
  updateQuantity: (modelId: string, quantity: number) => void
  clearCart: () => void
  
  // Computed
  getTotal: () => number
  getItemCount: () => number
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) => {
        set((state) => {
          const existingItem = state.items.find((i) => i.modelId === item.modelId)
          
          if (existingItem) {
            return {
              items: state.items.map((i) =>
                i.modelId === item.modelId
                  ? { ...i, quantity: i.quantity + 1 }
                  : i
              ),
            }
          }
          
          return {
            items: [...state.items, { ...item, quantity: 1 }],
          }
        })
      },

      removeItem: (modelId) => {
        set((state) => ({
          items: state.items.filter((item) => item.modelId !== modelId),
        }))
      },

      updateQuantity: (modelId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(modelId)
          return
        }
        
        set((state) => ({
          items: state.items.map((item) =>
            item.modelId === modelId ? { ...item, quantity } : item
          ),
        }))
      },

      clearCart: () => {
        set({ items: [] })
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
    }
  )
)
