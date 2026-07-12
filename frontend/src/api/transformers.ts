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
  fulfillmentType: (model.fulfillment_type ?? model.fulfillmentType ?? 'stl') as 'stl' | 'print',
  license: (model.license ?? 'personal') as 'personal' | 'commercial',
  printerType: (model.printer_type ?? model.printerType ?? null) as 'fdm' | 'resin' | 'both' | null,
  supportsRequired: model.supports_required ?? model.supportsRequired ?? undefined,
  recommendedLayerHeight:
    (model.recommended_layer_height ?? model.recommendedLayerHeight) != null
      ? Number(model.recommended_layer_height ?? model.recommendedLayerHeight)
      : undefined,
  recommendedInfill:
    (model.recommended_infill ?? model.recommendedInfill) != null
      ? Number(model.recommended_infill ?? model.recommendedInfill)
      : undefined,
  meshAnalyzed: model.mesh_analyzed ?? model.meshAnalyzed ?? undefined,
  meshIsWatertight: model.mesh_is_watertight ?? model.meshIsWatertight ?? null,
  meshIsManifold: model.mesh_is_manifold ?? model.meshIsManifold ?? null,
  meshTriangleCount:
    (model.mesh_triangle_count ?? model.meshTriangleCount) != null
      ? Number(model.mesh_triangle_count ?? model.meshTriangleCount)
      : undefined,
  meshOpenEdges:
    (model.mesh_open_edges ?? model.meshOpenEdges) != null
      ? Number(model.mesh_open_edges ?? model.meshOpenEdges)
      : undefined,
  fileVersion:
    (model.file_version ?? model.fileVersion) != null
      ? Number(model.file_version ?? model.fileVersion)
      : undefined,
  versionNotes: model.version_notes ?? model.versionNotes ?? null,
  filesUpdatedAt: model.files_updated_at ?? model.filesUpdatedAt ?? null,
  versions: Array.isArray(model.versions)
    ? model.versions.map((v: any) => ({
        version: Number(v.version),
        notes: v.notes ?? null,
        createdAt: v.created_at ?? v.createdAt,
      }))
    : undefined,
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
  favoriteCount:
    (model.favorite_count ?? model.favoriteCount) != null
      ? Number(model.favorite_count ?? model.favoriteCount)
      : undefined,
  status: model.status ?? undefined,
  visibility: model.visibility ?? undefined,
  processingStatus: model.processing_status ?? model.processingStatus ?? undefined,
  processingError: model.processing_error ?? model.processingError ?? null,
  downloadCount: model.download_count ?? model.downloadCount ?? undefined,
  // Print-on-demand quote (NUMERIC columns come back as strings — coerce).
  printProviderCost:
    (model.print_provider_cost ?? model.printProviderCost) != null
      ? Number(model.print_provider_cost ?? model.printProviderCost)
      : undefined,
  printPrice:
    (model.print_price ?? model.printPrice) != null
      ? Number(model.print_price ?? model.printPrice)
      : undefined,
  printProvider: model.print_provider ?? model.printProvider ?? undefined,
  printQuotedAt: model.print_quoted_at ?? model.printQuotedAt ?? undefined,
  printConsent: model.print_consent ?? model.printConsent ?? undefined,
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
  // Multi-part ("set") models: number of STL files + the extra parts.
  partCount: Number(model.part_count ?? model.partCount ?? 1),
  parts: model.parts?.map((p: any) => ({
    id: p.id,
    name: p.name,
    thumbnailUrl: p.thumbnail_url || p.thumbnailUrl || assetUrl(p.thumbnail_path),
    glbUrl: p.glb_url || p.glbUrl || assetUrl(p.glb_file_path),
    width: p.width ?? undefined,
    depth: p.depth ?? undefined,
    height: p.height ?? undefined,
    processingStatus: p.processing_status ?? p.processingStatus ?? undefined,
  })),
  featuredInTables:
    (model.featuredInTables ?? model.featured_in_tables) != null
      ? Number(model.featuredInTables ?? model.featured_in_tables)
      : undefined,
  // Faceted taxonomy tags (from GET /api/models/:id).
  taxonomyTerms: Array.isArray(model.taxonomyTerms)
    ? model.taxonomyTerms.map((t: any) => ({
        facetSlug: t.facetSlug ?? t.facet_slug,
        facetName: t.facetName ?? t.facet_name,
        termId: t.termId ?? t.term_id,
        path: t.path,
        name: t.name,
      }))
    : undefined,
})

export const mapArtistSummary = (artist: any): ArtistSummary => ({
  id: artist.id,
  name: artist.name,
  bio: artist.bio,
  profileImageUrl:
    assetUrl(artist.profileImageUrl || artist.profile_image_url || artist.profileImage) || undefined,
  bannerImageUrl:
    assetUrl(artist.bannerImageUrl || artist.banner_image_url || artist.bannerImage) || undefined,
  artistUrl: artist.artistUrl || artist.artist_url || undefined,
  totalModels: Number(artist.totalModels ?? artist.model_count ?? artist.total_models ?? 0) || undefined,
  totalSales: artist.totalSales ?? artist.total_purchases ?? undefined,
  totalViews: artist.totalViews ?? artist.total_views ?? undefined,
  followerCount:
    (artist.followerCount ?? artist.follower_count) != null
      ? Number(artist.followerCount ?? artist.follower_count)
      : undefined,
  isFollowing: artist.isFollowing ?? artist.is_following ?? undefined,
  rating: artist.rating ?? undefined,
  createdAt: artist.created_at ?? artist.createdAt,
})

export const mapArtistDetail = (artist: any): ArtistDetail => ({
  ...mapArtistSummary(artist),
  totalPurchases: artist.total_purchases ?? artist.totalPurchases ?? undefined,
})
