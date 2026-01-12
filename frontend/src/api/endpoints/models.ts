import apiClient from '../client'
import { ApiResponse, TerrainModel, ModelUploadRequest, Review, CreateReviewRequest, UploadResponse, Pagination } from '../types'
import { mapModelRecord } from '../transformers'

const BASE_URL = '/api/models'

export const modelsApi = {
  /**
   * Get a specific model by ID
   */
  getModelById: async (id: string): Promise<TerrainModel> => {
    const response = await apiClient.get(`${BASE_URL}/${id}`)
    const payload = response.data?.model ?? response.data?.data ?? response.data
    return mapModelRecord(payload)
  },

  /**
   * Create a new terrain model (requires artist role)
   */
  createModel: async (data: ModelUploadRequest): Promise<ApiResponse<TerrainModel>> => {
    const response = await apiClient.post<ApiResponse<TerrainModel>>(`${BASE_URL}`, data);
    return response.data;
  },

  /**
   * Update an existing terrain model (requires ownership or admin role)
   */
  updateModel: async (id: string, data: Partial<ModelUploadRequest>): Promise<ApiResponse<TerrainModel>> => {
    const response = await apiClient.put<ApiResponse<TerrainModel>>(`${BASE_URL}/${id}`, data);
    return response.data;
  },

  /**
   * Delete a terrain model (requires ownership or admin role)
   */
  deleteModel: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/${id}`);
    return response.data;
  },

  /**
   * Get reviews for a specific model
   */
  getModelReviews: async (
    modelId: string, 
    page = 1, 
    limit = 20
  ): Promise<ApiResponse<{
    reviews: Review[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      reviews: Review[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/${modelId}/reviews`, {
      params: { page, limit }
    });
    return response.data;
  },

  /**
   * Create a review for a model (requires purchase)
   */
  createReview: async (data: CreateReviewRequest): Promise<ApiResponse<Review>> => {
    const response = await apiClient.post<ApiResponse<Review>>(`${BASE_URL}/${data.modelId}/reviews`, data);
    return response.data;
  },

  /**
   * Update a review (requires ownership)
   */
  updateReview: async (
    reviewId: string, 
    data: Partial<Pick<CreateReviewRequest, 'rating' | 'comment'>>
  ): Promise<ApiResponse<Review>> => {
    const response = await apiClient.put<ApiResponse<Review>>(`${BASE_URL}/reviews/${reviewId}`, data);
    return response.data;
  },

  /**
   * Delete a review (requires ownership or admin)
   */
  deleteReview: async (reviewId: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/reviews/${reviewId}`);
    return response.data;
  },

  /**
   * Upload model thumbnail image
   */
  uploadThumbnail: async (modelId: string, file: File): Promise<ApiResponse<UploadResponse>> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post<ApiResponse<UploadResponse>>(
      `${BASE_URL}/${modelId}/thumbnail`, 
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
   * Upload preview images
   */
  uploadPreviewImage: async (modelId: string, file: File): Promise<ApiResponse<UploadResponse>> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post<ApiResponse<UploadResponse>>(
      `${BASE_URL}/${modelId}/preview-images`, 
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
   * Upload model file
   */
  uploadModelFile: async (modelId: string, file: File): Promise<ApiResponse<UploadResponse>> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post<ApiResponse<UploadResponse>>(
      `${BASE_URL}/${modelId}/file`, 
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        // Increase timeout for large file uploads
        timeout: 300000, // 5 minutes
      }
    );
    return response.data;
  },

  /**
   * Get presigned download URL for a purchased model
   */
  getDownloadUrl: async (modelId: string): Promise<ApiResponse<{ downloadUrl: string; expiresAt: number }>> => {
    const response = await apiClient.get<ApiResponse<{ downloadUrl: string; expiresAt: number }>>(
      `${BASE_URL}/${modelId}/download`
    );
    return response.data;
  },

  /**
   * Get related models
   */
  getRelatedModels: async (modelId: string, limit = 6): Promise<TerrainModel[]> => {
    const response = await apiClient.get(`${BASE_URL}/${modelId}/related`, {
      params: { limit },
    })
    const related = response.data?.related ?? response.data?.models ?? []
    return related.map((model: any) => mapModelRecord(model))
  },

  /**
   * Get the authenticated artist's models
   */
  getMyModels: async (
    params: { status?: string; page?: number; limit?: number } = {},
  ): Promise<{ models: TerrainModel[]; pagination: Pagination | null }> => {
    const response = await apiClient.get(`${BASE_URL}/my-models`, { params })
    const payload = response.data ?? {}
    const models = (payload.models ?? []).map((model: any) => mapModelRecord(model))
    const paginationRaw = payload.pagination ?? null
    return {
      models,
      pagination: paginationRaw
        ? {
            page: Number(paginationRaw.page ?? params.page ?? 1),
            limit: Number(paginationRaw.limit ?? params.limit ?? models.length),
            totalItems: Number(paginationRaw.total ?? paginationRaw.totalItems ?? models.length),
            totalPages: Number(paginationRaw.pages ?? paginationRaw.totalPages ?? 1),
          }
        : null,
    }
  },

  publishModel: async (modelId: string): Promise<ApiResponse<{ modelId: string }>> => {
    const response = await apiClient.post<ApiResponse<{ modelId: string }>>(`${BASE_URL}/${modelId}/publish`)
    return response.data
  },

  unpublishModel: async (modelId: string): Promise<ApiResponse<{ modelId: string }>> => {
    const response = await apiClient.post<ApiResponse<{ modelId: string }>>(`${BASE_URL}/${modelId}/unpublish`)
    return response.data
  },

  addToLibrary: async (modelId: string): Promise<ApiResponse<{ asset: { id: string } }>> => {
    const response = await apiClient.post<ApiResponse<{ asset: { id: string } }>>(`${BASE_URL}/${modelId}/library`)
    return response.data
  },

  /**
   * Add a model to user's wishlist
   */
  addToWishlist: async (modelId: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.post<ApiResponse<null>>(`${BASE_URL}/${modelId}/wishlist`);
    return response.data;
  },

  /**
   * Remove a model from user's wishlist
   */
  removeFromWishlist: async (modelId: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/${modelId}/wishlist`);
    return response.data;
  },

  /**
   * Get user's wishlist
   */
  getWishlist: async (
    page = 1,
    limit = 20,
  ): Promise<{ models: TerrainModel[]; pagination: Pagination | null }> => {
    const response = await apiClient.get(`${BASE_URL}/wishlist`, {
      params: { page, limit },
    })
    const payload = response.data ?? {}
    const models = (payload.models ?? payload.data?.models ?? []).map((model: any) => mapModelRecord(model))
    const paginationRaw = payload.pagination ?? payload.data?.pagination ?? null
    return {
      models,
      pagination: paginationRaw
        ? {
            page: Number(paginationRaw.page ?? page),
            limit: Number(paginationRaw.limit ?? limit),
            totalItems: Number(paginationRaw.total ?? paginationRaw.totalItems ?? models.length),
            totalPages: Number(paginationRaw.totalPages ?? paginationRaw.pages ?? 1),
          }
        : null,
    }
  },

  /**
   * Check if a model is in user's wishlist
   */
  isInWishlist: async (modelId: string): Promise<ApiResponse<{isWishlisted: boolean}>> => {
    const response = await apiClient.get<ApiResponse<{isWishlisted: boolean}>>(`${BASE_URL}/${modelId}/wishlist`);
    return response.data;
  }
};
