import apiClient from '../client'

const BASE_URL = '/api/admin/geometry-reviews'

export type GeometryReviewStatus = 'open' | 'cleared' | 'taken_down'

/** One side of a review pair, flattened by the backend as `<prefix>_<field>`. */
export interface ReviewModelSide {
  id: string
  name: string
  thumbnail_path: string | null
  status: string
  processing_status: string
  width: number | string | null
  depth: number | string | null
  height: number | string | null
  part_count: number
  created_at: string
  artist_id: string
  artist_name: string
}

export interface GeometryReview {
  id: string
  score: number
  distances: Record<string, number> | null
  fileLabel: string | null
  status: GeometryReviewStatus
  resolutionNote: string | null
  resolvedAt: string | null
  resolvedByName: string | null
  createdAt: string
  upload: ReviewModelSide
  matched: ReviewModelSide
}

function side(row: any, prefix: 'upload' | 'matched'): ReviewModelSide {
  const get = (k: string) => row[`${prefix}_${k}`]
  return {
    id: get('id'), name: get('name'), thumbnail_path: get('thumbnail_path'), status: get('status'),
    processing_status: get('processing_status'), width: get('width'), depth: get('depth'),
    height: get('height'), part_count: Number(get('part_count') ?? 1), created_at: get('created_at'),
    artist_id: get('artist_id'), artist_name: get('artist_name'),
  }
}

export const adminGeometryReviewsApi = {
  async list(status: GeometryReviewStatus): Promise<{ reviews: GeometryReview[]; openCount: number }> {
    const res = await apiClient.get(BASE_URL, { params: { status } })
    return {
      openCount: Number(res.data.openCount ?? 0),
      reviews: (res.data.reviews ?? []).map((r: any) => ({
        id: r.id,
        score: Number(r.score),
        distances: r.distances ?? null,
        fileLabel: r.file_label ?? null,
        status: r.status,
        resolutionNote: r.resolution_note ?? null,
        resolvedAt: r.resolved_at ?? null,
        resolvedByName: r.resolved_by_name ?? null,
        createdAt: r.created_at,
        upload: side(r, 'upload'),
        matched: side(r, 'matched'),
      })),
    }
  },

  async decide(id: string, action: 'clear' | 'take_down', note?: string): Promise<{ notes: string[] }> {
    const res = await apiClient.patch(`${BASE_URL}/${id}`, { action, note })
    return res.data
  },
}
