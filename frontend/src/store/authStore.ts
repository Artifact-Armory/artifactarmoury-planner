// src/store/authStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User, AuthRole } from '../api/types'

interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isAdmin: boolean

  setAuth: (payload: { user: User; token: string; refreshToken?: string }) => void
  clearAuth: () => void
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  logout: () => void
  setTokens: (token: string, refreshToken?: string | null) => void
}

const TOKEN_KEY = 'terrain_builder_token'
const REFRESH_TOKEN_KEY = 'terrain_builder_refresh_token'

const persistPartial = (state: AuthState) => ({
  user: state.user,
  token: state.token,
  refreshToken: state.refreshToken,
  isAuthenticated: state.isAuthenticated,
  isAdmin: state.isAdmin,
})

const toBooleanRole = (role?: AuthRole | string | null): boolean => role === 'admin'

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      isAdmin: false,

      setAuth: ({ user, token, refreshToken }) => {
        localStorage.setItem(TOKEN_KEY, token)
        if (refreshToken) {
          localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
        }

        set({
          user,
          token,
          refreshToken: refreshToken ?? null,
          isAuthenticated: true,
          isAdmin: toBooleanRole(user.role),
        })
      },

      setTokens: (token, refreshToken) => {
        localStorage.setItem(TOKEN_KEY, token)
        if (refreshToken) {
          localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
        }

        set((state) => ({
          token,
          refreshToken: refreshToken ?? state.refreshToken,
          isAuthenticated: Boolean(token),
          isAdmin: toBooleanRole(state.user?.role ?? null),
        }))
      },

      clearAuth: () => {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(REFRESH_TOKEN_KEY)

        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          isAdmin: false,
        })
      },

      setUser: (user) => {
        if (!user) {
          set({ user: null, isAuthenticated: false, isAdmin: false })
          return
        }

        set((state) => ({
          user,
          isAuthenticated: true,
          isAdmin: toBooleanRole(user.role ?? state.user?.role ?? null),
        }))
      },

      setLoading: (loading) => {
        set({ isLoading: loading })
      },

      logout: () => {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(REFRESH_TOKEN_KEY)
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          isAdmin: false,
        })
        window.dispatchEvent(new Event('terrain_builder_logout'))
      },
    }),
    {
      name: 'auth-storage',
      partialize: persistPartial,
      onRehydrateStorage: () => (state) => {
        if (!state) return

        const storedToken = localStorage.getItem(TOKEN_KEY)
        const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY)

        if (storedToken && !state.token) {
          state.token = storedToken
          state.isAuthenticated = Boolean(storedToken)
        }

        if (storedRefresh && !state.refreshToken) {
          state.refreshToken = storedRefresh
        }

        state.isAdmin = toBooleanRole(state.user?.role)
      },
    }
  )
)
