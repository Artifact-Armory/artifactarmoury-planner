import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
  isAxiosError,
} from 'axios';
import { useAuthStore } from '../store/authStore';
import { mapApiUserToUser } from './transformers';
import {
  applySessionHeader,
  ensureSessionId,
  syncSessionFromResponse,
  SESSION_HEADER,
} from '../utils/session';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15_000,
});

const initialSessionId = ensureSessionId();
if (initialSessionId) {
  apiClient.defaults.headers.common[SESSION_HEADER] = initialSessionId;
}

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    config.headers = config.headers ?? {};

    applySessionHeader(config.headers as Record<string, unknown>);

    const token = typeof window !== 'undefined' ? localStorage.getItem('terrain_builder_token') : null;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    const sessionHeader =
      response.headers?.[SESSION_HEADER] ?? response.headers?.[SESSION_HEADER.toLowerCase()];
    syncSessionFromResponse(
      Array.isArray(sessionHeader) ? sessionHeader[0] : (sessionHeader as string | undefined),
    );
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken =
          typeof window !== 'undefined' ? localStorage.getItem('terrain_builder_refresh_token') : null;
        if (!refreshToken) {
          throw new Error('Missing refresh token');
        }

        const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, { refreshToken });
        const refreshSessionHeader =
          response.headers?.[SESSION_HEADER] ?? response.headers?.[SESSION_HEADER.toLowerCase()];
        syncSessionFromResponse(
          Array.isArray(refreshSessionHeader)
            ? refreshSessionHeader[0]
            : (refreshSessionHeader as string | undefined),
        );
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

        if (typeof window !== 'undefined') {
          localStorage.setItem('terrain_builder_token', nextToken)
          localStorage.setItem('terrain_builder_refresh_token', nextRefreshToken)
        }

        const { setTokens, setUser } = useAuthStore.getState()
        setTokens(nextToken, nextRefreshToken)
        if (payload?.user) {
          setUser(mapApiUserToUser(payload.user as any))
        }

        originalRequest.headers = originalRequest.headers ?? {}
        applySessionHeader(originalRequest.headers as Record<string, unknown>)
        originalRequest.headers.Authorization = `Bearer ${nextToken}`

        return apiClient(originalRequest)
      } catch (refreshError) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('terrain_builder_token')
          localStorage.removeItem('terrain_builder_refresh_token')
        }

        const { clearAuth } = useAuthStore.getState()
        clearAuth()

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('terrain_builder_logout'))
        }

        if (isAxiosError(refreshError)) {
          return Promise.reject(refreshError)
        }
      }
    }

    return Promise.reject(error)
  },
)

export default apiClient
