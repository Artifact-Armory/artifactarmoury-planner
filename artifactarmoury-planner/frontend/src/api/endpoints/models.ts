import apiClient from '../client'
import {
  ApiResponse,
  TerrainModel,
  ModelUploadRequest,
  Review,
  CreateReviewRequest,
  UploadResponse,
  Pagination,
} from '../types'
import { mapModelRecord } from '../transformers'

interface CreateModelPayload {
  name: string
  description?: string
  category: string
  tags?: string[]
  basePrice: number
  license: string
  modelFile: File
  thumbnailFile?: File
}

interface CreateModelOptions {
  onUploadProgress?: (progress: number) => void
}

interface ArtistModelListResponse {
  models: TerrainModel[]
  pagination: Pagination
}

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
  createModel: async (payload: CreateModelPayload, options?: CreateModelOptions): Promise<any> => {
    const formData = new FormData()
    formData.append('name', payload.name)
    formData.append('category', payload.category)
    formData.append('basePrice', String(payload.basePrice))

    if (payload.description) {
      formData.append('description', payload.description)
    }

    if (payload.tags && payload.tags.length > 0) {
      formData.append('tags', payload.tags.join(','))
    }

    formData.append('license', payload.license)

    formData.append('model', payload.modelFile)

    if (payload.thumbnailFile) {
      formData.append('thumbnail', payload.thumbnailFile)
    }

    const response = await apiClient.post(`${BASE_URL}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
      onUploadProgress: (event) => {
        if (!options?.onUploadProgress) return
        const total = event.total ?? event.loaded
        if (total === 0) {
          options.onUploadProgress(0)
          return
        }
        const rawPercent = Math.round((event.loaded / total) * 100)
        const percent = rawPercent >= 100 ? 99 : Math.min(100, rawPercent)
        options.onUploadProgress(percent)
      },
    })

    if (options?.onUploadProgress) {
      options.onUploadProgress(100)
    }

    return response.data
  },

  /**
   * Update an existing terrain model (requires ownership or admin role)
   */
  updateModel: async (id: string, data: Partial<ModelUploadRequest>): Promise<ApiResponse<TerrainModel>> => {
    const payload: Record<string, unknown> = { ...data }

    if (data.basePrice !== undefined) {
      payload.base_price = data.basePrice
      delete payload.basePrice
    }

    if (data.tags !== undefined) {
      payload.tags = data.tags
    }

    const response = await apiClient.patch<ApiResponse<TerrainModel>>(`${BASE_URL}/${id}`, payload)
    return response.data
  },

  /**
   * Delete a terrain model (requires ownership or admin role)
   */
  deleteModel: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/${id}`)
    return response.data
  },

  uploadModelImages: async (modelId: string, files: File[]): Promise<any> => {
    if (!files || files.length === 0) {
      throw new Error('No images provided')
    }

    const formData = new FormData()
    files.forEach((file) => formData.append('images', file))

    const response = await apiClient.post(
      `${BASE_URL}/${modelId}/images`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000,
      }
    )

    return response.data
  },

  deleteModelImage: async (modelId: string, imageId: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/${modelId}/images/${imageId}`)
    return response.data
  },

  addToLibrary: async (modelId: string): Promise<ApiResponse<{ asset: unknown }>> => {
    const response = await apiClient.post<ApiResponse<{ asset: unknown }>>(`${BASE_URL}/${modelId}/library`)
    return response.data
  },

  /**
   * Fetch models owned by the authenticated artist
   */
  getMyModels: async (params: { status?: string; page?: number; limit?: number } = {}): Promise<ArtistModelListResponse> => {
    const response = await apiClient.get(`${BASE_URL}/my-models`, { params })
    const payload = response.data ?? {}
    const models = (payload.models ?? []).map((model: any) => mapModelRecord(model))
    const paginationRaw = payload.pagination ?? {}
    const limit = Number(paginationRaw.limit ?? params.limit ?? 20) || 20
    const totalItems = Number(paginationRaw.total ?? paginationRaw.totalItems ?? models.length)
    const page = Number(paginationRaw.page ?? params.page ?? 1)
    const totalPages = Number(paginationRaw.pages ?? paginationRaw.totalPages ?? Math.max(1, Math.ceil(totalItems / limit)))

    return {
      models,
      pagination: { page, limit, totalItems, totalPages },
    }
  },

  publishModel: async (id: string): Promise<ApiResponse<{ modelId: string }>> => {
    const response = await apiClient.post<ApiResponse<{ modelId: string }>>(`${BASE_URL}/${id}/publish`)
    return response.data
  },

  unpublishModel: async (id: string): Promise<ApiResponse<{ modelId: string }>> => {
    const response = await apiClient.post<ApiResponse<{ modelId: string }>>(`${BASE_URL}/${id}/unpublish`)
    return response.data
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
