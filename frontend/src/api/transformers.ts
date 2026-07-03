import { ApiUser, ArtistDetail, ArtistSummary, TerrainModel, User } from './types'

// Heavy assets (GLB/thumbnails) load from the R2/Cloudflare CDN when configured,
// otherwise from the app's /uploads. Absolute URLs from the API pass through.
const ASSET_BASE = (import.meta.env.VITE_ASSET_BASE_URL || '').replace(/\/$/, '')
const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')

export const assetUrl = (p?: string | null): string | undefined => {
  if (!p) return undefined
  if (/^https?:\/\//.test(p)) return p
  const key = p.replace(/^\/+/, '')
  return ASSET_BASE ? `${ASSET_BASE}/${key}` : `${API_BASE}/uploads/${key}`
}

export const mapApiUserToUser = (user: ApiUser): User => ({
  ...user,
  name: user.displayName,
  verified: user.accountStatus !== 'suspended' && user.accountStatus !== 'banned',
})

export const mapModelRecord = (model: any): TerrainModel => ({
  id: model.id,
  name: model.name,
  description: model.description,
  category: model.category,
  tags: Array.isArray(model.tags) ? model.tags : [],
  basePrice: Number(model.base_price ?? model.basePrice ?? 0),
  fulfillmentType: (model.fulfillment_type ?? model.fulfillmentType ?? 'print') as 'stl' | 'print',
  thumbnailUrl: model.thumbnail_url || model.thumbnailUrl || assetUrl(model.thumbnail_path),
  glbUrl: model.glb_url || model.glbUrl || assetUrl(model.glb_file_path),
  previewImages: model.preview_images || model.previewImages || undefined,
  artistName: model.artist_name || model.artistName || 'Unknown Artist',
  artistUrl: model.artist_url || model.artistUrl,
  artistId: model.artist_id || model.artistId,
  artistBio: model.artist_bio || model.artistBio,
  width: model.width ?? undefined,
  height: model.height ?? undefined,
  depth: model.depth ?? undefined,
  viewCount: model.view_count ?? model.viewCount ?? undefined,
  saleCount: model.sale_count ?? model.saleCount ?? undefined,
  reviewCount:
    (model.review_count ?? model.reviewCount) != null
      ? Number(model.review_count ?? model.reviewCount)
      : undefined,
  // Postgres returns AVG()/NUMERIC as a string — coerce or .toFixed() blows up.
  averageRating:
    (model.average_rating ?? model.averageRating) != null
      ? Number(model.average_rating ?? model.averageRating)
      : undefined,
  isFavorited: model.is_favorited ?? model.isFavorited ?? false,
  status: model.status ?? undefined,
  visibility: model.visibility ?? undefined,
  processingStatus: model.processing_status ?? model.processingStatus ?? undefined,
  processingError: model.processing_error ?? model.processingError ?? null,
  downloadCount: model.download_count ?? model.downloadCount ?? undefined,
  publishedAt: model.published_at ?? model.publishedAt,
  createdAt: model.created_at ?? model.createdAt,
  updatedAt: model.updated_at ?? model.updatedAt,
  images: model.images?.map((image: any) => ({
    id: image.id,
    imagePath: image.image_path ?? image.imagePath,
    imageUrl: image.image_url ?? image.imageUrl ?? image.image_path,
    caption: image.caption,
    displayOrder: image.display_order ?? image.displayOrder,
  })),
  recentReviews: model.recentReviews?.map((review: any) => ({
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    title: review.title,
    reviewerName: review.reviewer_name ?? review.reviewerName,
    createdAt: review.created_at ?? review.createdAt,
  })),
})

export const mapArtistSummary = (artist: any): ArtistSummary => ({
  id: artist.id,
  name: artist.name,
  bio: artist.bio,
  profileImageUrl:
    artist.profileImageUrl || artist.profile_image_url || artist.profileImage || undefined,
  bannerImageUrl: artist.bannerImageUrl || artist.banner_image_url || artist.bannerImage || undefined,
  totalModels: Number(artist.totalModels ?? artist.model_count ?? artist.total_models ?? 0) || undefined,
  totalSales: artist.totalSales ?? artist.total_purchases ?? undefined,
  totalViews: artist.totalViews ?? artist.total_views ?? undefined,
  rating: artist.rating ?? undefined,
  createdAt: artist.created_at ?? artist.createdAt,
})

export const mapArtistDetail = (artist: any): ArtistDetail => ({
  ...mapArtistSummary(artist),
  totalPurchases: artist.total_purchases ?? artist.totalPurchases ?? undefined,
})
