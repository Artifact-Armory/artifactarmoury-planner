// src/api/types.ts

export type AuthRole = 'customer' | 'artist' | 'admin'
export type AccountStatus = 'active' | 'suspended' | 'banned'

export interface ApiUser {
  id: string
  email: string
  displayName: string
  role: AuthRole
  artistName?: string
  artistBio?: string
  artistUrl?: string
  accountStatus?: AccountStatus
  stripeOnboardingComplete?: boolean
  createdAt?: string
  updatedAt?: string
  creatorVerified?: boolean
  verificationBadge?: string | null
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
  license: string
  thumbnailUrl?: string
  previewImages?: string[]
  artistName: string
  artistUrl?: string
  artistId?: string
  artistBio?: string
  creatorVerified?: boolean
  verificationBadge?: string | null
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
  inLibrary?: boolean
  status?: 'draft' | 'published' | 'archived'
  visibility?: 'public' | 'private' | 'unlisted'
  downloadCount?: number
  publishedAt?: string
  createdAt?: string
  updatedAt?: string
  assetId?: string
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
}

export interface SearchFilters {
  search?: string
  category?: string
  tags?: string[] | string
  minPrice?: number
  maxPrice?: number
  sortBy?: 'recent' | 'popular' | 'sales' | 'rating' | 'price_low' | 'price_high' | 'name'
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
  license: string
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
  totalModels?: number
  totalSales?: number
  totalViews?: number
  rating?: number
  createdAt?: string
  creatorVerified?: boolean
  verificationBadge?: string | null
}

export interface ArtistDetail extends ArtistSummary {
  totalPurchases?: number
}

export type ArtistProfile = ArtistDetail

export interface ArtistAnalytics {
  totalModels: number
  publishedModels: number
  totalViews: number
  totalPurchases: number
  totalRevenue: number
  pendingPayout: number
  recentOrders: ArtistAnalyticsRecentOrder[]
  topModels: ArtistAnalyticsTopModel[]
}

export interface ArtistAnalyticsRecentOrder {
  id: string
  orderNumber: string
  customerEmail: string
  total: number
  paymentStatus: string
  fulfillmentStatus: string
  createdAt: string
}

export interface ArtistAnalyticsTopModel {
  id: string
  name: string
  basePrice: number
  viewCount: number
  saleCount: number
  revenue: number
}

export interface TableLayoutModel {
  modelId: string
  x: number
  y: number
  rotation?: number
  scale?: number
}

export interface TableLayoutData {
  models: TableLayoutModel[]
}

export interface TableLayout {
  id: string
  userId?: string | null
  name: string
  description?: string | null
  width?: number | null
  depth?: number | null
  layout: TableLayoutData
  isPublic: boolean
  shareCode?: string | null
  viewCount: number
  cloneCount: number
  createdAt: string
  updatedAt: string
}

export interface TableLayoutCreateRequest {
  name: string
  description?: string
  width?: number
  depth?: number
  layout?: TableLayoutData
  isPublic?: boolean
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

export interface PaymentIntentResponse {
  clientSecret: string
  paymentIntentId: string
  amount: number
  currency?: string
  status?: string
}

export interface QueueHealth {
  waiting: number
  active: number
  completed: number
  failed: number
}
