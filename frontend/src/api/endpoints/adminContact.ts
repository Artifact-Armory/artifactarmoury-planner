import apiClient from '../client'

const BASE_URL = '/api/admin/contact'

export type ContactStatus = 'open' | 'resolved'

export interface ContactMessageTile {
  id: string
  name: string
  email: string
  subject: string
  message: string
  is_read: boolean
  status: ContactStatus
  created_at: string
  user_id?: string | null
  user_display_name?: string | null
  attachment_count: number
}

export interface ContactMessageDetail extends ContactMessageTile {
  user_email?: string | null
  user_role?: string | null
  resolved_by?: string | null
  resolved_by_name?: string | null
  resolved_at?: string | null
}

export interface ContactAttachment {
  id: string
  file_path: string
  file_name?: string | null
  content_type?: string | null
  url: string
}

export const adminContactApi = {
  async list(status?: string): Promise<{ messages: ContactMessageTile[]; unreadCount: number; pagination: any }> {
    const res = await apiClient.get(BASE_URL, { params: status ? { status } : {} })
    return res.data
  },

  async get(id: string): Promise<{ message: ContactMessageDetail; attachments: ContactAttachment[] }> {
    const res = await apiClient.get(`${BASE_URL}/${id}`)
    return res.data
  },

  async setStatus(id: string, status: ContactStatus): Promise<{ message: { id: string; status: ContactStatus } }> {
    const res = await apiClient.patch(`${BASE_URL}/${id}/status`, { status })
    return res.data
  },
}
