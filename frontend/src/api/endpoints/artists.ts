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
      limit: Number(payload.limit ?? params.limit ?? (artists.length || 0)),
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

  follow: async (id: string): Promise<{ following: boolean; followerCount: number }> => {
    const response = await apiClient.post(`/api/artists/${id}/follow`)
    return response.data
  },

  unfollow: async (id: string): Promise<{ following: boolean; followerCount: number }> => {
    const response = await apiClient.delete(`/api/artists/${id}/follow`)
    return response.data
  },

  getFollowing: async (): Promise<ArtistSummary[]> => {
    const response = await apiClient.get('/api/artists/me/following')
    return (response.data?.artists ?? []).map((a: any) => mapArtistSummary(a))
  },

  getFeed: async (params: { limit?: number; offset?: number } = {}): Promise<TerrainModel[]> => {
    const response = await apiClient.get('/api/artists/me/feed', { params })
    return (response.data?.models ?? []).map((m: any) => mapModelRecord(m))
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
      limit: Number(payload.limit ?? params.limit ?? (models.length || 0)),
      totalPages: Number(payload.total_pages ?? payload.totalPages ?? 1),
    }
  },

  getDashboardStats: async (): Promise<ArtistStats> => {
    const response = await apiClient.get<{ stats: ArtistStats }>('/api/artists/me/stats')
    return response.data.stats
  },

  getSales: async (params?: { limit?: number; offset?: number }): Promise<{ sales: ArtistSale[]; total: number }> => {
    const response = await apiClient.get('/api/artists/me/sales', { params })
    return { sales: response.data?.sales ?? [], total: Number(response.data?.total ?? 0) }
  },

  // Update the artist's own brand. `avatar`/`banner` are R2 object keys from the
  // presign upload flow (uploadsApi.uploadDirect).
  updateProfile: async (data: {
    name?: string
    bio?: string
    url?: string
    avatar?: string
    banner?: string
  }): Promise<ArtistDetail> => {
    const response = await apiClient.put('/api/artists/me', data)
    return mapArtistDetail(response.data?.artist ?? response.data)
  },
}

export interface ArtistSale {
  id: string
  model_id: string | null
  model_name: string
  bundle_name: string | null
  total_price: string | number
  earnings: string | number
  order_number: string
  customer_email: string
  created_at: string
}
