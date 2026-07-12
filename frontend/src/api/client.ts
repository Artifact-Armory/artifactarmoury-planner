import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
  isAxiosError,
} from 'axios'
import { useAuthStore } from '../store/authStore'
import { mapApiUserToUser } from './transformers'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

// Stable anonymous visitor id, so view analytics can count unique visitors
// (incl. logged-out) and peak times. Not PII — a random id in localStorage.
const SESSION_KEY = 'aa_session_id'
function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    localStorage.setItem(SESSION_KEY, id)
  }
  return id
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // 15s was too aggressive: a cold Railway backend or a slow presign/from-upload
  // round-trip (esp. during large model uploads) tripped "timeout of 15000ms
  // exceeded". Individual long calls (file download, presign, from-upload) still
  // override this with their own longer timeout.
  timeout: 60_000,
})

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    const token = localStorage.getItem('terrain_builder_token')

    config.headers = config.headers ?? {}
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    config.headers['X-Session-Id'] = getSessionId()

    return config
  },
  (error: AxiosError) => Promise.reject(error),
)

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined

    if (!originalRequest) {
      return Promise.reject(error)
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        const refreshToken = localStorage.getItem('terrain_builder_refresh_token')
        if (!refreshToken) {
          throw new Error('Missing refresh token')
        }

        const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, { refreshToken })
        const payload = (response.data?.data ?? response.data) as {
          token?: string
          refreshToken?: string
          user?: unknown
        }

        const nextToken = payload?.token
        const nextRefreshToken = payload?.refreshToken ?? refreshToken

        if (!nextToken) {
          throw new Error('Failed to refresh token')
        }

        localStorage.setItem('terrain_builder_token', nextToken)
        localStorage.setItem('terrain_builder_refresh_token', nextRefreshToken)

        const { setTokens, setUser } = useAuthStore.getState()
        setTokens(nextToken, nextRefreshToken)
        if (payload?.user) {
          setUser(mapApiUserToUser(payload.user as any))
        }

        originalRequest.headers = originalRequest.headers ?? {}
        originalRequest.headers.Authorization = `Bearer ${nextToken}`

        return apiClient(originalRequest)
      } catch (refreshError) {
        localStorage.removeItem('terrain_builder_token')
        localStorage.removeItem('terrain_builder_refresh_token')

        const { clearAuth } = useAuthStore.getState()
        clearAuth()

        window.dispatchEvent(new Event('terrain_builder_logout'))

        if (isAxiosError(refreshError)) {
          return Promise.reject(refreshError)
        }
      }
    }

    return Promise.reject(error)
  },
)

export default apiClient
