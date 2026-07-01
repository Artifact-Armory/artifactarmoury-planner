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
  publishedAt?: string
  createdAt?: string
  updatedAt?: string
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
}

export interface ArtistDetail extends ArtistSummary {
  totalPurchases?: number
}

export interface ArtistStats {
  totalRevenue: number
  totalSales: number
  totalModels: number
  pendingOrders: number
  activeModels: number
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
