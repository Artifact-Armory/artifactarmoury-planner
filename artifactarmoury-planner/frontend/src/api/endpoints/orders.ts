import apiClient from '../client'
import type {
  ApiResponse,
  CreateOrderRequest,
  Order,
  OrderSummary,
  PaymentIntentResponse,
} from '../types'

const BASE_URL = '/api/orders'

type Pagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

type PurchasedModel = {
  model: {
    id: string
    title: string
    thumbnail: string
    artist: {
      id: string
      name: string
    }
  }
  purchasedAt: string
  license: string
  orderId: string
}

type InvoiceDetails = {
  invoiceNumber: string
  invoiceDate: string
  companyDetails: {
    name: string
    address: string
    taxId?: string
  }
  customerDetails: {
    name: string
    email: string
    address?: string
  }
  items: Array<{
    description: string
    quantity: number
    unitPrice: number
    total: number
  }>
  subtotal: number
  tax: number
  total: number
  paymentMethod: string
  paymentStatus: string
}

export const ordersApi = {
  async getMyOrders(page = 1, limit = 10): Promise<{ orders: OrderSummary[]; pagination: Pagination }> {
    const response = await apiClient.get(`${BASE_URL}/user/orders`, {
      params: { page, limit },
    })

    const payload = response.data ?? {}

    const orders: OrderSummary[] = (payload.orders ?? []).map((order: any) => ({
      id: order.id,
      orderNumber: order.order_number ?? order.orderNumber,
      total: Number(order.total ?? 0),
      paymentStatus: order.payment_status ?? order.paymentStatus,
      fulfillmentStatus: order.fulfillment_status ?? order.fulfillmentStatus,
      trackingNumber: order.tracking_number ?? order.trackingNumber ?? undefined,
      trackingUrl: order.tracking_url ?? order.trackingUrl ?? undefined,
      createdAt: order.created_at ?? order.createdAt,
      paidAt: order.paid_at ?? order.paidAt ?? undefined,
      shippedAt: order.shipped_at ?? order.shippedAt ?? undefined,
      itemCount: Number(order.item_count ?? order.itemCount ?? 0),
    }))

    const paginationRaw = payload.pagination ?? {}

    return {
      orders,
      pagination: {
        page: Number(paginationRaw.page ?? page),
        limit: Number(paginationRaw.limit ?? limit),
        total: Number(paginationRaw.total ?? payload.total ?? orders.length),
        totalPages: Number(paginationRaw.totalPages ?? paginationRaw.pages ?? 1),
      },
    }
  },

  async getOrderById(id: string): Promise<ApiResponse<Order>> {
    const response = await apiClient.get<ApiResponse<Order>>(`${BASE_URL}/${id}`)
    return response.data
  },

  async createOrder(data: CreateOrderRequest): Promise<ApiResponse<Order>> {
    const response = await apiClient.post<ApiResponse<Order>>(BASE_URL, data)
    return response.data
  },

  async createPaymentIntent(orderId: string): Promise<ApiResponse<PaymentIntentResponse>> {
    const response = await apiClient.post<ApiResponse<PaymentIntentResponse>>(
      `${BASE_URL}/${orderId}/payment-intent`,
    )
    return response.data
  },

  async confirmPayment(orderId: string, paymentIntentId: string): Promise<ApiResponse<Order>> {
    const response = await apiClient.post<ApiResponse<Order>>(
      `${BASE_URL}/${orderId}/confirm-payment`,
      { paymentIntentId },
    )
    return response.data
  },

  async cancelOrder(orderId: string): Promise<ApiResponse<Order>> {
    const response = await apiClient.post<ApiResponse<Order>>(`${BASE_URL}/${orderId}/cancel`)
    return response.data
  },

  async getOrderReceipt(orderId: string): Promise<ApiResponse<{ receiptUrl: string; expiresAt: number }>> {
    const response = await apiClient.get<ApiResponse<{ receiptUrl: string; expiresAt: number }>>(
      `${BASE_URL}/${orderId}/receipt`,
    )
    return response.data
  },

  async getPurchasedModels(
    page = 1,
    limit = 20,
  ): Promise<ApiResponse<{ models: PurchasedModel[]; totalCount: number; page: number; totalPages: number }>> {
    const response = await apiClient.get<
      ApiResponse<{ models: PurchasedModel[]; totalCount: number; page: number; totalPages: number }>
    >(`${BASE_URL}/purchased-models`, {
      params: { page, limit },
    })
    return response.data
  },

  async checkPurchasedModel(
    modelId: string,
  ): Promise<ApiResponse<{ purchased: boolean; license?: PurchasedModel['license']; purchasedAt?: string }>> {
    const response = await apiClient.get<
      ApiResponse<{ purchased: boolean; license?: PurchasedModel['license']; purchasedAt?: string }>
    >(`${BASE_URL}/purchased-models/${modelId}`)
    return response.data
  },

  async getInvoiceDetails(orderId: string): Promise<ApiResponse<InvoiceDetails>> {
    const response = await apiClient.get<ApiResponse<InvoiceDetails>>(`${BASE_URL}/${orderId}/invoice`)
    return response.data
  },
}
