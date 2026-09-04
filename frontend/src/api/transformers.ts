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

// Preview GLBs are served through a signed, expiring redirect (never a permanent
// public CDN key) so the low-poly mesh can't be hotlinked or bulk-scraped. Keyed by
// model id (primary part) or model_parts id (extra "set" parts).
export const previewGlbUrl = (modelId: string): string =>
  `${API_BASE}/api/models/${modelId}/preview.glb`
export const previewPartGlbUrl = (partId: string): string =>
  `${API_BASE}/api/models/parts/${partId}/preview.glb`

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
  onSale: model.on_sale ?? model.onSale ?? false,
  salePercent:
    (model.sale_percent ?? model.salePercent) != null
      ? Number(model.sale_percent ?? model.salePercent)
      : undefined,
  salePrice:
    (model.sale_price ?? model.salePrice) != null
      ? Number(model.sale_price ?? model.salePrice)
      : undefined,
  originalPrice:
    (model.original_price ?? model.originalPrice) != null
      ? Number(model.original_price ?? model.originalPrice)
      : undefined,
  saleEndsAt: model.sale_ends_at ?? model.saleEndsAt ?? null,
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
  meshWarningAcknowledged: model.mesh_warning_acknowledged ?? model.meshWarningAcknowledged ?? false,
  meshWarningAcknowledgedAt: model.mesh_warning_acknowledged_at ?? model.meshWarningAcknowledgedAt ?? null,
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
  // Separate planner thumbnail for THIS listing's own primary model (migration
  // 059) — the store thumbnail above is often a group shot of every model in
  // the listing together, not a picture of the primary model specifically.
  primaryThumbnailUrl: assetUrl(model.primary_thumbnail_path ?? model.primaryThumbnailPath ?? undefined),
  // GLB is fetched via the signed preview endpoint (raw key is never exposed). We
  // only get a `has_glb` boolean now; older direct fields are a dev/legacy fallback.
  glbUrl:
    (model.has_glb ?? model.glb_file_path) ? previewGlbUrl(model.id)
      : (model.glb_url || model.glbUrl || undefined),
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
    // Same treatment as thumbnailUrl above: the API only ever stores a raw
    // storage key (image_path), never a ready-to-render URL — assetUrl() is
    // what turns that into a CDN/uploads URL. Falling back to the bare key
    // (as this used to) rendered a broken <img> for every gallery photo.
    imageUrl: image.image_url ?? image.imageUrl ?? assetUrl(image.image_path ?? image.imagePath),
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
  // Default planner tilt baked in by the artist (degrees, pitch about X).
  defaultPitchDeg: Number(model.default_pitch_deg ?? model.defaultPitchDeg ?? 0),
  // Artist opt-out: whether this model may be placed on the 3D planner at all
  // (a misc item — paint brush holder, display base — still sells normally but
  // never appears as a placeable asset). Defaults true when the API omits it.
  showInPlanner: (model.show_in_planner ?? model.showInPlanner ?? true) as boolean,
  // Multi-part ("set") models: number of STL files + the extra parts.
  partCount: Number(model.part_count ?? model.partCount ?? 1),
  parts: model.parts?.map((p: any) => ({
    id: p.id,
    name: p.name,
    thumbnailUrl: p.thumbnail_url || p.thumbnailUrl || assetUrl(p.thumbnail_path),
    glbUrl: (p.has_glb ?? p.glb_file_path) ? previewPartGlbUrl(p.id) : undefined,
    width: p.width ?? undefined,
    depth: p.depth ?? undefined,
    height: p.height ?? undefined,
    processingStatus: p.processing_status ?? p.processingStatus ?? undefined,
    processingError: p.processing_error ?? p.processingError ?? undefined,
    groupIndex: Number(p.group_index ?? p.groupIndex ?? 0),
    groupName: p.group_name ?? p.groupName ?? null,
  })),
  primaryGroupName: model.primary_group_name ?? model.primaryGroupName ?? null,
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
  backgroundImageUrl:
    assetUrl(artist.backgroundImageUrl || artist.background_image_url) || undefined,
  accentColor: artist.accentColor || artist.accent_color || undefined,
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
