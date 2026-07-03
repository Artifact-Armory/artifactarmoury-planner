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
   * Create a model from a file already uploaded directly to R2 (presigned).
   * The API processes it in the background; poll getProcessingStatus for progress.
   */
  createFromUpload: async (data: {
    rawKey: string
    filename: string
    name: string
    description?: string
    category: string
    tags?: string
    basePrice: number
    fulfillmentType: 'stl' | 'print'
    thumbnailKey?: string
  }): Promise<{ id: string; name: string; status: string; processingStatus: string; createdAt: string }> => {
    const response = await apiClient.post(`${BASE_URL}/from-upload`, data);
    return response.data.model;
  },

  /**
   * Poll the background-processing state of a model the caller owns.
   */
  getProcessingStatus: async (
    id: string,
  ): Promise<{ processingStatus: string; processingError: string | null; status: string }> => {
    const response = await apiClient.get(`${BASE_URL}/${id}`);
    const m = response.data?.model ?? response.data;
    return {
      processingStatus: m.processing_status ?? m.processingStatus ?? 'ready',
      processingError: m.processing_error ?? m.processingError ?? null,
      status: m.status,
    };
  },

  /**
   * List the signed-in artist's own models (all statuses, incl. drafts and
   * still-processing/failed ones — unlike the public catalogue).
   */
  getMyModels: async (
    params: { status?: string; page?: number; limit?: number } = {},
  ): Promise<{ models: TerrainModel[]; pagination: Pagination }> => {
    const response = await apiClient.get(`${BASE_URL}/my-models`, { params });
    const payload = response.data ?? {};
    const models = (payload.models ?? []).map((m: any) => mapModelRecord(m));
    const p = payload.pagination ?? {};
    return {
      models,
      pagination: {
        page: Number(p.page ?? params.page ?? 1),
        limit: Number(p.limit ?? params.limit ?? models.length),
        totalItems: Number(p.total ?? p.totalItems ?? models.length),
        totalPages: Number(p.pages ?? p.totalPages ?? 1),
      },
    };
  },

  /**
   * Update an existing terrain model (requires ownership or admin role).
   * The API route is PATCH and reads snake_case fields, so map from camelCase.
   */
  updateModel: async (
    id: string,
    data: Partial<Pick<ModelUploadRequest, 'name' | 'description' | 'category' | 'tags' | 'basePrice'>>,
  ): Promise<{ id: string; name: string }> => {
    const body: Record<string, unknown> = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.description !== undefined) body.description = data.description;
    if (data.category !== undefined) body.category = data.category;
    if (data.tags !== undefined) body.tags = data.tags;
    if (data.basePrice !== undefined) body.base_price = data.basePrice;
    const response = await apiClient.patch(`${BASE_URL}/${id}`, body);
    return response.data?.model ?? response.data;
  },

  /**
   * Publish a draft model so it appears in the marketplace. The API enforces a
   * thumbnail and a >=20-char description and returns a 400 if either is missing.
   */
  publishModel: async (id: string): Promise<{ modelId: string }> => {
    const response = await apiClient.post(`${BASE_URL}/${id}/publish`);
    return response.data;
  },

  /** Take a published model back off the marketplace (revert to draft). */
  unpublishModel: async (id: string): Promise<{ modelId: string }> => {
    const response = await apiClient.post(`${BASE_URL}/${id}/unpublish`);
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
   * Download a purchased model's STL. The file is watermarked per-buyer and
   * streamed through the API (it can't be a plain CDN link), so we fetch it as a
   * blob with the auth header and trigger a browser save.
   */
  downloadModelStl: async (modelId: string, fallbackName = 'model'): Promise<void> => {
    const response = await apiClient.get(`${BASE_URL}/${modelId}/download`, {
      responseType: 'blob',
      timeout: 600000, // large STLs can take a while
    });
    // Prefer the server-provided filename from Content-Disposition.
    const cd = String(response.headers?.['content-disposition'] ?? '');
    const match = cd.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `${fallbackName.replace(/[^a-z0-9._-]+/gi, '_')}.stl`;

    const url = window.URL.createObjectURL(response.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
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
