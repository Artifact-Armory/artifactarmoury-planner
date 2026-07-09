import apiClient from '../client'

export interface ConversationSummary {
  id: string
  kind: 'direct' | 'system'
  subject: string | null
  allowReplies: boolean
  lastMessageAt: string | null
  lastMessagePreview: string | null
  otherId: string | null
  otherName: string | null
  otherAvatar: string | null
  otherRole: string | null
  unread: number
}

export interface ChatMessage {
  id: string
  senderId: string | null
  isSystem: boolean
  body: string
  createdAt: string
  senderName: string | null
  senderAvatar: string | null
}

export interface ConversationDetail {
  id: string
  kind: 'direct' | 'system'
  subject: string | null
  allowReplies: boolean
  createdAt: string
  otherId: string | null
  otherName: string | null
  otherAvatar: string | null
  otherRole: string | null
}

export interface AdminThread {
  id: string
  subject: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  userId: string
  userEmail: string
  userName: string
  awaitingReply: boolean
}

const mapSummary = (c: any): ConversationSummary => ({
  id: c.id,
  kind: c.kind,
  subject: c.subject ?? null,
  allowReplies: Boolean(c.allow_replies),
  lastMessageAt: c.last_message_at ?? null,
  lastMessagePreview: c.last_message_preview ?? null,
  otherId: c.other_id ?? null,
  otherName: c.other_name ?? null,
  otherAvatar: c.other_avatar ?? null,
  otherRole: c.other_role ?? null,
  unread: Number(c.unread ?? 0),
})

const mapMessage = (m: any): ChatMessage => ({
  id: m.id,
  senderId: m.sender_id ?? null,
  isSystem: Boolean(m.is_system),
  body: m.body,
  createdAt: m.created_at,
  senderName: m.sender_name ?? null,
  senderAvatar: m.sender_avatar ?? null,
})

const mapDetail = (c: any): ConversationDetail => ({
  id: c.id,
  kind: c.kind,
  subject: c.subject ?? null,
  allowReplies: Boolean(c.allow_replies),
  createdAt: c.created_at,
  otherId: c.other_id ?? null,
  otherName: c.other_name ?? null,
  otherAvatar: c.other_avatar ?? null,
  otherRole: c.other_role ?? null,
})

export const messagesApi = {
  unreadCount: async (): Promise<number> => {
    const res = await apiClient.get('/api/messages/unread-count')
    return Number(res.data?.count ?? 0)
  },

  list: async (params: { limit?: number; offset?: number } = {}): Promise<ConversationSummary[]> => {
    const res = await apiClient.get('/api/messages', { params })
    return (res.data?.conversations ?? []).map(mapSummary)
  },

  get: async (id: string): Promise<{ conversation: ConversationDetail; messages: ChatMessage[] }> => {
    const res = await apiClient.get(`/api/messages/${id}`)
    return {
      conversation: mapDetail(res.data?.conversation ?? {}),
      messages: (res.data?.messages ?? []).map(mapMessage),
    }
  },

  start: async (payload: { recipientId: string; body?: string }): Promise<string> => {
    const res = await apiClient.post('/api/messages/start', payload)
    return res.data?.conversationId as string
  },

  send: async (id: string, body: string): Promise<ChatMessage> => {
    const res = await apiClient.post(`/api/messages/${id}/messages`, { body })
    return mapMessage(res.data?.message ?? {})
  },

  markRead: async (id: string): Promise<void> => {
    await apiClient.post(`/api/messages/${id}/read`)
  },

  report: async (id: string, payload: { reason: string; detail?: string }): Promise<void> => {
    await apiClient.post(`/api/messages/${id}/report`, payload)
  },

  archive: async (id: string): Promise<void> => {
    await apiClient.post(`/api/messages/${id}/archive`)
  },

  // ---- Admin ----
  adminBroadcast: async (payload: {
    subject: string
    body: string
    audience: 'all' | 'customers' | 'artists'
  }): Promise<{ conversationId: string; recipients: number }> => {
    const res = await apiClient.post('/api/admin/messages/broadcast', payload)
    return { conversationId: res.data?.conversationId, recipients: Number(res.data?.recipients ?? 0) }
  },

  adminDm: async (payload: {
    userId?: string
    email?: string
    subject?: string
    body: string
  }): Promise<string> => {
    const res = await apiClient.post('/api/admin/messages/dm', payload)
    return res.data?.conversationId as string
  },

  adminThreads: async (): Promise<AdminThread[]> => {
    const res = await apiClient.get('/api/admin/messages/threads')
    return (res.data?.threads ?? []).map((t: any): AdminThread => ({
      id: t.id,
      subject: t.subject ?? null,
      lastMessageAt: t.last_message_at ?? null,
      lastMessagePreview: t.last_message_preview ?? null,
      userId: t.user_id,
      userEmail: t.user_email,
      userName: t.user_name,
      awaitingReply: Boolean(t.awaiting_reply),
    }))
  },
}
