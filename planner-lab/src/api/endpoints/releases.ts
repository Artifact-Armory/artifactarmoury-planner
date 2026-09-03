import apiClient from '../client'

export type ReleaseStatus = 'draft' | 'scheduled' | 'published' | 'cancelled'
export type ReleaseItemType = 'model' | 'bundle' | 'table'

export interface ReleaseItem {
  id: string            // release_items row id (used to remove)
  itemType: ReleaseItemType
  itemId: string
  published: boolean
  publishError: string | null
  name: string
  itemStatus: string
}

export interface Release {
  id: string
  name: string
  status: ReleaseStatus
  scheduledAt: string | null
  publishedAt: string | null
  publishError: string | null
  itemCount?: number
  items?: ReleaseItem[]
}

const BASE = '/api/releases'

function mapItem(i: any): ReleaseItem {
  return {
    id: i.id,
    itemType: i.itemType,
    itemId: i.itemId,
    published: !!i.published,
    publishError: i.publishError ?? null,
    name: i.name,
    itemStatus: i.itemStatus,
  }
}

function mapRelease(r: any): Release {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    scheduledAt: r.scheduled_at ?? null,
    publishedAt: r.published_at ?? null,
    publishError: r.publish_error ?? null,
    itemCount: r.item_count != null ? Number(r.item_count) : undefined,
    items: Array.isArray(r.items) ? r.items.map(mapItem) : undefined,
  }
}

export const releasesApi = {
  list: async (): Promise<Release[]> =>
    ((await apiClient.get(`${BASE}/my`)).data?.releases ?? []).map(mapRelease),

  getById: async (id: string): Promise<Release> =>
    mapRelease((await apiClient.get(`${BASE}/${id}`)).data.release),

  create: async (name: string, scheduledAt?: string | null): Promise<Release> =>
    mapRelease((await apiClient.post(BASE, { name, scheduledAt })).data.release),

  update: async (id: string, data: { name?: string; scheduledAt?: string | null }): Promise<Release> =>
    mapRelease((await apiClient.patch(`${BASE}/${id}`, data)).data.release),

  addItem: async (id: string, itemType: ReleaseItemType, itemId: string): Promise<ReleaseItem[]> =>
    ((await apiClient.post(`${BASE}/${id}/items`, { itemType, itemId })).data?.items ?? []).map(mapItem),

  removeItem: async (id: string, itemRowId: string): Promise<ReleaseItem[]> =>
    ((await apiClient.delete(`${BASE}/${id}/items/${itemRowId}`)).data?.items ?? []).map(mapItem),

  schedule: async (id: string, scheduledAt: string): Promise<Release> =>
    mapRelease((await apiClient.post(`${BASE}/${id}/schedule`, { scheduledAt })).data.release),

  unschedule: async (id: string): Promise<Release> =>
    mapRelease((await apiClient.post(`${BASE}/${id}/unschedule`)).data.release),

  publishNow: async (id: string): Promise<Release> =>
    mapRelease((await apiClient.post(`${BASE}/${id}/publish-now`)).data.release),

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`${BASE}/${id}`)
  },
}
