import apiClient from '../client'
import {
  Category,
  Tag,
  SearchFilters,
  SearchResponse,
  TerrainModel,
  Pagination,
} from '../types'
import { mapModelRecord } from '../transformers'

const BASE_URL = '/api/browse'

const toPagination = (raw?: Record<string, any>): Pagination => ({
  page: Number(raw?.page ?? 1),
  limit: Number(raw?.limit ?? 0),
  totalItems: Number(raw?.total ?? raw?.totalItems ?? 0),
  totalPages: Number(raw?.totalPages ?? raw?.pages ?? 0),
})

const parseModelList = (rows: any[] | undefined): TerrainModel[] =>
  (rows ?? []).map((model) => mapModelRecord(model))

const buildSearchResponse = (payload: any): SearchResponse => ({
  models: parseModelList(payload?.models),
  pagination: toPagination(payload?.pagination),
})

export const browseApi = {
  searchModels: async (filters: SearchFilters = {}): Promise<SearchResponse> => {
    const response = await apiClient.get(`${BASE_URL}`, { params: filters })
    return buildSearchResponse(response.data)
  },

  getFeaturedModels: async (limit = 8): Promise<TerrainModel[]> => {
    const response = await apiClient.get(`${BASE_URL}/featured`, { params: { limit } })
    return parseModelList(response.data?.featured)
  },

  getNewArrivals: async (limit = 12): Promise<TerrainModel[]> => {
    const response = await apiClient.get(`${BASE_URL}/new`, { params: { limit } })
    return parseModelList(response.data?.newArrivals)
  },

  getTrendingModels: async (limit = 12): Promise<TerrainModel[]> => {
    const response = await apiClient.get(`${BASE_URL}/trending`, { params: { limit } })
    return parseModelList(response.data?.trending)
  },

  getCategories: async (): Promise<Category[]> => {
    const response = await apiClient.get(`${BASE_URL}/categories`)
    return (response.data?.categories ?? []).map((category: any) => ({
      id: category.category,
      name: category.category,
      category: category.category,
      modelCount: Number(category.model_count ?? category.modelCount ?? 0),
    }))
  },

  getTags: async (limit = 50): Promise<Tag[]> => {
    const response = await apiClient.get(`${BASE_URL}/tags`, { params: { limit } })
    return (response.data?.tags ?? []).map((tag: any) => ({
      id: tag.tag,
      tag: tag.tag,
      usageCount: Number(tag.usage_count ?? tag.usageCount ?? 0),
    }))
  },

  getSuggestions: async (query: string, limit = 5): Promise<string[]> => {
    if (!query) return []
    const response = await apiClient.get(`${BASE_URL}/suggestions`, {
      params: { q: query, limit },
    })
    return response.data?.suggestions ?? []
  },

  getModelsByCategory: async (
    categoryId: string,
    page = 1,
    limit = 20,
    sortBy: SearchFilters['sortBy'] = 'popular',
  ): Promise<SearchResponse> => {
    return browseApi.searchModels({ category: categoryId, page, limit, sortBy })
  },

  getModelsByTag: async (
    tag: string,
    page = 1,
    limit = 20,
    sortBy: SearchFilters['sortBy'] = 'popular',
  ): Promise<SearchResponse> => {
    return browseApi.searchModels({ tags: tag, page, limit, sortBy })
  },
}
