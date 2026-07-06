import apiClient from '../client'

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  actorId: string | null
  actorName: string | null
  actorAvatar: string | null
  modelId: string | null
  isRead: boolean
  createdAt: string
}

const mapNotification = (n: any): AppNotification => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body ?? null,
  link: n.link ?? null,
  actorId: n.actor_id ?? null,
  actorName: n.actor_name ?? null,
  actorAvatar: n.actor_avatar ?? null,
  modelId: n.model_id ?? null,
  isRead: Boolean(n.is_read),
  createdAt: n.created_at,
})

export const notificationsApi = {
  list: async (params: { limit?: number; offset?: number } = {}): Promise<AppNotification[]> => {
    const response = await apiClient.get('/api/notifications', { params })
    return (response.data?.notifications ?? []).map(mapNotification)
  },

  unreadCount: async (): Promise<number> => {
    const response = await apiClient.get('/api/notifications/unread-count')
    return Number(response.data?.count ?? 0)
  },

  markRead: async (id: string): Promise<void> => {
    await apiClient.post(`/api/notifications/${id}/read`)
  },

  markAllRead: async (): Promise<void> => {
    await apiClient.post('/api/notifications/read-all')
  },
}
