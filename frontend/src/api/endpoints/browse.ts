import apiClient from '../client';
import { 
  ApiResponse, 
  Category,
  Tag,
  SearchFilters,
  SearchResponse,
  TerrainModel
} from '../types';

const BASE_URL = '/api/browse';

export const browseApi = {
  /**
   * Search models with filters
   */
  searchModels: async (filters: SearchFilters): Promise<ApiResponse<SearchResponse>> => {
    const response = await apiClient.get<ApiResponse<SearchResponse>>(`${BASE_URL}/search`, {
      params: filters,
    });
    return response.data;
  },

  /**
   * Get featured models for homepage
   */
  getFeaturedModels: async (limit = 8): Promise<ApiResponse<TerrainModel[]>> => {
    const response = await apiClient.get<ApiResponse<TerrainModel[]>>(`${BASE_URL}/featured`, {
      params: { limit },
    });
    return response.data;
  },

  /**
   * Get newest models
   */
  getNewestModels: async (limit = 12): Promise<ApiResponse<TerrainModel[]>> => {
    const response = await apiClient.get<ApiResponse<TerrainModel[]>>(`${BASE_URL}/newest`, {
      params: { limit },
    });
    return response.data;
  },

  /**
   * Get popular models
   */
  getPopularModels: async (limit = 12): Promise<ApiResponse<TerrainModel[]>> => {
    const response = await apiClient.get<ApiResponse<TerrainModel[]>>(`${BASE_URL}/popular`, {
      params: { limit },
    });
    return response.data;
  },

  /**
   * Get all categories
   */
  getAllCategories: async (): Promise<ApiResponse<Category[]>> => {
    const response = await apiClient.get<ApiResponse<Category[]>>(`${BASE_URL}/categories`);
    return response.data;
  },

  /**
   * Get a category by ID
   */
  getCategoryById: async (id: string): Promise<ApiResponse<Category>> => {
    const response = await apiClient.get<ApiResponse<Category>>(`${BASE_URL}/categories/${id}`);
    return response.data;
  },

  /**
   * Get models by category
   */
  getModelsByCategory: async (
    categoryId: string, 
    page = 1, 
    limit = 20,
    sort: 'newest' | 'popular' | 'price_low' | 'price_high' = 'popular'
  ): Promise<ApiResponse<SearchResponse>> => {
    const response = await apiClient.get<ApiResponse<SearchResponse>>(
      `${BASE_URL}/categories/${categoryId}/models`,
      {
        params: { page, limit, sort },
      }
    );
    return response.data;
  },

  /**
   * Get all tags
   */
  getAllTags: async (): Promise<ApiResponse<Tag[]>> => {
    const response = await apiClient.get<ApiResponse<Tag[]>>(`${BASE_URL}/tags`);
    return response.data;
  },

  /**
   * Get popular tags
   */
  getPopularTags: async (limit = 20): Promise<ApiResponse<Tag[]>> => {
    const response = await apiClient.get<ApiResponse<Tag[]>>(`${BASE_URL}/tags/popular`, {
      params: { limit },
    });
    return response.data;
  },

  /**
   * Get models by tag
   */
  getModelsByTag: async (
    tagId: string, 
    page = 1, 
    limit = 20,
    sort: 'newest' | 'popular' | 'price_low' | 'price_high' = 'popular'
  ): Promise<ApiResponse<SearchResponse>> => {
    const response = await apiClient.get<ApiResponse<SearchResponse>>(
      `${BASE_URL}/tags/${tagId}/models`,
      {
        params: { page, limit, sort },
      }
    );
    return response.data;
  },

  /**
   * Get models filtered by file format
   */
  getModelsByFileFormat: async (
    format: 'obj' | 'fbx' | 'blend' | 'unity' | 'unreal',
    page = 1, 
    limit = 20,
    sort: 'newest' | 'popular' | 'price_low' | 'price_high' = 'popular'
  ): Promise<ApiResponse<SearchResponse>> => {
    const response = await apiClient.get<ApiResponse<SearchResponse>>(
      `${BASE_URL}/format/${format}`,
      {
        params: { page, limit, sort },
      }
    );
    return response.data;
  },

  /**
   * Get a specific tag by ID
   */
  getTagById: async (id: string): Promise<ApiResponse<Tag>> => {
    const response = await apiClient.get<ApiResponse<Tag>>(`${BASE_URL}/tags/${id}`);
    return response.data;
  },

  /**
   * Search for tags by name (for autocomplete)
   */
  searchTags: async (query: string, limit = 10): Promise<ApiResponse<Tag[]>> => {
    const response = await apiClient.get<ApiResponse<Tag[]>>(`${BASE_URL}/tags/search`, {
      params: { query, limit },
    });
    return response.data;
  },

  /**
   * Get suggested search terms (for autocomplete)
   */
  getSuggestedSearchTerms: async (query: string, limit = 5): Promise<ApiResponse<string[]>> => {
    const response = await apiClient.get<ApiResponse<string[]>>(`${BASE_URL}/suggestions`, {
      params: { query, limit },
    });
    return response.data;
  },
};
