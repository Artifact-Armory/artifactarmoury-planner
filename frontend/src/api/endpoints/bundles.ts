import apiClient from '../client'
import { assetUrl } from '../transformers'
import type { Bundle, BundleModelRef } from '../types'

const BASE_URL = '/api/bundles'

function mapModelRef(m: any): BundleModelRef {
  return {
    id: m.id,
    name: m.name,
    thumbnailUrl: m.thumbnail_url || assetUrl(m.thumbnail_path),
    basePrice: Number(m.base_price ?? m.basePrice ?? 0),
    status: m.status,
    processingStatus: m.processing_status ?? m.processingStatus,
  }
}

export function mapBundle(b: any): Bundle {
  return {
    id: b.id,
    artistId: b.artist_id ?? b.artistId,
    artistName: b.artist_name ?? b.artistName,
    name: b.name,
    description: b.description ?? undefined,
    price: Number(b.price ?? 0),
    thumbnailUrl: b.thumbnail_url || assetUrl(b.thumbnail_path),
    status: b.status,
    visibility: b.visibility,
    modelCount: Number(b.model_count ?? (b.models?.length ?? 0)),
    models: Array.isArray(b.models) ? b.models.map(mapModelRef) : [],
    createdAt: b.created_at ?? b.createdAt,
    publishedAt: b.published_at ?? b.publishedAt ?? undefined,
  }
}

export interface BundleInput {
  name: string
  description?: string
  price: number
  modelIds: string[]
  thumbnailKey?: string
}

export const bundlesApi = {
  /** Published bundles for the public listing. */
  list: async (): Promise<Bundle[]> => {
    const res = await apiClient.get(BASE_URL)
    return (res.data?.bundles ?? []).map(mapBundle)
  },

  /** The signed-in artist's own bundles (all statuses). */
  getMyBundles: async (): Promise<Bundle[]> => {
    const res = await apiClient.get(`${BASE_URL}/my-bundles`)
    return (res.data?.bundles ?? []).map(mapBundle)
  },

  getById: async (id: string): Promise<Bundle> => {
    const res = await apiClient.get(`${BASE_URL}/${id}`)
    return mapBundle(res.data?.bundle ?? res.data)
  },

  create: async (data: BundleInput): Promise<{ id: string }> => {
    const res = await apiClient.post(BASE_URL, data)
    return res.data?.bundle ?? res.data
  },

  update: async (id: string, data: Partial<BundleInput>): Promise<{ id: string }> => {
    const res = await apiClient.patch(`${BASE_URL}/${id}`, data)
    return res.data?.bundle ?? res.data
  },

  publish: async (id: string): Promise<void> => {
    await apiClient.post(`${BASE_URL}/${id}/publish`)
  },

  unpublish: async (id: string): Promise<void> => {
    await apiClient.post(`${BASE_URL}/${id}/unpublish`)
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`${BASE_URL}/${id}`)
  },
}
