import apiClient from '../client'
import type { OrderSummary } from '../types'

const BASE_URL = '/api/orders'

type Pagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

// A cart line sent to the backend: either a single model or a bundle.
export type OrderItemInput = { modelId: string } | { bundleId: string }

export type CreatedOrder = {
  id: string
  orderNumber: string
  total: number
  clientSecret?: string
  paymentIntentId?: string
}

export const ordersApi = {
  async getMyOrders(page = 1, limit = 10): Promise<{ orders: OrderSummary[]; pagination: Pagination }> {
    const response = await apiClient.get(`${BASE_URL}/user/orders`, { params: { page, limit } })
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

  /** Create a digital order from cart items (models and/or bundles). */
  async createOrder(items: OrderItemInput[], customerEmail?: string): Promise<CreatedOrder> {
    const response = await apiClient.post(BASE_URL, { items, customerEmail })
    const o = response.data?.order ?? response.data
    return {
      id: o.id,
      orderNumber: o.orderNumber ?? o.order_number,
      total: Number(o.total ?? 0),
      clientSecret: o.clientSecret ?? o.client_secret,
      paymentIntentId: o.paymentIntentId ?? o.payment_intent_id,
    }
  },

  /** Confirm payment (mock Stripe returns 'succeeded'), unlocking downloads. */
  async confirmOrder(orderId: string, paymentIntentId: string): Promise<void> {
    await apiClient.post(`${BASE_URL}/${orderId}/confirm`, { paymentIntentId })
  },

  /** The models and bundles the signed-in user owns (drives Download vs Buy UI). */
  async getEntitlements(): Promise<{ models: Set<string>; bundles: Set<string> }> {
    const response = await apiClient.get(`${BASE_URL}/entitlements`)
    return {
      models: new Set<string>(response.data?.modelIds ?? []),
      bundles: new Set<string>(response.data?.bundleIds ?? []),
    }
  },
}
