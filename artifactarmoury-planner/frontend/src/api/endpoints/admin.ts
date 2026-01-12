import apiClient from '../client';
import { 
  ApiResponse, 
  AdminStats,
  User,
  ArtistProfile,
  Order,
  TerrainModel,
  Category,
  Tag
} from '../types';

const BASE_URL = '/api/admin';

export const adminApi = {
  /**
   * Get admin dashboard statistics
   */
  getAdminStats: async (): Promise<ApiResponse<AdminStats>> => {
    const response = await apiClient.get<ApiResponse<AdminStats>>(`${BASE_URL}/stats`);
    return response.data;
  },

  /**
   * Get list of all users with pagination
   */
  getAllUsers: async (
    page = 1, 
    limit = 20,
    query?: string,
    role?: 'user' | 'artist' | 'admin'
  ): Promise<ApiResponse<{
    users: User[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      users: User[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/users`, {
      params: { page, limit, query, role }
    });
    return response.data;
  },

  /**
   * Get a user by ID
   */
  getUserById: async (id: string): Promise<ApiResponse<User>> => {
    const response = await apiClient.get<ApiResponse<User>>(`${BASE_URL}/users/${id}`);
    return response.data;
  },

  /**
   * Update a user
   */
  updateUser: async (id: string, data: Partial<User>): Promise<ApiResponse<User>> => {
    const response = await apiClient.put<ApiResponse<User>>(`${BASE_URL}/users/${id}`, data);
    return response.data;
  },

  /**
   * Delete a user
   */
  deleteUser: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/users/${id}`);
    return response.data;
  },

  /**
   * Get list of all artist applications
   */
  getArtistApplications: async (
    page = 1,
    limit = 20,
    status?: 'pending' | 'approved' | 'rejected'
  ): Promise<ApiResponse<{
    applications: {
      id: string;
      user: User;
      name: string;
      bio: string;
      website?: string;
      social?: {
        twitter?: string;
        instagram?: string;
        artstation?: string;
      };
      portfolio: string[];
      status: 'pending' | 'approved' | 'rejected';
      reviewedBy?: string;
      reviewedAt?: string;
      createdAt: string;
    }[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      applications: {
        id: string;
        user: User;
        name: string;
        bio: string;
        website?: string;
        social?: {
          twitter?: string;
          instagram?: string;
          artstation?: string;
        };
        portfolio: string[];
        status: 'pending' | 'approved' | 'rejected';
        reviewedBy?: string;
        reviewedAt?: string;
        createdAt: string;
      }[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/artist-applications`, {
      params: { page, limit, status }
    });
    return response.data;
  },

  /**
   * Approve an artist application
   */
  approveArtistApplication: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.post<ApiResponse<null>>(
      `${BASE_URL}/artist-applications/${id}/approve`
    );
    return response.data;
  },

  /**
   * Reject an artist application
   */
  rejectArtistApplication: async (id: string, reason?: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.post<ApiResponse<null>>(
      `${BASE_URL}/artist-applications/${id}/reject`,
      { reason }
    );
    return response.data;
  },

  /**
   * Get all orders with pagination
   */
  getAllOrders: async (
    page = 1,
    limit = 20,
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded',
    query?: string,
    startDate?: string,
    endDate?: string
  ): Promise<ApiResponse<{
    orders: Order[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      orders: Order[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/orders`, {
      params: { page, limit, status, query, startDate, endDate }
    });
    return response.data;
  },

  /**
   * Update order status
   */
  updateOrderStatus: async (
    id: string, 
    status: 'processing' | 'completed' | 'failed' | 'refunded'
  ): Promise<ApiResponse<Order>> => {
    const response = await apiClient.put<ApiResponse<Order>>(
      `${BASE_URL}/orders/${id}/status`,
      { status }
    );
    return response.data;
  },

  /**
   * Process refund for an order
   */
  processRefund: async (
    id: string, 
    amount?: number, 
    reason?: string
  ): Promise<ApiResponse<Order>> => {
    const response = await apiClient.post<ApiResponse<Order>>(
      `${BASE_URL}/orders/${id}/refund`,
      { amount, reason }
    );
    return response.data;
  },

  /**
   * Get all models with pagination (admin view)
   */
  getAllModels: async (
    page = 1,
    limit = 20,
    query?: string,
    artistId?: string,
    categoryId?: string,
    featured?: boolean
  ): Promise<ApiResponse<{
    models: TerrainModel[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      models: TerrainModel[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/models`, {
      params: { page, limit, query, artistId, categoryId, featured }
    });
    return response.data;
  },

  /**
   * Update a model (admin access)
   */
  updateModel: async (id: string, data: Partial<TerrainModel>): Promise<ApiResponse<TerrainModel>> => {
    const response = await apiClient.put<ApiResponse<TerrainModel>>(`${BASE_URL}/models/${id}`, data);
    return response.data;
  },

  /**
   * Toggle model featured status
   */
  toggleModelFeatured: async (id: string, featured: boolean): Promise<ApiResponse<TerrainModel>> => {
    const response = await apiClient.put<ApiResponse<TerrainModel>>(
      `${BASE_URL}/models/${id}/featured`,
      { featured }
    );
    return response.data;
  },

  /**
   * Delete a model (admin access)
   */
  deleteModel: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/models/${id}`);
    return response.data;
  },

  /**
   * Manage categories
   */
  getAllCategories: async (): Promise<ApiResponse<Category[]>> => {
    const response = await apiClient.get<ApiResponse<Category[]>>(`${BASE_URL}/categories`);
    return response.data;
  },

  createCategory: async (data: {
    name: string;
    description: string;
    slug?: string;
    image?: string;
  }): Promise<ApiResponse<Category>> => {
    const response = await apiClient.post<ApiResponse<Category>>(`${BASE_URL}/categories`, data);
    return response.data;
  },

  updateCategory: async (id: string, data: Partial<Category>): Promise<ApiResponse<Category>> => {
    const response = await apiClient.put<ApiResponse<Category>>(`${BASE_URL}/categories/${id}`, data);
    return response.data;
  },

  deleteCategory: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/categories/${id}`);
    return response.data;
  },

  /**
   * Manage tags
   */
  getAllTags: async (): Promise<ApiResponse<Tag[]>> => {
    const response = await apiClient.get<ApiResponse<Tag[]>>(`${BASE_URL}/tags`);
    return response.data;
  },

  createTag: async (data: {
    name: string;
    slug?: string;
  }): Promise<ApiResponse<Tag>> => {
    const response = await apiClient.post<ApiResponse<Tag>>(`${BASE_URL}/tags`, data);
    return response.data;
  },

  updateTag: async (id: string, data: Partial<Tag>): Promise<ApiResponse<Tag>> => {
    const response = await apiClient.put<ApiResponse<Tag>>(`${BASE_URL}/tags/${id}`, data);
    return response.data;
  },

  deleteTag: async (id: string): Promise<ApiResponse<null>> => {
    const response = await apiClient.delete<ApiResponse<null>>(`${BASE_URL}/tags/${id}`);
    return response.data;
  },

  /**
   * Get admin reports and analytics
   */
  getSalesReport: async (
    startDate: string,
    endDate: string,
    groupBy: 'day' | 'week' | 'month' = 'day'
  ): Promise<ApiResponse<{
    data: {
      date: string;
      orders: number;
      revenue: number;
      models: number;
    }[];
    totals: {
      orders: number;
      revenue: number;
      models: number;
    };
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      data: {
        date: string;
        orders: number;
        revenue: number;
        models: number;
      }[];
      totals: {
        orders: number;
        revenue: number;
        models: number;
      };
    }>>(`${BASE_URL}/reports/sales`, {
      params: { startDate, endDate, groupBy }
    });
    return response.data;
  },

  /**
   * Get artist sales report
   */
  getArtistSalesReport: async (
    startDate: string,
    endDate: string
  ): Promise<ApiResponse<{
    artists: {
      artist: ArtistProfile;
      sales: number;
      revenue: number;
      models: number;
    }[];
    totals: {
      artists: number;
      sales: number;
      revenue: number;
      models: number;
    };
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      artists: {
        artist: ArtistProfile;
        sales: number;
        revenue: number;
        models: number;
      }[];
      totals: {
        artists: number;
        sales: number;
        revenue: number;
        models: number;
      };
    }>>(`${BASE_URL}/reports/artists`, {
      params: { startDate, endDate }
    });
    return response.data;
  },

  /**
   * Get model sales report
   */
  getModelSalesReport: async (
    startDate: string,
    endDate: string,
    limit = 50
  ): Promise<ApiResponse<{
    models: {
      model: TerrainModel;
      sales: number;
      revenue: number;
    }[];
    totals: {
      models: number;
      sales: number;
      revenue: number;
    };
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      models: {
        model: TerrainModel;
        sales: number;
        revenue: number;
      }[];
      totals: {
        models: number;
        sales: number;
        revenue: number;
      };
    }>>(`${BASE_URL}/reports/models`, {
      params: { startDate, endDate, limit }
    });
    return response.data;
  },
};
