import { ApiUser, ArtistDetail, ArtistSummary, TerrainModel, User } from './types'

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
})

export const mapModelRecord = (model: any): TerrainModel => ({
  id: model.id,
  name: model.name,
  description: model.description,
  category: model.category,
  tags: Array.isArray(model.tags) ? model.tags : [],
  basePrice: Number(model.base_price ?? model.basePrice ?? 0),
  license: model.license || model.model_license || undefined,
  status: model.status || model.model_status || undefined,
  visibility: model.visibility || model.model_visibility || undefined,
  inLibrary: Boolean(model.in_library ?? model.inLibrary ?? false),
  thumbnailUrl: toUploadUrl(model.thumbnail_url || model.thumbnailUrl || model.thumbnail_path),
  glbUrl: toUploadUrl(model.glb_url || model.glbUrl || model.glb_file_path),
  previewImages: (() => {
    const raw = model.preview_images || model.previewImages || []
    const images = (Array.isArray(raw) ? raw : [raw])
      .map((img: any) =>
        typeof img === 'string'
          ? toUploadUrl(img)
          : toUploadUrl(img?.image_url ?? img?.imageUrl ?? img?.image_path),
      )
      .filter(Boolean) as string[]
    return images.length ? images : undefined
  })(),
  artistName: model.artist_name || model.artistName || 'Unknown Artist',
  artistUrl: model.artist_url || model.artistUrl,
  artistId: model.artist_id || model.artistId,
  artistBio: model.artist_bio || model.artistBio,
  width: model.width ?? undefined,
  height: model.height ?? undefined,
  depth: model.depth ?? undefined,
  viewCount: model.view_count ?? model.viewCount ?? undefined,
  saleCount: model.sale_count ?? model.saleCount ?? undefined,
  reviewCount: model.review_count ?? model.reviewCount ?? undefined,
  averageRating: model.average_rating ?? model.averageRating ?? undefined,
  isFavorited: model.is_favorited ?? model.isFavorited ?? false,
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
