// src/api/types.ts

export type AuthRole = 'customer' | 'artist' | 'admin'
export type AccountStatus = 'active' | 'suspended' | 'banned'

export interface ApiUser {
  id: string
  email: string
  displayName: string
  role: AuthRole
  emailVerified?: boolean
  isSuperAdmin?: boolean
  artistName?: string
  artistBio?: string
  artistUrl?: string
  accountStatus?: AccountStatus
  stripeOnboardingComplete?: boolean
  twoFactorEnabled?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface User extends ApiUser {
  name: string
  profileImage?: string
  avatar?: string
  verified?: boolean
  artistId?: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  displayName: string
  artistName?: string
  inviteCode?: string
}

export interface AuthResponse {
  message?: string
  user: User
  accessToken: string
  refreshToken: string
}

export interface ApiResponse<T = unknown> {
  data?: T
  message?: string
  success?: boolean
  pagination?: Pagination
  [key: string]: unknown
}

export interface Pagination {
  page: number
  limit: number
  totalItems: number
  totalPages: number
  pages?: number
}

export interface Category {
  id?: string
  name?: string
  category?: string
  modelCount: number
}

export interface Tag {
  id?: string
  tag: string
  usageCount: number
}

export interface TerrainModel {
  id: string
  name: string
  description?: string
  category: string
  tags: string[]
  basePrice: number
  fulfillmentType?: 'stl' | 'print'
  // Buyer usage licence (see utils/licenses). 'personal' = own use only;
  // 'commercial' = may sell physical prints. Neither permits sharing the file.
  license?: 'personal' | 'commercial'
  // Active sale (migration 034). When onSale, salePrice is the charged price and
  // originalPrice is the honest "was" price to strike through.
  onSale?: boolean
  salePercent?: number
  salePrice?: number
  originalPrice?: number
  saleEndsAt?: string | null
  // Printability metadata (artist-declared) + automated mesh QA (see utils/printability).
  printerType?: 'fdm' | 'resin' | 'both' | null
  supportsRequired?: boolean
  recommendedLayerHeight?: number
  recommendedInfill?: number
  meshAnalyzed?: boolean
  meshIsWatertight?: boolean | null
  meshIsManifold?: boolean | null
  meshTriangleCount?: number
  meshOpenEdges?: number
  // File versioning (see migration 033). fileVersion starts at 1; versionNotes is
  // the latest changelog; versions is the full history (most recent first).
  fileVersion?: number
  versionNotes?: string | null
  filesUpdatedAt?: string | null
  versions?: Array<{ version: number; notes?: string | null; createdAt: string }>
  thumbnailUrl?: string
  glbUrl?: string
  previewImages?: string[]
  artistName: string
  artistUrl?: string
  artistId?: string
  artistBio?: string
  width?: number
  height?: number
  depth?: number
  printStats?: {
    estimatedWeightG?: number
    estimatedPrintTimeMinutes?: number
    volumeMm3?: number
  }
  viewCount?: number
  saleCount?: number
  reviewCount?: number
  averageRating?: number
  isFavorited?: boolean
  favoriteCount?: number
  status?: 'draft' | 'published' | 'archived' | string
  visibility?: 'public' | 'private' | 'unlisted'
  processingStatus?: 'processing' | 'ready' | 'failed' | string
  processingError?: string | null
  downloadCount?: number
  // Print-on-demand quote (artist dashboard Print button). printPrice is the
  // customer-facing total = provider cost + artist fee (basePrice) + £1 site fee.
  printProviderCost?: number
  printPrice?: number
  printProvider?: string
  printQuotedAt?: string
  // Artist has agreed this model may be manufactured by a third-party print service.
  printConsent?: boolean
  publishedAt?: string
  createdAt?: string
  updatedAt?: string
  // Multi-part ("set") models: 1 = ordinary single-STL model; >1 = a set whose
  // extra STL parts are listed in `parts`.
  partCount?: number
  parts?: Array<{
    id: string
    name?: string
    thumbnailUrl?: string
    glbUrl?: string
    width?: number
    depth?: number
    height?: number
    processingStatus?: string
    /** Component ("included model") this part belongs to — 0 is the primary's. */
    groupIndex?: number
    groupName?: string | null
  }>
  /**
   * Name of the component that owns the primary file, when the listing groups its
   * files into several named models (a "Small Village" of tower + tavern + well).
   * Undefined/null = an ungrouped model or flat multi-part set.
   */
  primaryGroupName?: string | null
  // Default planner tilt (pitch about X, degrees) baked in by the artist so the
  // model stands upright when placed. 0 = no tilt.
  defaultPitchDeg?: number
  // Artist opt-out: whether this model may be placed on the 3D planner at all.
  // Default true — a misc item (paint brush holder, display base, …) can be
  // turned off without affecting its normal marketplace listing/sale.
  showInPlanner?: boolean
  images?: Array<{
    id: string
    imagePath?: string
    imageUrl?: string
    caption?: string
    displayOrder?: number
  }>
  recentReviews?: Array<{
    id: string
    rating: number
    comment?: string
    title?: string
    reviewerName?: string
    createdAt: string
  }>
  // Number of public planner tables that feature this model.
  featuredInTables?: number
  // Faceted taxonomy tags (facet terms) attached to this model.
  taxonomyTerms?: Array<{
    facetSlug: string
    facetName: string
    termId: string
    path: string
    name: string
  }>
}

export interface SearchFilters {
  search?: string
  category?: string
  tags?: string[] | string
  /** Faceted taxonomy filter: comma-separated `facetSlug:termPath` tokens. */
  terms?: string
  minPrice?: number
  maxPrice?: number
  sortBy?: 'recent' | 'popular' | 'sales' | 'rating' | 'price_low' | 'price_high' | 'name'
  // Browse fulfillment tab: 'print' narrows to print-and-ship models; otherwise
  // digital downloads (all published models).
  fulfillment?: 'stl' | 'print'
  page?: number
  limit?: number
}

export interface SearchResponse {
  models: TerrainModel[]
  pagination: Pagination
}

export interface ModelUploadRequest {
  name: string
  description?: string
  category: string
  tags?: string[]
  basePrice: number
  visibility?: 'public' | 'private' | 'unlisted'
  draft?: boolean
  width?: number
  height?: number
  depth?: number
}

export interface UploadResponse {
  url: string
  message?: string
}

export interface Review {
  id: string
  modelId: string
  userId: string
  rating: number
  comment?: string
  createdAt: string
  updatedAt: string
  userDisplayName?: string
}

export interface CreateReviewRequest {
  modelId: string
  rating: number
  comment?: string
}

export interface ArtistSummary {
  id: string
  name: string
  bio?: string
  profileImageUrl?: string
  bannerImageUrl?: string
  backgroundImageUrl?: string
  accentColor?: string
  artistUrl?: string
  totalModels?: number
  totalSales?: number
  totalViews?: number
  followerCount?: number
  isFollowing?: boolean
  rating?: number
  createdAt?: string
}

export interface ArtistDetail extends ArtistSummary {
  totalPurchases?: number
}

// A published showcase planner surfaced on the artist's brand page.
export interface ArtistShowcase {
  id: string
  name: string
  description?: string
  modelCount: number
  viewCount: number
  thumbnails: string[]
  updatedAt?: string
}

export interface ArtistStats {
  grossRevenue: number
  netEarnings: number
  totalSales: number
  totalModels: number
  activeModels: number
  draftModels: number
  totalViews: number
  totalDownloads: number
  followers: number
}

export interface TableConfig {
  width: number
  depth: number
  grid_size?: number
  background_color?: string
  grid_color?: string
}

export interface TableLayoutData {
  models: Array<{
    modelId: string
    position: { x: number; y: number; z?: number }
    rotation?: number
    scale?: number
  }>
}

export interface TableLayout {
  id: string
  userId: string | null
  userEmail?: string | null
  name: string
  description?: string
  tableConfig: TableConfig
  layoutData: TableLayoutData
  shareToken?: string
  shareCode?: string
  isPublic: boolean
  viewCount: number
  cloneCount: number
  status?: string
  plan?: string
  maxAssets?: number
  createdAt: string
  updatedAt: string
}

export interface SaveTablePayload {
  name: string
  description?: string
  tableConfig: TableConfig
  layoutData: TableLayoutData
  isPublic?: boolean
  userId?: string
  userEmail?: string
  sessionId?: string
}

export interface PaymentIntentResponse {
  clientSecret: string
  paymentIntentId?: string
  amount?: number
  currency?: string
}

export interface ArtistProfile {
  id: string
  name?: string
  displayName?: string
  email?: string
  artistName?: string
  bio?: string
  profileImageUrl?: string
  totalSales?: number
  totalRevenue?: number
  createdAt?: string
}

export interface OrderItem {
  modelId: string
  modelName: string
  artistId: string
  artistName: string
  price: number
  quantity: number
  downloadUrl?: string
}

export interface Order {
  id: string
  userId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  items: OrderItem[]
  subtotal: number
  platformFee: number
  total: number
  createdAt: string
  updatedAt: string
}

export interface OrderSummary {
  id: string
  orderNumber: string
  total: number
  paymentStatus: string
  fulfillmentStatus: string
  trackingNumber?: string
  trackingUrl?: string
  createdAt: string
  paidAt?: string
  shippedAt?: string
  itemCount: number
}

export interface CreateOrderRequest {
  items: {
    modelId: string
    quantity: number
  }[]
}

export interface AdminStats {
  totalUsers: number
  totalArtists: number
  totalModels: number
  totalOrders: number
  totalRevenue: number
  pendingModels: number
}

export interface QueueHealth {
  waiting: number
  active: number
  completed: number
  failed: number
}

// A model as referenced inside a bundle (lightweight projection).
export interface BundleModelRef {
  id: string
  name: string
  thumbnailUrl?: string
  basePrice: number
  status?: string
  processingStatus?: string
}

// Several models grouped under one name + one price.
export interface Bundle {
  id: string
  artistId?: string
  artistName?: string
  name: string
  description?: string
  price: number
  thumbnailUrl?: string
  status?: string
  visibility?: string
  modelCount: number
  models: BundleModelRef[]
  createdAt?: string
  publishedAt?: string
  onSale?: boolean
  salePercent?: number
  salePrice?: number
  originalPrice?: number
  saleEndsAt?: string | null
}
