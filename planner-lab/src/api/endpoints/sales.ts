import apiClient from '../client'
import { assetUrl } from '../transformers'

export type SaleScope = 'model' | 'bundle' | 'portfolio'
export type SaleState = 'active' | 'scheduled' | 'ended' | 'canceled'

export interface SaleRecord {
  id: string
  scope: SaleScope
  target_id: string | null
  discount_percent: number
  starts_at: string
  ends_at: string
  canceled_at: string | null
  state: SaleState
  target_name: string | null
}

export interface FeaturedSaleItem {
  id: string
  name: string
  artistId: string
  artistName: string
  thumbnailUrl?: string
  originalPrice: number
  salePrice: number
  salePercent: number
  saleEndsAt: string
}

export const SALE_MAX_DAYS = 14

export const salesApi = {
  /** Public front-page carousel of on-sale items. */
  featured: async (): Promise<FeaturedSaleItem[]> => {
    const res = await apiClient.get('/api/sales/featured')
    return (res.data?.items ?? []).map((i: any) => ({
      ...i,
      thumbnailUrl: assetUrl(i.thumbnailPath),
    }))
  },

  /** The signed-in artist's sales (active, scheduled, ended, canceled). */
  mine: async (): Promise<SaleRecord[]> => {
    const res = await apiClient.get('/api/sales/mine')
    return res.data?.sales ?? []
  },

  create: async (data: {
    scope: SaleScope
    targetId?: string
    discountPercent: number
    durationDays: number
  }): Promise<SaleRecord> => {
    const res = await apiClient.post('/api/sales', data)
    return res.data?.sale
  },

  cancel: async (id: string): Promise<void> => {
    await apiClient.post(`/api/sales/${id}/cancel`)
  },
}
