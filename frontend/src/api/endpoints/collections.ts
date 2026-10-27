// src/api/endpoints/collections.ts
// Collections: named, browse-only groups of listings inside an artist's store.
import apiClient from '../client'
import { TerrainModel } from '../types'
import { assetUrl, mapModelRecord } from '../transformers'

// The artist's own view (dashboard): every collection with its ordered listings.
export interface MyCollection {
  id: string
  name: string
  slug: string
  description?: string
  modelIds: string[]
}

// Public card on the artist's profile.
export interface CollectionSummary {
  id: string
  name: string
  slug: string
  description?: string
  modelCount: number
  thumbnails: string[]
}

export interface CollectionPage {
  collection: {
    id: string
    name: string
    slug: string
    description?: string
    artistId: string
    /** Part of the artist's page link: their slug, or id if they have none. */
    artistPath: string
    artistName: string
  }
  models: TerrainModel[]
  total: number
  page: number
  totalPages: number
}

const mapMine = (c: any): MyCollection => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  description: c.description ?? undefined,
  modelIds: Array.isArray(c.model_ids) ? c.model_ids : [],
})

export const collectionsApi = {
  // ---- Artist (owner) ----
  getMine: async (): Promise<MyCollection[]> => {
    const response = await apiClient.get('/api/collections/mine')
    return (response.data?.collections ?? []).map(mapMine)
  },

  create: async (data: { name: string; description?: string }): Promise<MyCollection> => {
    const response = await apiClient.post('/api/collections', data)
    return mapMine(response.data?.collection)
  },

  update: async (id: string, data: { name?: string; description?: string }): Promise<MyCollection> => {
    const response = await apiClient.patch(`/api/collections/${id}`, data)
    return mapMine(response.data?.collection)
  },

  setModels: async (id: string, modelIds: string[]): Promise<string[]> => {
    const response = await apiClient.put(`/api/collections/${id}/models`, { modelIds })
    return response.data?.modelIds ?? []
  },

  reorder: async (collectionIds: string[]): Promise<void> => {
    await apiClient.put('/api/collections/order', { collectionIds })
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/collections/${id}`)
  },

  // ---- Public ----
  getForArtist: async (artistId: string): Promise<CollectionSummary[]> => {
    const response = await apiClient.get(`/api/collections/artist/${artistId}`)
    return (response.data?.collections ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description ?? undefined,
      modelCount: Number(c.model_count ?? 0),
      thumbnails: (Array.isArray(c.thumbnails) ? c.thumbnails : [])
        .map((t: string) => assetUrl(t))
        .filter(Boolean) as string[],
    }))
  },

  getCollection: async (
    artistId: string,
    slug: string,
    params: { page?: number; limit?: number } = {}
  ): Promise<CollectionPage> => {
    const response = await apiClient.get(`/api/collections/artist/${artistId}/${encodeURIComponent(slug)}`, { params })
    const payload = response.data ?? {}
    const c = payload.collection ?? {}
    return {
      collection: {
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description ?? undefined,
        artistId: c.artist_id,
        artistPath: c.artist_slug || c.artist_id,
        artistName: c.artist_name ?? '',
      },
      models: (payload.models ?? []).map((m: any) => mapModelRecord(m)),
      total: Number(payload.total ?? 0),
      page: Number(payload.page ?? params.page ?? 1),
      totalPages: Number(payload.total_pages ?? 1),
    }
  },
}
