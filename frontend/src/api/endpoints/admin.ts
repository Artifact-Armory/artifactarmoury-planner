// src/api/endpoints/admin.ts
// Thin wrappers over the REAL backend admin routes (backend/src/routes/admin.ts).
// The backend returns bare objects (e.g. { users, pagination }), not an
// ApiResponse envelope, so these types mirror the actual payloads.
import apiClient from '../client'

const BASE = '/api/admin'

// ---- Shared shapes --------------------------------------------------------

export interface AdminPagination {
  page: number
  limit: number
  total: number
  pages: number
}

export interface AdminDashboard {
  stats: {
    customer_count: string
    artist_count: string
    published_models: string
    total_orders: string
    total_revenue?: string | null
    orders_last_7_days: string
    models_last_7_days: string
  }
  previewQueue?: {
    queued: number
    running: number
    failed: number
  }
  recentActivity: Array<{
    action: string
    resource_type: string | null
    resource_id: string | null
    metadata: any
    created_at: string
    user_id: string | null
    display_name: string | null
  }>
  flaggedModels: Array<{
    id: string
    name: string
    flagged_reason: string | null
    created_at: string
    artist_name: string | null
  }>
}

export interface AdminUserRow {
  id: string
  email: string
  display_name: string
  role: 'customer' | 'artist' | 'admin'
  account_status: 'active' | 'suspended' | 'banned'
  artist_name: string | null
  created_at: string
  last_login: string | null
  model_count: string
  order_count: string
  commission_rate: string | null
  intro_commission_rate: string | null
  intro_commission_months: number | null
  standard_commission_rate: string | null
  intro_commission_starts_at: string | null
  intro_commission_ends_at: string | null
}

export interface AdminOrderRow {
  id: string
  order_number: string
  customer_email: string
  total: string
  payment_status: string
  fulfillment_status: string
  created_at: string
  paid_at: string | null
  shipped_at: string | null
  customer_name: string | null
  item_count: string
}

export interface AdminOrderItem {
  id: string
  model_id: string | null
  artist_id: string | null
  bundle_id: string | null
  bundle_name: string | null
  model_name: string
  thumbnail_path: string | null
  quantity: number
  unit_price: string
  total_price: string
  artist_commission_rate: string
  artist_commission_amount: string
  refunded_at: string | null
  refunded_by: string | null
  refund_amount: string | null
  created_at: string
}

export interface AdminOrderDetail {
  id: string
  order_number: string
  customer_email: string
  customer_name: string | null
  user_id: string | null
  subtotal: string
  tax: string
  tax_rate: string
  total: string
  payment_method: string
  payment_status: string
  fulfillment_status: string
  payment_intent_id: string | null
  created_at: string
  paid_at: string | null
}

export interface AdminUserDetail extends AdminUserRow {
  password_hash?: string
  is_super_admin: boolean
  shadow_banned: boolean
  email_verified: boolean
  total_spent: string | null
}

export interface AdminUserOrderRow {
  id: string
  order_number: string
  total: string
  payment_status: string
  fulfillment_status: string
  created_at: string
  item_count: string
}

export interface AdminUserModelRow {
  id: string
  name: string
  status: string
  processing_status: string | null
  thumbnail_path: string | null
  base_price: string
  sale_count: number
  view_count: number
  created_at: string
}

export interface AdminUserTableRow {
  id: string
  name: string
  is_public: boolean
  is_artist_display: boolean
  view_count: number
  clone_count: number
  share_token: string | null
  created_at: string
  updated_at: string
}

export interface AdminUserActivityRow {
  action: string
  resource_type: string | null
  resource_id: string | null
  metadata: any
  created_at: string
}

export interface AdminInvite {
  id: string
  code: string
  max_uses: number
  current_uses: number
  expires_at: string | null
  created_at: string
  used_at: string | null
  created_by_name: string | null
  used_by_name: string | null
  used_by_email: string | null
}

export interface AnalyticsOverview {
  periodDays: number
  totals: {
    totalRevenue: number
    siteRevenue: number
    paidOrders: number
    totalOrders: number
    totalUsers: number
    totalArtists: number
    totalCustomers: number
    totalModels: number
    publishedModels: number
    totalViews: number
    views24h: number
    views7d: number
    visitors24h: number
    visitors7d: number
    activeUsers24h: number
    activeUsers30d: number
  }
  viewsByHourOfDay: Array<{ hour: number; views: number }>
  viewsByDay: Array<{ date: string; views: number }>
}

export const adminApi = {
  // -- Dashboard ------------------------------------------------------------
  getDashboard: async (): Promise<AdminDashboard> => {
    const { data } = await apiClient.get<AdminDashboard>(`${BASE}/dashboard`)
    return data
  },

  // -- Users ----------------------------------------------------------------
  getUsers: async (params: {
    role?: string
    status?: string
    search?: string
    page?: number
    limit?: number
  } = {}): Promise<{ users: AdminUserRow[]; pagination: AdminPagination }> => {
    const { data } = await apiClient.get(`${BASE}/users`, { params })
    return data
  },

  getUser: async (
    id: string,
  ): Promise<{
    user: AdminUserDetail
    recentActivity: AdminUserActivityRow[]
    orders: AdminUserOrderRow[]
    models: AdminUserModelRow[]
    tables: AdminUserTableRow[]
  }> => {
    const { data } = await apiClient.get(`${BASE}/users/${id}`)
    return data
  },

  setUserStatus: async (id: string, status: 'active' | 'suspended' | 'banned') => {
    const { data } = await apiClient.patch(`${BASE}/users/${id}/status`, { status })
    return data
  },

  setUserShadowBan: async (id: string, shadowBanned: boolean) => {
    const { data } = await apiClient.patch(`${BASE}/users/${id}/shadow-ban`, { shadowBanned })
    return data
  },

  setCommissionRate: async (id: string, commissionRate: number) => {
    const { data } = await apiClient.patch(`${BASE}/users/${id}/commission-rate`, { commissionRate })
    return data
  },

  setIntroCommission: async (
    id: string,
    body: { introRate: number; months: number; standardRate?: number },
  ): Promise<{ message: string; startedImmediately: boolean }> => {
    const { data } = await apiClient.put(`${BASE}/users/${id}/intro-commission`, body)
    return data
  },

  cancelIntroCommission: async (id: string) => {
    const { data } = await apiClient.delete(`${BASE}/users/${id}/intro-commission`)
    return data
  },

  deleteUser: async (id: string) => {
    const { data } = await apiClient.delete(`${BASE}/users/${id}`)
    return data
  },

  // -- Orders ---------------------------------------------------------------
  getOrders: async (params: {
    status?: string
    page?: number
    limit?: number
  } = {}): Promise<{ orders: AdminOrderRow[]; pagination: AdminPagination }> => {
    const { data } = await apiClient.get(`${BASE}/orders`, { params })
    return data
  },

  getOrder: async (id: string): Promise<{ order: AdminOrderDetail; items: AdminOrderItem[] }> => {
    const { data } = await apiClient.get(`${BASE}/orders/${id}`)
    return data
  },

  /** Refund a single line item — the buyer's other items in this order are untouched. */
  refundOrderItem: async (
    orderId: string,
    itemId: string,
  ): Promise<{ message: string; refundAmount: number; alreadyPaidToArtist: boolean; orderFullyRefunded: boolean }> => {
    const { data } = await apiClient.post(`${BASE}/orders/${orderId}/items/${itemId}/refund`)
    return data
  },

  setOrderFulfillment: async (
    id: string,
    body: { status: string; trackingNumber?: string; trackingUrl?: string },
  ) => {
    const { data } = await apiClient.patch(`${BASE}/orders/${id}/fulfillment`, body)
    return data
  },

  // -- Analytics (super-admin only) -----------------------------------------
  getAnalyticsOverview: async (period = 30): Promise<AnalyticsOverview> => {
    const { data } = await apiClient.get<AnalyticsOverview>(`${BASE}/analytics/overview`, {
      params: { period },
    })
    return data
  },

  getRevenueAnalytics: async (period = 30): Promise<{
    revenueByDay: Array<{ date: string; order_count: string; revenue: string }>
    revenueByCategory: Array<{ category: string; sales_count: string; revenue: string }>
    topModels: Array<{ id: string; name: string; thumbnail_path: string | null; sales_count: string; revenue: string; artist_name: string | null }>
    topArtists: Array<{ id: string; artist_name: string | null; sales_count: string; earnings: string }>
  }> => {
    const { data } = await apiClient.get(`${BASE}/analytics/revenue`, { params: { period } })
    return data
  },

  getUserAnalytics: async (period = 30): Promise<{
    userGrowth: Array<{ date: string; role: string; new_users: string }>
    activeUsers: { active_users: string }
  }> => {
    const { data } = await apiClient.get(`${BASE}/analytics/users`, { params: { period } })
    return data
  },

  // -- Invite codes (artist onboarding) ------------------------------------
  getInvites: async (): Promise<{ invites: AdminInvite[] }> => {
    const { data } = await apiClient.get(`${BASE}/invites`)
    return data
  },

  createInvite: async (body: { maxUses?: number; expiresInDays?: number }): Promise<{ invite: AdminInvite }> => {
    const { data } = await apiClient.post(`${BASE}/invites`, body)
    return data
  },

  deleteInvite: async (id: string) => {
    const { data } = await apiClient.delete(`${BASE}/invites/${id}`)
    return data
  },

  // -- Read-only catalogue views (public browse endpoints) ------------------
  getCategories: async (): Promise<{ categories: Array<{ category: string; model_count: string }> }> => {
    const { data } = await apiClient.get(`/api/browse/categories`)
    return data
  },

  getPopularTags: async (limit = 100): Promise<{ tags: Array<{ tag: string; usage_count: string }> }> => {
    const { data } = await apiClient.get(`/api/browse/tags`, { params: { limit } })
    return data
  },

  listModels: async (params: { search?: string; page?: number; limit?: number } = {}): Promise<{
    models: any[]
    pagination: AdminPagination
  }> => {
    const { data } = await apiClient.get(`/api/browse`, { params })
    return data
  },
}

export default adminApi
