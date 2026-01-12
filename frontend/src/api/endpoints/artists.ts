// src/api/endpoints/artists.ts
import apiClient from '../client'
import { ArtistDetail, ArtistStats, ArtistSummary, TerrainModel } from '../types'
import { mapArtistDetail, mapArtistSummary, mapModelRecord } from '../transformers'

interface ArtistListParams {
  page?: number
  limit?: number
  sort?: 'popular' | 'recent' | 'name'
}

interface ArtistListResponse {
  artists: ArtistSummary[]
  total: number
  page: number
  limit: number
  totalPages: number
}

interface ArtistModelsResponse {
  models: TerrainModel[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export const artistsApi = {
  listArtists: async (params: ArtistListParams = {}): Promise<ArtistListResponse> => {
    const response = await apiClient.get('/api/artists', { params })
    const payload = response.data ?? {}
    const artists = (payload.artists ?? []).map((artist: any) => mapArtistSummary(artist))
    return {
      artists,
      total: Number(payload.total ?? artists.length),
      page: Number(payload.page ?? params.page ?? 1),
      limit: Number(payload.limit ?? params.limit ?? artists.length || 0),
      totalPages: Number(payload.total_pages ?? payload.totalPages ?? 1),
    }
  },

  searchArtists: async (query: string, limit = 12): Promise<ArtistSummary[]> => {
    if (!query) return []
    const response = await apiClient.get('/api/artists/search/query', {
      params: { q: query, limit },
    })
    return (response.data?.artists ?? []).map((artist: any) => mapArtistSummary(artist))
  },

  getFeaturedArtists: async (limit = 8): Promise<ArtistSummary[]> => {
    const response = await apiClient.get('/api/artists/featured/list', { params: { limit } })
    return (response.data?.artists ?? []).map((artist: any) => mapArtistSummary(artist))
  },

  getArtistProfile: async (id: string): Promise<ArtistDetail> => {
    const response = await apiClient.get(`/api/artists/${id}`)
    return mapArtistDetail(response.data?.artist ?? response.data)
  },

  getArtistModels: async (
    id: string,
    params: { page?: number; limit?: number; sort?: string } = {}
  ): Promise<ArtistModelsResponse> => {
    const response = await apiClient.get(`/api/artists/${id}/models`, { params })
    const payload = response.data ?? {}
    const models = (payload.assets ?? payload.models ?? []).map((model: any) => mapModelRecord(model))
    return {
      models,
      total: Number(payload.total ?? models.length),
      page: Number(payload.page ?? params.page ?? 1),
      limit: Number(payload.limit ?? params.limit ?? models.length || 0),
      totalPages: Number(payload.total_pages ?? payload.totalPages ?? 1),
    }
  },

  getDashboardStats: async (): Promise<ArtistStats> => {
    const response = await apiClient.get<{ stats: ArtistStats }>('/api/artists/dashboard/stats')
    return response.data.stats
  },

  getSales: async (params?: { limit?: number; offset?: number }): Promise<{ sales: any[]; total: number }> => {
    const response = await apiClient.get('/api/artists/sales', { params })
    return response.data
  },

  updateProfile: async (data: {
    name?: string
    bio?: string
    profileImage?: string
    bannerImage?: string
  }): Promise<ArtistDetail> => {
    const response = await apiClient.put('/api/artists/profile', data)
    return mapArtistDetail(response.data?.artist ?? response.data)
  },

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
