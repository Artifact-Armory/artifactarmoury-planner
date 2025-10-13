// src/api/endpoints/artists.ts
import apiClient from '../client'
import { Artist, ArtistStats } from '../types'

export const artistsApi = {
  // Get public artist profile
  getArtistProfile: async (id: string): Promise<Artist> => {
    const response = await apiClient.get<{ artist: Artist }>(`/api/artists/${id}`)
    return response.data.artist
  },

  // Get artist's public models
  getArtistModels: async (
    id: string,
    params?: { limit?: number; offset?: number }
  ): Promise<{ models: any[]; total: number }> => {
    const response = await apiClient.get(`/api/artists/${id}/models`, { params })
    return response.data
  },

  // Get artist dashboard stats (requires auth)
  getDashboardStats: async (): Promise<ArtistStats> => {
    const response = await apiClient.get<{ stats: ArtistStats }>('/api/artists/dashboard/stats')
    return response.data.stats
  },

  // Get artist's sales (requires auth)
  getSales: async (params?: {
    limit?: number
    offset?: number
  }): Promise<{ sales: any[]; total: number }> => {
    const response = await apiClient.get('/api/artists/sales', { params })
    return response.data
  },

  // Update artist profile (requires auth)
  updateProfile: async (data: {
    name?: string
    bio?: string
    profileImage?: string
    bannerImage?: string
  }): Promise<Artist> => {
    const response = await apiClient.put<{ artist: Artist }>('/api/artists/profile', data)
    return response.data.artist
  },

  // Upload profile image
  uploadProfileImage: async (file: File): Promise<{ imageUrl: string }> => {
    const formData = new FormData()
    formData.append('image', file)

    const response = await apiClient.post('/api/artists/profile/image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    
    return response.data
  },

  // Upload banner image
  uploadBannerImage: async (file: File): Promise<{ imageUrl: string }> => {
    const formData = new FormData()
    formData.append('banner', file)

    const response = await apiClient.post('/api/artists/profile/banner', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    
    return response.data
  },
}
