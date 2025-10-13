import apiClient from '../client';
import { 
  ApiResponse, 
  Order,
  CreateOrderRequest,
  PaymentIntentResponse
} from '../types';

const BASE_URL = '/api/orders';

export const ordersApi = {
  /**
   * Get a list of the user's orders
   */
  getMyOrders: async (
    page = 1, 
    limit = 10
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
    }>>(`${BASE_URL}`, {
      params: { page, limit }
    });
    return response.data;
  },

  /**
   * Get a specific order by ID
   */
  getOrderById: async (id: string): Promise<ApiResponse<Order>> => {
    const response = await apiClient.get<ApiResponse<Order>>(`${BASE_URL}/${id}`);
    return response.data;
  },

  /**
   * Create a new order
   */
  createOrder: async (data: CreateOrderRequest): Promise<ApiResponse<Order>> => {
    const response = await apiClient.post<ApiResponse<Order>>(`${BASE_URL}`, data);
    return response.data;
  },

  /**
   * Create a payment intent with Stripe
   */
  createPaymentIntent: async (
    orderId: string
  ): Promise<ApiResponse<PaymentIntentResponse>> => {
    const response = await apiClient.post<ApiResponse<PaymentIntentResponse>>(
      `${BASE_URL}/${orderId}/payment-intent`
    );
    return response.data;
  },

  /**
   * Confirm a payment intent
   */
  confirmPayment: async (
    orderId: string, 
    paymentIntentId: string
  ): Promise<ApiResponse<Order>> => {
    const response = await apiClient.post<ApiResponse<Order>>(
      `${BASE_URL}/${orderId}/confirm-payment`,
      { paymentIntentId }
    );
    return response.data;
  },

  /**
   * Cancel an order
   */
  cancelOrder: async (orderId: string): Promise<ApiResponse<Order>> => {
    const response = await apiClient.post<ApiResponse<Order>>(
      `${BASE_URL}/${orderId}/cancel`
    );
    return response.data;
  },

  /**
   * Get order receipts/invoices
   */
  getOrderReceipt: async (
    orderId: string
  ): Promise<ApiResponse<{ receiptUrl: string; expiresAt: number }>> => {
    const response = await apiClient.get<ApiResponse<{ receiptUrl: string; expiresAt: number }>>(
      `${BASE_URL}/${orderId}/receipt`
    );
    return response.data;
  },

  /**
   * Get list of purchased models
   */
  getPurchasedModels: async (
    page = 1, 
    limit = 20
  ): Promise<ApiResponse<{
    models: {
      model: {
        id: string;
        title: string;
        thumbnail: string;
        artist: {
          id: string;
          name: string;
        };
      };
      purchasedAt: string;
      license: 'personal' | 'commercial' | 'enterprise';
      orderId: string;
    }[];
    totalCount: number;
    page: number;
    totalPages: number;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      models: {
        model: {
          id: string;
          title: string;
          thumbnail: string;
          artist: {
            id: string;
            name: string;
          };
        };
        purchasedAt: string;
        license: 'personal' | 'commercial' | 'enterprise';
        orderId: string;
      }[];
      totalCount: number;
      page: number;
      totalPages: number;
    }>>(`${BASE_URL}/purchased-models`, {
      params: { page, limit }
    });
    return response.data;
  },

  /**
   * Check if user has purchased a specific model
   */
  checkPurchasedModel: async (
    modelId: string
  ): Promise<ApiResponse<{
    purchased: boolean;
    license?: 'personal' | 'commercial' | 'enterprise';
    purchasedAt?: string;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      purchased: boolean;
      license?: 'personal' | 'commercial' | 'enterprise';
      purchasedAt?: string;
    }>>(`${BASE_URL}/purchased-models/${modelId}`);
    return response.data;
  },

  /**
   * Get invoice details for an order
   */
  getInvoiceDetails: async (orderId: string): Promise<ApiResponse<{
    invoiceNumber: string;
    invoiceDate: string;
    companyDetails: {
      name: string;
      address: string;
      taxId?: string;
    };
    customerDetails: {
      name: string;
      email: string;
      address?: string;
    };
    items: {
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }[];
    subtotal: number;
    tax: number;
    total: number;
    paymentMethod: string;
    paymentStatus: string;
  }>> => {
    const response = await apiClient.get<ApiResponse<{
      invoiceNumber: string;
      invoiceDate: string;
      companyDetails: {
        name: string;
        address: string;
        taxId?: string;
      };
      customerDetails: {
        name: string;
        email: string;
        address?: string;
      };
      items: {
        description: string;
        quantity: number;
        unitPrice: number;
        total: number;
      }[];
      subtotal: number;
      tax: number;
      total: number;
      paymentMethod: string;
      paymentStatus: string;
    }>>(`${BASE_URL}/${orderId}/invoice`);
    return response.data;
  },
};
