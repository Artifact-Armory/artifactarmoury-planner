import apiClient from '../client'

const BASE_URL = '/api/payouts'

export interface EarningsSummary {
  pending: number
  cleared: number
  paid: number
  reversed: number
  currency: string
}

export interface EarningRow {
  id: string
  gross_amount: number
  artist_amount: number
  platform_amount: number
  currency: string
  status: 'pending' | 'cleared' | 'paid' | 'reversed'
  available_at: string
  created_at: string
  model_id?: string | null
  model_name?: string | null
  thumbnail_path?: string | null
  order_number?: string
}

export interface PayoutRow {
  id: string
  amount: number
  currency: string
  status: 'pending' | 'paid' | 'failed'
  stripe_transfer_id?: string | null
  created_at: string
  paid_at?: string | null
}

export interface PayoutsMe {
  summary: EarningsSummary
  earnings: EarningRow[]
  payouts: PayoutRow[]
  connect: { accountId: string | null; onboardingComplete: boolean }
  config: { holdDays: number; minPayout: number }
}

export const payoutsApi = {
  async getMine(): Promise<PayoutsMe> {
    const res = await apiClient.get(`${BASE_URL}/me`)
    return res.data
  },

  /** Begin/resume Stripe Connect onboarding; returns a hosted URL to redirect to. */
  async startOnboarding(): Promise<{ onboardingUrl: string; accountId: string }> {
    const res = await apiClient.post(`${BASE_URL}/connect/onboard`)
    return res.data
  },

  async checkStatus(): Promise<{ onboardingComplete: boolean; accountId: string | null }> {
    const res = await apiClient.get(`${BASE_URL}/connect/status`)
    return res.data
  },
}
