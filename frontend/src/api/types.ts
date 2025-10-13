// src/api/types.ts

// User & Auth
export interface User {
  id: string
  email: string
  name: string
  role: 'artist' | 'user' | 'admin'
  artistId?: string
  profileImage?: string
  verified: boolean
  createdAt: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  name: string
  isArtist?: boolean
  artistName?: string
  bio?: string
}

export interface AuthResponse {
  token: string
  user: User
}

// Models
export interface Model {
  id: string
  artistId: string
  artistName: string
  name: string
  description: string
  basePrice: number
  genre?: string
  categories: string[]
  tags: string[]
  status: 'pending' | 'processing' | 'active' | 'rejected'
  fileUrl?: string
  previewImages: string[]
  printRecommendations?: {
    layerHeight?: string
    infill?: string
    supports?: boolean
    notes?: string
  }
  downloads: number
  rating: number
  reviews: number
  createdAt: string
  updatedAt: string
}

export interface ModelUpload {
  name: string
  description: string
  basePrice: number
  genre?: string
  categories?: string[]
  tags?: string[]
  printRecommendations?: {
    layerHeight?: string
    infill?: string
    supports?: boolean
    notes?: string
  }
}

// Browse & Search
export interface BrowseFilters {
  search?: string
  genre?: string
  categories?: string[]
  minPrice?: number
  maxPrice?: number
  sortBy?: 'newest' | 'popular' | 'price_asc' | 'price_desc' | 'rating'
  limit?: number
  offset?: number
}

export interface BrowseResponse {
  models: Model[]
  total: number
  limit: number
  offset: number
}

// Artists
export interface Artist {
  id: string
  userId: string
  name: string
  bio: string
  profileImage?: string
  bannerImage?: string
  verified: boolean
  rating: number
  totalSales: number
  totalModels: number
  joinedAt: string
}

export interface ArtistStats {
  totalRevenue: number
  totalSales: number
  totalModels: number
  pendingOrders: number
  activeModels: number
}

// Tables
export interface TableLayout {
  id: string
  userId: string
  name: string
  description?: string
  models: {
    modelId: string
    position: { x: number; y: number }
    rotation?: number
    scale?: number
  }[]
  isPublic: boolean
  views: number
  likes: number
  createdAt: string
  updatedAt: string
}

// Orders
export interface Order {
  id: string
  userId: string
  stripeSessionId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  items: OrderItem[]
  subtotal: number
  platformFee: number
  total: number
  createdAt: string
  updatedAt: string
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

export interface CreateOrderRequest {
  items: {
    modelId: string
    quantity: number
  }[]
}

// Admin
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

// API Response wrapper
export interface ApiResponse<T = any> {
  data?: T
  error?: string
  message?: string
}
