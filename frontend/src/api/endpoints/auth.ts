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

/**
 * Result of the password step. When the account has 2FA enabled the server
 * withholds the session and returns a short-lived `challengeToken` to complete
 * via `loginTwoFactor`.
 */
export type LoginResult =
  | { twoFactorRequired: true; challengeToken: string }
  | ({ twoFactorRequired: false } & AuthResponse)

export interface TwoFactorStatus {
  enabled: boolean
  pending: boolean
  enrolledAt: string | null
  backupCodesRemaining: number
}

export interface TwoFactorSetup {
  secret: string
  otpauthUrl: string
  qrDataUrl: string
}

export const authApi = {
  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<RawAuthResponse>(`${AUTH_BASE}/register`, data)
    return parseAuthResponse(response.data)
  },

  login: async (data: LoginRequest): Promise<LoginResult> => {
    const response = await apiClient.post<any>(`${AUTH_BASE}/login`, data)
    if (response.data?.twoFactorRequired) {
      return { twoFactorRequired: true, challengeToken: response.data.challengeToken }
    }
    return { twoFactorRequired: false, ...parseAuthResponse(response.data) }
  },

  /** Complete a sign-in that requires a one-time code (or a backup code). */
  loginTwoFactor: async (challengeToken: string, code: string): Promise<AuthResponse> => {
    const response = await apiClient.post<RawAuthResponse>(`${AUTH_BASE}/login/2fa`, {
      challengeToken,
      code,
    })
    return parseAuthResponse(response.data)
  },

  /** Two-factor enrolment & management (Account security settings). */
  twoFactor: {
    status: async (): Promise<TwoFactorStatus> => {
      const response = await apiClient.get<TwoFactorStatus>(`${AUTH_BASE}/2fa/status`)
      return response.data
    },
    setup: async (): Promise<TwoFactorSetup> => {
      const response = await apiClient.post<TwoFactorSetup>(`${AUTH_BASE}/2fa/setup`)
      return response.data
    },
    enable: async (code: string): Promise<{ message: string; backupCodes: string[] }> => {
      const response = await apiClient.post<{ message: string; backupCodes: string[] }>(
        `${AUTH_BASE}/2fa/enable`,
        { code },
      )
      return response.data
    },
    disable: async (password: string): Promise<{ message: string }> => {
      const response = await apiClient.post<{ message: string }>(`${AUTH_BASE}/2fa/disable`, {
        password,
      })
      return response.data
    },
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
