import apiClient from '../client'
import {
  TableLayout,
  TableLayoutCreateRequest,
  TableLayoutData,
  TableLayoutModel,
} from '../types'

const BASE_URL = '/api/tables'

type TableListResponse = {
  tables: TableLayout[]
  totalCount: number
  page: number
  totalPages: number
}

const ensureNumber = (value: unknown | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const normaliseModel = (model: any): TableLayoutModel => ({
  modelId: model?.modelId ?? model?.model_id ?? model?.id ?? '',
  x: Number(model?.x ?? model?.position?.x ?? 0),
  y: Number(model?.y ?? model?.position?.y ?? 0),
  rotation: model?.rotation ?? model?.rotationDeg ?? undefined,
  scale: model?.scale ?? model?.scaleFactor ?? undefined,
})

const parseLayout = (layout: unknown): TableLayoutData => {
  if (!layout) {
    return { models: [] }
  }

  try {
    const payload = typeof layout === 'string' ? JSON.parse(layout) : layout
    if (Array.isArray((payload as any)?.models)) {
      return { models: (payload as any).models.map(normaliseModel) }
    }
  } catch {
    // fall through and return empty layout
  }
  return { models: [] }
}

const mapTable = (raw: any): TableLayout => ({
  id: raw?.id,
  userId: raw?.user_id ?? raw?.userId ?? null,
  name: raw?.name ?? '',
  description: raw?.description ?? null,
  width: ensureNumber(raw?.width),
  depth: ensureNumber(raw?.depth),
  layout: parseLayout(raw?.layout),
  isPublic: Boolean(raw?.is_public ?? raw?.isPublic),
  shareCode: raw?.share_code ?? raw?.shareCode ?? null,
  viewCount: Number(raw?.view_count ?? raw?.viewCount ?? 0),
  cloneCount: Number(raw?.clone_count ?? raw?.cloneCount ?? 0),
  createdAt: raw?.created_at ?? raw?.createdAt ?? '',
  updatedAt: raw?.updated_at ?? raw?.updatedAt ?? '',
})

const buildPayload = (data: Partial<TableLayoutCreateRequest>) => {
  const payload: Record<string, unknown> = {}
  if (data.name !== undefined) payload.name = data.name
  if (data.description !== undefined) payload.description = data.description
  if (data.width !== undefined) payload.width = data.width
  if (data.depth !== undefined) payload.depth = data.depth
  if (data.layout !== undefined) payload.layout = data.layout
  if (data.isPublic !== undefined) payload.is_public = data.isPublic
  return payload
}

export const tablesApi = {
  async getTableById(id: string): Promise<TableLayout> {
    const response = await apiClient.get(`${BASE_URL}/${id}`)
    const raw = response.data?.table ?? response.data
    return mapTable(raw)
  },

  async createTable(data: TableLayoutCreateRequest): Promise<TableLayout> {
    const response = await apiClient.post(BASE_URL, buildPayload(data))
    const raw = response.data?.table ?? response.data
    return mapTable(raw)
  },

  async updateTable(id: string, data: Partial<TableLayoutCreateRequest>): Promise<TableLayout> {
    const response = await apiClient.put(`${BASE_URL}/${id}`, buildPayload(data))
    const raw = response.data?.table ?? response.data
    return mapTable(raw)
  },

  async deleteTable(id: string): Promise<void> {
    await apiClient.delete(`${BASE_URL}/${id}`)
  },

  async cloneTable(id: string, name?: string): Promise<TableLayout> {
    const response = await apiClient.post(`${BASE_URL}/${id}/clone`, name ? { name } : undefined)
    const raw = response.data?.table ?? response.data
    return mapTable(raw)
  },

  async toggleVisibility(id: string, isPublic: boolean): Promise<TableLayout> {
    const response = await apiClient.patch(`${BASE_URL}/${id}/visibility`, { isPublic })
    const raw = response.data?.table ?? response.data
    return mapTable(raw)
  },

  async regenerateShareCode(id: string): Promise<TableLayout> {
    const response = await apiClient.post(`${BASE_URL}/${id}/regenerate-share-code`)
    const raw = response.data?.table ?? response.data
    return mapTable(raw)
  },

  async getPublicTables(
    page = 1,
    limit = 20,
    sort: 'popular' | 'newest' | 'updated' = 'popular',
  ): Promise<TableListResponse> {
    const response = await apiClient.get(BASE_URL + '/public', {
      params: { page, limit, sort },
    })

    const payload = response.data ?? {}
    const tables = Array.isArray(payload.tables) ? payload.tables.map(mapTable) : []
    return {
      tables,
      totalCount: Number(payload.totalCount ?? payload.total ?? tables.length),
      page: Number(payload.page ?? page),
      totalPages: Number(payload.totalPages ?? payload.total_pages ?? 1),
    }
  },

  async getFeaturedTables(limit = 6): Promise<TableLayout[]> {
    const response = await apiClient.get(BASE_URL + '/featured', { params: { limit } })
    const payload = response.data ?? {}
    return Array.isArray(payload.tables) ? payload.tables.map(mapTable) : []
  },

  async getMyTables(page = 1, limit = 20): Promise<TableListResponse> {
    const response = await apiClient.get(BASE_URL + '/my', { params: { page, limit } })
    const payload = response.data ?? {}
    const tables = Array.isArray(payload.tables) ? payload.tables.map(mapTable) : []
    return {
      tables,
      totalCount: Number(payload.totalCount ?? payload.total ?? tables.length),
      page: Number(payload.page ?? page),
      totalPages: Number(payload.totalPages ?? payload.total_pages ?? 1),
    }
  },

  async getUserTables(userId: string, page = 1, limit = 20): Promise<TableListResponse> {
    const response = await apiClient.get(`${BASE_URL}/user/${userId}`, {
      params: { page, limit },
    })
    const payload = response.data ?? {}
    const tables = Array.isArray(payload.tables) ? payload.tables.map(mapTable) : []
    return {
      tables,
      totalCount: Number(payload.totalCount ?? payload.total ?? tables.length),
      page: Number(payload.page ?? page),
      totalPages: Number(payload.totalPages ?? payload.total_pages ?? 1),
    }
  },

  async getSharedTable(shareCode: string): Promise<TableLayout> {
    const response = await apiClient.get(`${BASE_URL}/shared/${shareCode}`)
    const raw = response.data?.table ?? response.data
    return mapTable(raw)
  },

  async exportTable(
    tableId: string,
    format: 'obj' | 'fbx' | 'glb' | 'unity' | 'unreal',
  ): Promise<{ exportUrl: string; expiresAt: number }> {
    const response = await apiClient.get(`${BASE_URL}/${tableId}/export`, {
      params: { format },
    })
    const payload = response.data ?? {}
    return {
      exportUrl: payload.exportUrl ?? payload.export_url,
      expiresAt: Number(payload.expiresAt ?? payload.expires_at ?? 0),
    }
  },
}
