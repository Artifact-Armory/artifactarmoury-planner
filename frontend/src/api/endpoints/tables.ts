import apiClient from '../client';
import { 
  ApiResponse, 
  TableLayout,
  TableLayoutCreateRequest,
  UploadResponse
} from '../types';

const BASE_URL = '/api/tables';

export const tablesApi = {
  /**
   * Get a table layout by ID
   */
  getTableById: async (id: string): Promise<ApiResponse<TableLayout>> => {
    const response = await apiClient.get<ApiResponse<TableLayout>>(`${BASE_URL}/${id}`);
    return response.data;
  },

  /**
   * Create a new table layout
   */
  createTable: async (data: TableLayoutCreateRequest): Promise<ApiResponse<TableLayout>> => {
    const response = await apiClient.post<ApiResponse<TableLayout>>(`${BASE_URL}`, data);
    return response.data;
  },

  /**
   * Update an existing table layout
   */
  updateTable: async (id: string, data: Partial<TableLayoutCreateRequest>): Promise<ApiResponse<TableLayout>> => {
    const response = await apiClient.put<ApiResponse<TableLayout>>(`${BASE_URL}/${id}`, data);
    return response.data;
  },

  /**
   * Delete a table layout
   */
  deleteTable: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/${id}`);
    return response.data;
  },

  /**
   * Get public table layouts with pagination
   */
  getPublicTables: async (
    page = 1, 
    limit = 20,
    sort: 'newest' | 'popular' = 'popular'
  ): Promise<ApiResponse<{
    tables: TableLayout[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      tables: TableLayout[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/public`, {
      params: { page, limit, sort }
    });
    return response.data;
  },

  /**
   * Get featured table layouts
   */
  getFeaturedTables: async (limit = 6): Promise<ApiResponse<TableLayout[]>> => {
    const response = await apiClient.get<ApiResponse<TableLayout[]>>(`${BASE_URL}/featured`, {
      params: { limit }
    });
    return response.data;
  },

  /**
   * Get the current user's table layouts
   */
  getMyTables: async (
    page = 1, 
    limit = 20
  ): Promise<ApiResponse<{
    tables: TableLayout[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      tables: TableLayout[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/my`, {
      params: { page, limit }
    });
    return response.data;
  },

  /**
   * Get a user's public table layouts
   */
  getUserTables: async (
    userId: string,
    page = 1, 
    limit = 20
  ): Promise<ApiResponse<{
    tables: TableLayout[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      tables: TableLayout[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/user/${userId}`, {
      params: { page, limit }
    });
    return response.data;
  },

  /**
   * Upload table layout thumbnail
   */
  uploadTableThumbnail: async (tableId: string, file: File): Promise<ApiResponse<UploadResponse>> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post<ApiResponse<UploadResponse>>(
      `${BASE_URL}/${tableId}/thumbnail`, 
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  },

  /**
   * Upload table layout preview image
   */
  uploadTablePreviewImage: async (tableId: string, file: File): Promise<ApiResponse<UploadResponse>> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post<ApiResponse<UploadResponse>>(
      `${BASE_URL}/${tableId}/preview-images`, 
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  },

  /**
   * Like a table layout
   */
  likeTable: async (tableId: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.post<ApiResponse<null>>(`${BASE_URL}/${tableId}/like`);
    return response.data;
  },

  /**
   * Unlike a table layout
   */
  unlikeTable: async (tableId: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/${tableId}/like`);
    return response.data;
  },

  /**
   * Check if user has liked a table layout
   */
  hasLikedTable: async (tableId: string): Promise<ApiResponse<{liked: boolean}>> => {
    const response = await apiClient.get<ApiResponse<{liked: boolean}>>(`${BASE_URL}/${tableId}/like`);
    return response.data;
  },

  /**
   * Clone a public table layout
   */
  cloneTable: async (tableId: string, name?: string): Promise<ApiResponse<TableLayout>> => {
    const response = await apiClient.post<ApiResponse<TableLayout>>(
      `${BASE_URL}/${tableId}/clone`, 
      { name }
    );
    return response.data;
  },

  /**
   * Export a table layout to various formats
   */
  exportTable: async (
    tableId: string, 
    format: 'obj' | 'fbx' | 'glb' | 'unity' | 'unreal'
  ): Promise<ApiResponse<{ exportUrl: string; expiresAt: number }>> => {
    const response = await apiClient.get<ApiResponse<{ exportUrl: string; expiresAt: number }>>(
      `${BASE_URL}/${tableId}/export`,
      {
        params: { format }
      }
    );
    return response.data;
  },
};
