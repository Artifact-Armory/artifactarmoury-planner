import apiClient from '../client'

const BASE_URL = '/api/admin/models'

/** One row per model with at least one open complaint (GET /api/admin/models/reported). */
export interface ReportedModelRow {
  id: string
  name: string
  thumbnail_path: string | null
  status: string
  base_price: string
  created_at: string
  artist_id: string
  artist_name: string | null
  artist_email: string
  open_report_count: string
  total_report_count: string
  last_reported_at: string
  open_reasons: string[]
}

export interface AdminModelDetail {
  id: string
  name: string
  description: string | null
  category: string
  tags: string[] | null
  status: 'draft' | 'published' | 'archived' | 'flagged'
  flagged_reason: string | null
  thumbnail_path: string | null
  base_price: string
  part_count: number
  sale_count: number
  view_count: number
  processing_status: string | null
  created_at: string
  artist_id: string
  artist_name: string | null
  artist_email: string
  artist_account_status: 'active' | 'suspended' | 'banned'
}

export interface ModelReportRow {
  id: string
  reason: string
  reason_label: string
  status: string
  detail: string | null
  resolution_action: string | null
  resolution_summary: string | null
  created_at: string
  resolved_at: string | null
  reporter_name: string | null
  resolved_by_name: string | null
}

export type DirectModelAction =
  | 'warn_artist' | 'unpublish_model' | 'flag_model' | 'remove_model' | 'refund_buyers' | 'reinstate_model'

export const adminModelsApi = {
  async listReported(): Promise<{ models: ReportedModelRow[] }> {
    const res = await apiClient.get(`${BASE_URL}/reported`)
    return res.data
  },

  async getModel(id: string): Promise<{ model: AdminModelDetail; reports: ModelReportRow[] }> {
    const res = await apiClient.get(`${BASE_URL}/${id}`)
    return res.data
  },

  /** Fast action from the admin model panel. `message` is required server-side and is
   * shown to the artist (via a synthetic, auto-resolved report — see routes/admin.ts). */
  async moderate(id: string, action: DirectModelAction, message: string): Promise<{ status: string; notes: string[] }> {
    const res = await apiClient.post(`${BASE_URL}/${id}/moderate`, { action, message })
    return res.data
  },
}
