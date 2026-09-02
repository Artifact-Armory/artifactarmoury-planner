import apiClient from '../client'
import { ApiResponse, TerrainModel, ModelUploadRequest, Review, CreateReviewRequest, Pagination } from '../types'
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
    /** Buyer usage licence: 'personal' (own use) | 'commercial' (may sell prints). */
    license?: 'personal' | 'commercial'
    /** Printer authoring target: 'fdm' | 'resin' | 'both'. */
    printerType?: 'fdm' | 'resin' | 'both'
    thumbnailKey?: string
    /**
     * Name of the component the primary file belongs to, when the listing groups
     * its files into several named models (e.g. "Small Village" → "Village Tower").
     * Omit for an ungrouped model/set.
     */
    primaryGroupName?: string
    /**
     * Whether this model may be placed on the 3D planner at all. Defaults to true —
     * set false for a misc item (paint brush holder, display base, …) that isn't
     * placeable scenery. Doesn't affect the normal marketplace listing/sale.
     */
    showInPlanner?: boolean
    /**
     * Set when the print file (rawKey) already has supports built in. When true,
     * displayRawKey is required — a separate support-free STL used ONLY to build
     * the marketplace/planner previews. The print file itself is unaffected and
     * is still exactly what buyers download.
     */
    isPresupported?: boolean
    /** The clean preview file's raw/ key — required when isPresupported is true. */
    displayRawKey?: string
    /** The clean preview file's original filename (drives its format detection). */
    displayFilename?: string
    /**
     * Extra STL parts for a multi-part "set" model (primary is the main rawKey).
     * `groupIndex`/`groupName` place a part inside a named component — group 0 is
     * the primary file's component, 1..N are the ones added after it.
     */
    parts?: Array<{
      rawKey: string
      filename?: string
      name?: string
      groupIndex?: number
      groupName?: string
      /**
       * Per-component clean preview (only meaningful on a component's first/
       * primary part — see isPresupported above, same idea one level down).
       */
      isPresupported?: boolean
      /** The clean preview file's raw/ key — required when isPresupported is true. */
      displayRawKey?: string
    }>
    /** Taxonomy tags as `facetSlug:termPath` tokens. */
    terms?: string[]
  }): Promise<{ id: string; name: string; status: string; processingStatus: string; createdAt: string }> => {
    const response = await apiClient.post(`${BASE_URL}/from-upload`, data, { timeout: 60_000 });
    return response.data.model;
  },

  /**
   * Replace a model's primary file with a new version. Owners re-download the new
   * version for free and are notified. Processes in the background — poll
   * getProcessingStatus. `rawKey` is a file already uploaded to R2 (presign, `raw/`).
   */
  uploadNewVersion: async (
    id: string,
    data: { rawKey: string; filename: string; notes?: string },
  ): Promise<{ modelId: string; processingStatus: string }> => {
    const response = await apiClient.post(`${BASE_URL}/${id}/new-version`, data, { timeout: 60_000 })
    return response.data
  },

  /**
   * Published multi-part ("set") models with their parts — for the planner, where
   * each part is an individually placeable asset grouped under the set.
   */
  getSets: async (): Promise<Array<{
    id: string
    name: string
    price: number
    thumbnailPath: string | null
    artistId: string
    defaultPitchDeg: number
    primaryGroupName: string | null
    parts: Array<{
      id: string; name: string; isPrimary: boolean; hasGlb: boolean
      width: number | null; depth: number | null; height: number | null
      groupIndex: number; groupName: string | null
    }>
  }>> => {
    const response = await apiClient.get(`${BASE_URL}/sets`)
    return (response.data?.sets ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      price: Number(s.price ?? 0),
      thumbnailPath: s.thumbnail_path ?? null,
      artistId: s.artist_id,
      defaultPitchDeg: Number(s.default_pitch_deg ?? 0),
      primaryGroupName: s.primary_group_name ?? null,
      parts: (s.parts ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        isPrimary: Boolean(p.is_primary),
        hasGlb: Boolean(p.has_glb),
        groupIndex: Number(p.group_index ?? 0),
        groupName: p.group_name ?? null,
        width: p.width != null ? Number(p.width) : null,
        depth: p.depth != null ? Number(p.depth) : null,
        height: p.height != null ? Number(p.height) : null,
      })),
    }))
  },

  /**
   * The signed-in artist's own placeable models (incl. drafts) for the planner
   * palette, so they can lay out unpublished pieces on a table.
   */
  getMyPlannerModels: async (): Promise<TerrainModel[]> => {
    const response = await apiClient.get(`${BASE_URL}/mine/planner`)
    return (response.data?.models ?? []).map((m: any) => ({ ...mapModelRecord(m), status: m.status }))
  },

  /**
   * Resolve arbitrary models by id (publish-agnostic) so a table renders fully
   * even when it references an unpublished piece.
   */
  resolvePlannerAssets: async (ids: string[]): Promise<TerrainModel[]> => {
    if (!ids.length) return []
    const response = await apiClient.get(`${BASE_URL}/planner-assets`, { params: { ids: ids.join(',') } })
    return (response.data?.models ?? []).map((m: any) => mapModelRecord(m))
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
   * Ask the outsourced print provider for a print quote and compute the
   * customer-facing print price (provider cost + artist fee + £1 site fee).
   * Requires model ownership; the result is also persisted on the model.
   */
  getPrintQuote: async (
    id: string,
    /** Pass true the first time to record the artist's consent to third-party manufacturing. */
    consent?: boolean,
  ): Promise<{
    providerCost: number
    artistFee: number
    siteFee: number
    total: number
    currency: string
    provider: string
    estimatedDays?: number
  }> => {
    const response = await apiClient.post(`${BASE_URL}/${id}/print-quote`, consent ? { consent: true } : {})
    return response.data?.quote ?? response.data
  },

  /**
   * Update an existing terrain model (requires ownership or admin role).
   * The API route is PATCH and reads snake_case fields, so map from camelCase.
   */
  updateModel: async (
    id: string,
    data: Partial<Pick<ModelUploadRequest, 'name' | 'description' | 'category' | 'tags' | 'basePrice'>> & {
      /** Taxonomy tags as `facetSlug:termPath` tokens (replaces the full set). */
      terms?: string[]
      /** R2 key of a thumbnail already uploaded via the presign flow (`thumbnails/…`). */
      thumbnailKey?: string
      /** Buyer usage licence: 'personal' | 'commercial'. */
      license?: 'personal' | 'commercial'
      /** Printer authoring target: 'fdm' | 'resin' | 'both' | '' (clears it). */
      printerType?: 'fdm' | 'resin' | 'both' | ''
      /** Printability metadata. */
      supportsRequired?: boolean
      recommendedLayerHeight?: number | null
      recommendedInfill?: number | null
      /** Default planner tilt (pitch about X, degrees) so the model stands upright. */
      defaultPitchDeg?: number
      /** Whether this model may be placed on the 3D planner at all (artist opt-out). */
      showInPlanner?: boolean
    },
  ): Promise<{ id: string; name: string }> => {
    const body: Record<string, unknown> = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.description !== undefined) body.description = data.description;
    if (data.category !== undefined) body.category = data.category;
    if (data.tags !== undefined) body.tags = data.tags;
    if (data.basePrice !== undefined) body.base_price = data.basePrice;
    if (data.terms !== undefined) body.terms = data.terms;
    if (data.thumbnailKey !== undefined) body.thumbnailKey = data.thumbnailKey;
    if (data.license !== undefined) body.license = data.license;
    if (data.printerType !== undefined) body.printer_type = data.printerType;
    if (data.supportsRequired !== undefined) body.supports_required = data.supportsRequired;
    if (data.recommendedLayerHeight !== undefined) body.recommended_layer_height = data.recommendedLayerHeight;
    if (data.recommendedInfill !== undefined) body.recommended_infill = data.recommendedInfill;
    if (data.defaultPitchDeg !== undefined) body.default_pitch_deg = data.defaultPitchDeg;
    if (data.showInPlanner !== undefined) body.show_in_planner = data.showInPlanner;
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
   * Download a purchased model's STL. The file is watermarked per-buyer and
   * streamed through the API (it can't be a plain CDN link), so we fetch it as a
   * blob with the auth header and trigger a browser save.
   */
  downloadModelStl: async (modelId: string, fallbackName = 'model'): Promise<void> => {
    const response = await apiClient.get(`${BASE_URL}/${modelId}/download`, {
      responseType: 'blob',
      timeout: 600000, // large STLs can take a while
    });
    // Prefer the server-provided filename from Content-Disposition (requires the
    // backend to list it in CORS exposedHeaders — see middleware/security.ts —
    // otherwise the browser hides this header on a cross-origin response and we
    // fall through to a guessed name below).
    const cd = String(response.headers?.['content-disposition'] ?? '');
    const match = cd.match(/filename="?([^"]+)"?/i);
    // Fall back to the content-type to pick the right extension: a multi-part
    // model downloads as a ZIP, and naming it "model.stl" makes a correctly
    // downloaded archive look like a single broken STL to the buyer.
    const contentType = String(response.headers?.['content-type'] ?? '');
    const guessedExt = contentType.includes('zip') ? 'zip' : 'stl';
    const filename = match?.[1] || `${fallbackName.replace(/[^a-z0-9._-]+/gi, '_')}.${guessedExt}`;

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
   * Public planner tables that feature this model ("shop the look").
   */
  getModelTables: async (
    modelId: string,
    limit = 12,
  ): Promise<Array<{ id: string; name: string; modelCount: number; viewCount: number }>> => {
    const response = await apiClient.get(`${BASE_URL}/${modelId}/tables`, { params: { limit } })
    return (response.data?.tables ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      modelCount: Number(t.model_count ?? 0),
      viewCount: Number(t.view_count ?? 0),
    }))
  },

  /**
   * Get related models
   */
  getRelatedModels: async (modelId: string, limit = 6): Promise<TerrainModel[]> => {
    // The related-models route lives under /api/browse, not /api/models.
    const response = await apiClient.get(`/api/browse/${modelId}/related`, {
      params: { limit },
    })
    const related = response.data?.related ?? response.data?.models ?? []
    return related.map((model: any) => mapModelRecord(model))
  },

  /**
   * Like (favorite) a model — returns the updated like count.
   */
  likeModel: async (modelId: string): Promise<{ favorited: boolean; favoriteCount: number }> => {
    const response = await apiClient.post(`${BASE_URL}/${modelId}/favorite`)
    return response.data
  },

  /**
   * Remove a like (unfavorite) — returns the updated like count.
   */
  unlikeModel: async (modelId: string): Promise<{ favorited: boolean; favoriteCount: number }> => {
    const response = await apiClient.delete(`${BASE_URL}/${modelId}/favorite`)
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
