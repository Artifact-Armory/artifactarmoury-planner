import apiClient from '../client'
import { ApiResponse, SaveTablePayload, TableLayout } from '../types'
import { assetUrl } from '../transformers'

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

/** Lightweight shape for the public /tables gallery cards (never carries email). */
export interface PublicTableCard {
  id: string
  name: string
  shareToken?: string
  pieceCount: number
  viewCount: number
  cloneCount: number
  creatorId: string | null
  creatorName: string
  creatorIsArtist: boolean
  thumbnails: string[]
  createdAt?: string
  updatedAt?: string
}

const mapPublicTableCard = (t: any): PublicTableCard => ({
  id: t.id,
  name: t.name,
  shareToken: t.share_token ?? undefined,
  pieceCount: Number(t.piece_count ?? t.model_count ?? 0) || 0,
  viewCount: Number(t.view_count ?? 0) || 0,
  cloneCount: Number(t.clone_count ?? 0) || 0,
  creatorId: t.creator_id ?? null,
  creatorName: t.creator_name ?? 'Anonymous',
  creatorIsArtist: Boolean(t.creator_is_artist),
  thumbnails: (Array.isArray(t.thumbnails) ? t.thumbnails : [])
    .map((p: string) => assetUrl(p))
    .filter((u: string | undefined): u is string => Boolean(u)),
  createdAt: t.created_at ?? t.createdAt,
  updatedAt: t.updated_at ?? t.updatedAt
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
  (typeof response === 'object' && response !== null && 'data' in response &&
  (response as ApiResponse<T>).data !== undefined
    ? (response as ApiResponse<T>).data
    : response) as T

// Single-table endpoints return the row wrapped as `{ table: {...} }`; tolerate
// that, a `{ data: {...} }` envelope, or the bare row.
const pickTable = (body: any): any => body?.table ?? body?.data ?? body

export const tablesApi = {
  async getById(id: string, params?: { userId?: string; userEmail?: string }) {
    const response = await apiClient.get<ApiResponse<TableLayout>>(`${BASE_URL}/${id}`, {
      params: {
        user_id: params?.userId,
        user_email: params?.userEmail
      }
    })
    return mapTable(pickTable(response.data ?? response))
  },

  async getSharedTable(token: string) {
    const response = await apiClient.get<ApiResponse<TableLayout>>(`${BASE_URL}/shared/${token}`)
    return mapTable(pickTable(response.data ?? response))
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

  async getContributors(id: string): Promise<Array<{ id: string; name: string; profileImageUrl?: string; modelCount: number }>> {
    const response = await apiClient.get<ApiResponse<any>>(`${BASE_URL}/${id}/contributors`)
    const payload = unwrap(response.data ?? (response as any)) as any
    return (payload.contributors ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      profileImageUrl: c.profile_image_url ?? undefined,
      modelCount: Number(c.model_count ?? 0),
    }))
  },

  async getPublicTables(
    page = 1,
    limit = 20,
    sort: 'recent' | 'updated' | 'popular' = 'recent'
  ): Promise<{ tables: PublicTableCard[]; total: number; page: number; totalPages: number }> {
    const response = await apiClient.get<ApiResponse<any>>(`${BASE_URL}/public/list`, {
      params: { page, limit, sort }
    })
    const payload = unwrap(response.data ?? (response as any)) as any
    return {
      tables: (payload.tables ?? payload.data ?? []).map(mapPublicTableCard),
      total: payload.total ?? payload.totalCount ?? 0,
      page: payload.page ?? 1,
      totalPages: payload.total_pages ?? payload.totalPages ?? 1
    }
  },

  async createTable(payload: SaveTablePayload) {
    const response = await apiClient.post<ApiResponse<TableLayout>>(BASE_URL, toServerPayload(payload))
    return mapTable(pickTable(response.data ?? response))
  },

  async updateTable(id: string, payload: Partial<SaveTablePayload>) {
    const response = await apiClient.put<ApiResponse<TableLayout>>(`${BASE_URL}/${id}`, toServerPayload(payload))
    return mapTable(pickTable(response.data ?? response))
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
    return mapTable(pickTable(response.data ?? response))
  },

  async duplicate(id: string, payload: { userId?: string; userEmail?: string }) {
    const response = await apiClient.post<ApiResponse<TableLayout>>(`${BASE_URL}/${id}/duplicate`, {
      user_id: payload.userId,
      user_email: payload.userEmail
    })
    return mapTable(pickTable(response.data ?? response))
  },

  async regenerateShareCode(id: string, payload: { userId?: string; userEmail?: string }) {
    const response = await apiClient.post<ApiResponse<TableLayout>>(`${BASE_URL}/${id}/regenerate-token`, {
      user_id: payload.userId,
      user_email: payload.userEmail
    })
    return mapTable(pickTable(response.data ?? response))
  },

  // ---- printable terrain tiles ----

  async getTerrainQuote(id: string): Promise<{
    hasTerrain: boolean
    tileCount: number
    tilesX?: number
    tilesY?: number
    price: number
    pricePerTile: number
  }> {
    const response = await apiClient.get(`${BASE_URL}/${id}/terrain/quote`)
    return response.data
  },

  async downloadTerrainTiles(id: string, userEmail?: string): Promise<void> {
    const response = await apiClient.get(`${BASE_URL}/${id}/terrain/download`, {
      params: { user_email: userEmail },
      responseType: 'blob',
      timeout: 300000,
    })
    const url = window.URL.createObjectURL(response.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'terrain-tiles.zip'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  }
}
