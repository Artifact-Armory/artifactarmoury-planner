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
  connect: ConnectStatus
  config: {
    holdDays: number
    minPayout: number
    /** The artist's OWN share percent (users.commission_rate), not a global constant. */
    artistSharePercent: number
    /** True when the backend is on STRIPE_MOCK, so the dev-only shortcut exists. */
    mockMode: boolean
  }
}

export interface ConnectStatus {
  accountId: string | null
  /** Money can actually reach this account (charges + payouts both enabled). */
  onboardingComplete: boolean
  /** False means the artist never finished Stripe's form, as opposed to Stripe
   *  still reviewing them — which is what the banner wording turns on. */
  detailsSubmitted: boolean
  payoutsEnabled: boolean
  chargesEnabled: boolean
  requirementsDue: string[]
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

  async checkStatus(): Promise<ConnectStatus> {
    const res = await apiClient.get(`${BASE_URL}/connect/status`)
    return res.data
  },

  /** One-time link into the artist's own Stripe Express dashboard. */
  async dashboardLink(): Promise<{ url: string }> {
    const res = await apiClient.post(`${BASE_URL}/connect/dashboard-link`)
    return res.data
  },

  /**
   * DEV/MOCK ONLY — stands in for completing Stripe's hosted onboarding form, which
   * cannot be reached under STRIPE_MOCK. 404s on any live backend.
   */
  async mockCompleteOnboarding(complete = true): Promise<ConnectStatus> {
    const res = await apiClient.post(`${BASE_URL}/connect/mock-complete`, { complete })
    return res.data
  },
}
