import apiClient from '../client'

const BASE = '/api/admin/conversation-reports'

export type ConvReportStatus = 'open' | 'under_review' | 'resolved_upheld' | 'resolved_dismissed'
export type ConvReportAction = 'dismiss' | 'warn_user' | 'shadow_ban_user' | 'suspend_user' | 'ban_user'

export interface ConvReportTile {
  id: string
  reason: string
  status: ConvReportStatus
  detail: string | null
  created_at: string
  resolved_at: string | null
  resolution_action: string | null
  resolution_summary: string | null
  conversation_id: string | null
  reporter_id: string | null
  reporter_name: string | null
  reported_user_id: string | null
  reported_user_name: string | null
  reported_account_status: string | null
  reported_shadow_banned: boolean | null
  message_count: number | null
}

export interface SnapshotMessage {
  id: string
  senderId: string | null
  senderName: string | null
  isSystem: boolean
  body: string
  createdAt: string
}

export interface ConvReportDetail extends ConvReportTile {
  reporter_email: string | null
  reported_user_email: string | null
  resolved_by_name: string | null
  snapshot: {
    capturedAt: string
    reporterName: string | null
    reportedUserName: string | null
    messages: SnapshotMessage[]
  }
}

export const adminMessageReportsApi = {
  list: async (status?: string): Promise<{ reports: ConvReportTile[]; openCount: number }> => {
    const res = await apiClient.get(BASE, { params: status ? { status } : {} })
    return { reports: res.data?.reports ?? [], openCount: Number(res.data?.openCount ?? 0) }
  },

  get: async (id: string): Promise<ConvReportDetail> => {
    const res = await apiClient.get(`${BASE}/${id}`)
    return res.data?.report as ConvReportDetail
  },

  resolve: async (
    id: string,
    action: ConvReportAction,
    summary: string,
  ): Promise<{ status: ConvReportStatus; notes: string[] }> => {
    const res = await apiClient.post(`${BASE}/${id}/resolve`, { action, summary })
    return res.data
  },
}
