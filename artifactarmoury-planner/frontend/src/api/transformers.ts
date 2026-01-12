import {
  ApiUser,
  ArtistAnalytics,
  ArtistDetail,
  ArtistSummary,
  TerrainModel,
  User,
} from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

const toUploadUrl = (path?: string | null): string | undefined => {
  if (!path) return undefined
  if (/^https?:\/\//i.test(path)) return path

  const normalized = path.replace(/^\/+/, '').replace(/^uploads\//i, '')
  const urlPath = `/uploads/${normalized}`

  if (apiBase) {
    return `${apiBase}${urlPath}`
  }

  return urlPath
}

export const mapApiUserToUser = (user: ApiUser): User => ({
  ...user,
  name: user.displayName,
  verified: user.accountStatus !== 'suspended' && user.accountStatus !== 'banned',
  creatorVerified: Boolean(user.creatorVerified),
  verificationBadge: user.verificationBadge ?? null,
})

export const mapModelRecord = (model: any): TerrainModel => ({
  id: model.id,
  name: model.name,
  description: model.description,
  category: model.category,
  tags: Array.isArray(model.tags) ? model.tags : [],
  basePrice: Number(model.base_price ?? model.basePrice ?? 0),
  license: model.license || model.model_license || 'standard-commercial',
  thumbnailUrl: toUploadUrl(model.thumbnail_url || model.thumbnailUrl || model.thumbnail_path),
  previewImages: model.preview_images || model.previewImages || undefined,
  artistName: model.artist_name || model.artistName || 'Unknown Artist',
  artistUrl: model.artist_url || model.artistUrl,
  artistId: model.artist_id || model.artistId,
  artistBio: model.artist_bio || model.artistBio,
  creatorVerified: Boolean(model.creator_verified ?? model.creatorVerified ?? false),
  verificationBadge: model.verification_badge ?? model.verificationBadge ?? null,
  width: model.width ?? undefined,
  height: model.height ?? undefined,
  depth: model.depth ?? undefined,
  viewCount: model.view_count ?? model.viewCount ?? undefined,
  saleCount: model.sale_count ?? model.saleCount ?? undefined,
  reviewCount: model.review_count ?? model.reviewCount ?? undefined,
  averageRating: model.average_rating ?? model.averageRating ?? undefined,
  isFavorited: model.is_favorited ?? model.isFavorited ?? false,
  inLibrary: Boolean(model.in_library ?? model.inLibrary ?? false),
  status: model.status ?? undefined,
  visibility: model.visibility ?? undefined,
  downloadCount: model.download_count ?? model.downloadCount ?? undefined,
  publishedAt: model.published_at ?? model.publishedAt,
  createdAt: model.created_at ?? model.createdAt,
  updatedAt: model.updated_at ?? model.updatedAt,
  assetId: model.asset_id ?? model.assetId ?? undefined,
  images: model.images?.map((image: any) => ({
    id: image.id,
    imagePath: image.image_path ?? image.imagePath,
    imageUrl: toUploadUrl(image.image_url ?? image.imageUrl ?? image.image_path),
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
  creatorVerified: Boolean(artist.creator_verified ?? artist.creatorVerified ?? false),
  verificationBadge: artist.verification_badge ?? artist.verificationBadge ?? null,
})

export const mapArtistDetail = (artist: any): ArtistDetail => ({
  ...mapArtistSummary(artist),
  totalPurchases: artist.total_purchases ?? artist.totalPurchases ?? undefined,
})

export const mapArtistAnalytics = (payload: any): ArtistAnalytics => ({
  totalModels: Number(payload.total_models ?? payload.totalModels ?? 0),
  publishedModels: Number(payload.published_models ?? payload.publishedModels ?? 0),
  totalViews: Number(payload.total_views ?? payload.totalViews ?? 0),
  totalPurchases: Number(payload.total_purchases ?? payload.totalPurchases ?? 0),
  totalRevenue: Number(payload.total_revenue ?? payload.totalRevenue ?? 0),
  pendingPayout: Number(payload.pending_payout ?? payload.pendingPayout ?? 0),
  recentOrders: (payload.recent_orders ?? payload.recentOrders ?? []).map((order: any) => ({
    id: order.id,
    orderNumber: order.order_number ?? order.orderNumber ?? '',
    customerEmail: order.customer_email ?? order.customerEmail ?? '',
    total: Number(order.total ?? 0),
    paymentStatus: order.payment_status ?? order.paymentStatus ?? '',
    fulfillmentStatus: order.fulfillment_status ?? order.fulfillmentStatus ?? '',
    createdAt: order.created_at ?? order.createdAt ?? '',
  })),
  topModels: (payload.top_models ?? payload.topModels ?? []).map((model: any) => ({
    id: model.id,
    name: model.name,
    basePrice: Number(model.base_price ?? model.basePrice ?? 0),
    viewCount: Number(model.view_count ?? model.viewCount ?? 0),
    saleCount: Number(model.sale_count ?? model.saleCount ?? 0),
    revenue: Number(model.revenue ?? 0),
  })),
})
