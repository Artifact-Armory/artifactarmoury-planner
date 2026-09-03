import apiClient from '../client'

const BASE_URL = '/api/promo-codes'

export type PromoScope = 'model' | 'portfolio'
export type PromoDiscountType = 'percent' | 'fixed'

export interface PromoCodeRecord {
  id: string
  code: string
  discount_type: PromoDiscountType
  discount_value: string | number
  scope: PromoScope
  target_id: string | null
  target_name: string | null
  active: boolean
  starts_at: string
  ends_at: string | null
  max_redemptions: number | null
  redemption_count: number
  max_redemptions_per_customer: number | null
  created_at: string
}

export interface PromoValidationLine {
  modelId: string
  name: string
  originalPrice: number
  discountAmount: number
}

export interface PromoValidationResult {
  code: { id: string; code: string; discountType: PromoDiscountType; discountValue: number }
  lines: PromoValidationLine[]
  totalDiscount: number
  limitReached: boolean
}

export const PROMO_MIN_PERCENT = 1
export const PROMO_MAX_PERCENT = 95

export const promoCodesApi = {
  /** The signed-in artist's own codes. */
  async mine(): Promise<PromoCodeRecord[]> {
    const res = await apiClient.get(`${BASE_URL}/mine`)
    return res.data?.codes ?? []
  },

  async create(data: {
    code: string
    scope: PromoScope
    targetId?: string
    discountType: PromoDiscountType
    discountValue: number
    maxRedemptions?: number
    maxRedemptionsPerCustomer?: number
    endsAt?: string
  }): Promise<PromoCodeRecord> {
    const res = await apiClient.post(BASE_URL, data)
    return res.data?.code
  },

  async toggle(id: string): Promise<PromoCodeRecord> {
    const res = await apiClient.patch(`${BASE_URL}/${id}/toggle`)
    return res.data?.code
  },

  /** Preview a code against the buyer's cart (model lines only — bundles aren't discountable). */
  async validate(code: string, modelIds: string[]): Promise<PromoValidationResult> {
    const res = await apiClient.post(`${BASE_URL}/validate`, {
      code,
      items: modelIds.map((modelId) => ({ modelId })),
    })
    return res.data
  },
}
