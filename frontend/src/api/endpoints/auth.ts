// src/api/endpoints/auth.ts
import apiClient from '../client'
import { LoginRequest, RegisterRequest, AuthResponse, User } from '../types'

export const authApi = {
  // Register new user
  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/api/auth/register', data)
    return response.data
  },

  // Login
  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/api/auth/login', data)
    return response.data
  },

  // Logout
  logout: async (): Promise<void> => {
    await apiClient.post('/api/auth/logout')
  },

  // Get current user profile
  getProfile: async (): Promise<User> => {
    const response = await apiClient.get<{ user: User }>('/api/auth/profile')
    return response.data.user
  },

  // Update profile
  updateProfile: async (data: Partial<User>): Promise<User> => {
    const response = await apiClient.put<{ user: User }>('/api/auth/profile', data)
    return response.data.user
  },

  // Request password reset
  requestPasswordReset: async (email: string): Promise<{ message: string }> => {
    const response = await apiClient.post('/api/auth/forgot-password', { email })
    return response.data
  },

  // Reset password with token
  resetPassword: async (token: string, password: string): Promise<{ message: string }> => {
    const response = await apiClient.post('/api/auth/reset-password', {
      token,
      password,
    })
    return response.data
  },

  // Verify email with token
  verifyEmail: async (token: string): Promise<{ message: string }> => {
    const response = await apiClient.post('/api/auth/verify-email', { token })
    return response.data
  },

  // Resend verification email
  resendVerification: async (): Promise<{ message: string }> => {
    const response = await apiClient.post('/api/auth/resend-verification')
    return response.data
  },
}
