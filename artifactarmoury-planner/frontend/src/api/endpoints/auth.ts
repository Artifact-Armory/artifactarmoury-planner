// src/api/endpoints/auth.ts
import apiClient from '../client'
import {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  User,
  ApiUser,
} from '../types'
import { mapApiUserToUser } from '../transformers'

const AUTH_BASE = '/api/auth'

interface RawAuthResponse {
  message?: string
  user: ApiUser
  accessToken: string
  refreshToken: string
}

const parseAuthResponse = (payload: RawAuthResponse): AuthResponse => ({
  message: payload.message,
  user: mapApiUserToUser(payload.user),
  accessToken: payload.accessToken,
  refreshToken: payload.refreshToken,
})

export const authApi = {
  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<RawAuthResponse>(`${AUTH_BASE}/register`, data)
    return parseAuthResponse(response.data)
  },

  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<RawAuthResponse>(`${AUTH_BASE}/login`, data)
    return parseAuthResponse(response.data)
  },

  logout: async (): Promise<void> => {
    await apiClient.post(`${AUTH_BASE}/logout`)
  },

  getProfile: async (): Promise<User> => {
    const response = await apiClient.get<{ user: ApiUser }>(`${AUTH_BASE}/me`)
    return mapApiUserToUser(response.data.user)
  },

  updateProfile: async (data: Partial<ApiUser>): Promise<User> => {
    const response = await apiClient.put<{ user: ApiUser }>(`/api/users/me`, data)
    return mapApiUserToUser(response.data.user)
  },

  requestPasswordReset: async (email: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      `${AUTH_BASE}/password-reset/request`,
      { email },
    )
    return response.data
  },

  resetPassword: async (token: string, newPassword: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      `${AUTH_BASE}/password-reset/confirm`,
      { token, newPassword },
    )
    return response.data
  },

  verifyEmail: async (token: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(`${AUTH_BASE}/verify-email`, { token })
    return response.data
  },

  resendVerification: async (): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(`${AUTH_BASE}/resend-verification`)
    return response.data
  },
}
