import apiClient from '../client'

const BASE_URL = '/api/admin'

export type ReportStatus =
  | 'open' | 'under_review' | 'awaiting_info' | 'resolved_upheld' | 'resolved_dismissed'

export interface ReportTile {
  id: string
  reason: string
  reason_label: string
  status: ReportStatus
  created_at: string
  detail?: string | null
  model_id?: string | null
  model_name?: string | null
  thumbnail_path?: string | null
  model_status?: string | null
  artist_id?: string | null
  artist_name?: string | null
  artist_display_name?: string | null
  reporter_id?: string | null
  reporter_name?: string | null
  attachment_count: number
}

export interface ReportDetail extends ReportTile {
  model_description?: string | null
  model_category?: string | null
  artist_email?: string | null
  artist_account_status?: string | null
  artist_shadow_banned?: boolean
  reporter_email?: string | null
  reporter_shadow_banned?: boolean
  resolution_action?: string | null
  resolution_summary?: string | null
  resolved_at?: string | null
  resolved_by_name?: string | null
}

export interface ReportAttachment {
  id: string
  file_path: string
  file_name?: string | null
  content_type?: string | null
  url: string
}

export interface ReportContext {
  other_reports_on_model: number
  other_reports_on_artist: number
  artist_model_count: number
}

export type ModerationAction =
  | 'dismiss' | 'request_info' | 'warn_artist' | 'unpublish_model' | 'flag_model'
  | 'remove_model' | 'refund_buyers' | 'suspend_artist' | 'ban_artist'
  | 'shadow_ban_user' | 'reinstate_model'

export const adminModerationApi = {
  async listReports(status?: string): Promise<{ reports: ReportTile[]; openCount: number; pagination: any }> {
    const res = await apiClient.get(`${BASE_URL}/reports`, { params: status ? { status } : {} })
    return res.data
  },

  async getReport(id: string): Promise<{ report: ReportDetail; attachments: ReportAttachment[]; context: ReportContext }> {
    const res = await apiClient.get(`${BASE_URL}/reports/${id}`)
    return res.data
  },

  async resolve(id: string, action: ModerationAction, summary: string, targetUserId?: string): Promise<{ status: ReportStatus; notes: string[] }> {
    const res = await apiClient.post(`${BASE_URL}/reports/${id}/resolve`, { action, summary, targetUserId })
    return res.data
  },

  async setShadowBan(userId: string, shadowBanned: boolean): Promise<void> {
    await apiClient.patch(`${BASE_URL}/users/${userId}/shadow-ban`, { shadowBanned })
  },

  async runPayouts(): Promise<{ cleared: number; payouts: any[] }> {
    const res = await apiClient.post(`${BASE_URL}/payouts/run`)
    return res.data
  },
}
