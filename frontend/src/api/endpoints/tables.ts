import apiClient from '../client'
import { ApiResponse, SaveTablePayload, TableLayout } from '../types'

const BASE_URL = '/api/tables'

const mapTable = (table: any): TableLayout => ({
  id: table.id,
  userId: table.user_id ?? null,
  userEmail: table.user_email ?? table.userEmail ?? null,
  name: table.name,
  description: table.description ?? undefined,
  tableConfig: table.table_config ?? {
    width: table.width ?? 1200,
    depth: table.depth ?? 900,
    grid_size: table.table_config?.grid_size ?? 50,
    background_color: table.table_config?.background_color,
    grid_color: table.table_config?.grid_color
  },
  layoutData: table.layout_data ?? table.layout ?? { models: [] },
  shareToken: table.share_token ?? table.shareCode,
  shareCode: table.share_code ?? table.share_token,
  isPublic: Boolean(table.is_public),
  viewCount: table.view_count ?? 0,
  cloneCount: table.clone_count ?? 0,
  status: table.status ?? undefined,
  plan: table.plan ?? undefined,
  maxAssets: table.max_assets ?? undefined,
  createdAt: table.created_at ?? table.createdAt,
  updatedAt: table.updated_at ?? table.updatedAt
})

const toServerPayload = (payload: Partial<SaveTablePayload>) => ({
  name: payload.name,
  description: payload.description,
  table_config: payload.tableConfig,
  layout_data: payload.layoutData,
  is_public: payload.isPublic,
  user_id: payload.userId,
  user_email: payload.userEmail,
  session_id: payload.sessionId
})

const unwrap = <T>(response: ApiResponse<T> | T): T =>
  (response && 'data' in response && response.data !== undefined ? response.data : response) as T

export const tablesApi = {
  async getById(id: string, params?: { userId?: string; userEmail?: string }) {
    const response = await apiClient.get<ApiResponse<TableLayout>>(`${BASE_URL}/${id}`, {
      params: {
        user_id: params?.userId,
        user_email: params?.userEmail
      }
    })
    return mapTable(unwrap(response.data ?? (response as any)))
  },

  async getSharedTable(token: string) {
    const response = await apiClient.get<ApiResponse<TableLayout>>(`${BASE_URL}/shared/${token}`)
    return mapTable(unwrap(response.data ?? (response as any)))
  },

  async getUserTables(identifier: string, page = 1, limit = 20) {
    const response = await apiClient.get<ApiResponse<any>>(`${BASE_URL}/user/${identifier}`, {
      params: { page, limit }
    })
    const payload = unwrap(response.data ?? (response as any)) as any
    return {
      tables: (payload.tables ?? payload.data ?? []).map(mapTable),
      total: payload.total ?? payload.totalCount ?? 0,
      page: payload.page ?? 1,
      totalPages: payload.total_pages ?? payload.totalPages ?? 1
    }
  },

  async getPublicTables(page = 1, limit = 20, sort: 'recent' | 'updated' = 'recent') {
    const response = await apiClient.get<ApiResponse<any>>(`${BASE_URL}/public/list`, {
      params: { page, limit, sort }
    })
    const payload = unwrap(response.data ?? (response as any)) as any
    return {
      tables: (payload.tables ?? payload.data ?? []).map(mapTable),
      total: payload.total ?? payload.totalCount ?? 0,
      page: payload.page ?? 1,
      totalPages: payload.total_pages ?? payload.totalPages ?? 1
    }
  },

  async createTable(payload: SaveTablePayload) {
    const response = await apiClient.post<ApiResponse<TableLayout>>(BASE_URL, toServerPayload(payload))
    return mapTable(unwrap(response.data ?? (response as any)))
  },

  async updateTable(id: string, payload: Partial<SaveTablePayload>) {
    const response = await apiClient.put<ApiResponse<TableLayout>>(`${BASE_URL}/${id}`, toServerPayload(payload))
    return mapTable(unwrap(response.data ?? (response as any)))
  },

  async deleteTable(id: string, payload: { userId?: string; userEmail?: string }) {
    await apiClient.delete(`${BASE_URL}/${id}`, {
      data: {
        user_id: payload.userId,
        user_email: payload.userEmail
      }
    })
  },

  async toggleVisibility(id: string, payload: { userId?: string; userEmail?: string; isPublic: boolean }) {
    const response = await apiClient.patch<ApiResponse<TableLayout>>(`${BASE_URL}/${id}/visibility`, {
      user_id: payload.userId,
      user_email: payload.userEmail,
      is_public: payload.isPublic
    })
    return mapTable(unwrap(response.data ?? (response as any)))
  },

  async duplicate(id: string, payload: { userId?: string; userEmail?: string }) {
    const response = await apiClient.post<ApiResponse<TableLayout>>(`${BASE_URL}/${id}/duplicate`, {
      user_id: payload.userId,
      user_email: payload.userEmail
    })
    return mapTable(unwrap(response.data ?? (response as any)))
  },

  async regenerateShareCode(id: string, payload: { userId?: string; userEmail?: string }) {
    const response = await apiClient.post<ApiResponse<TableLayout>>(`${BASE_URL}/${id}/regenerate-token`, {
      user_id: payload.userId,
      user_email: payload.userEmail
    })
    return mapTable(unwrap(response.data ?? (response as any)))
  }
}
