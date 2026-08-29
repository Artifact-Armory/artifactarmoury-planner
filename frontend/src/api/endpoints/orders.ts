import apiClient from '../client'
import type { OrderSummary, TerrainModel } from '../types'
import { mapModelRecord } from '../transformers'

const BASE_URL = '/api/orders'

/** A purchased model plus the buyer's own review (if they've left one). */
export type PurchasedModel = {
  model: TerrainModel
  purchasedAt?: string
  myReview: { id: string; rating: number; title?: string | null; comment?: string | null } | null
}

type Pagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

// A cart line sent to the backend: either a single model or a bundle.
export type OrderItemInput = { modelId: string } | { bundleId: string }

/**
 * How the buyer intends to pay. PayPal runs *through* Stripe, so both are one
 * integration — this only seeds the order row and picks the mock path; on live
 * Stripe the buyer's actual choice is made inside the Payment Element and read back
 * off the intent server-side.
 */
export type PaymentMethodChoice = 'stripe' | 'paypal'

export type CreatedOrder = {
  id: string
  orderNumber: string
  /** Net of tax. */
  subtotal?: number
  /** Destination VAT the backend actually charged. */
  tax?: number
  taxCountry?: string
  taxRate?: number
  /** Gross — what the buyer pays. */
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

  /**
   * Create a digital order from cart items (models and/or bundles). The download
   * unlocks immediately on payment; the buyer keeps their statutory 14-day right to
   * cancel for a refund (we no longer collect a waiver for it — see
   * PAYOUT_HOLD_DAYS in services/earnings.ts, which holds the artist's cut for that
   * same window so a refund doesn't claw back money already paid out).
   *
   * `termsAccepted` records the buyer agreeing to the Terms of Service (and thereby
   * the per-model licence terms) — the backend rejects the order without it.
   */
  async createOrder(
    items: OrderItemInput[],
    customerEmail: string | undefined,
    termsAccepted: boolean,
    paymentMethod: PaymentMethodChoice = 'stripe',
    /**
     * ISO country the buyer selected. Only the *code* goes over the wire — the
     * backend looks up the rate and computes the tax itself, so a tampered client
     * can't change what it is charged.
     */
    taxCountry?: string | null,
  ): Promise<CreatedOrder> {
    const response = await apiClient.post(BASE_URL, {
      items, customerEmail, termsAccepted, paymentMethod, taxCountry,
    })
    const o = response.data?.order ?? response.data
    return {
      id: o.id,
      orderNumber: o.orderNumber ?? o.order_number,
      subtotal: o.subtotal != null ? Number(o.subtotal) : undefined,
      tax: o.tax != null ? Number(o.tax) : undefined,
      taxCountry: o.taxCountry ?? o.tax_country,
      taxRate: o.taxRate != null ? Number(o.taxRate) : undefined,
      total: Number(o.total ?? 0),
      clientSecret: o.clientSecret ?? o.client_secret,
      paymentIntentId: o.paymentIntentId ?? o.payment_intent_id,
    }
  },

  /**
   * Confirm payment (mock Stripe returns 'succeeded'), unlocking downloads.
   *
   * `pending` comes back when a redirect method (PayPal) returned to the site while
   * the payment is still settling: nothing is unlocked yet and the Stripe webhook
   * completes the order, so the UI must say "processing", not "done".
   */
  async confirmOrder(orderId: string, paymentIntentId: string): Promise<{ pending: boolean }> {
    const response = await apiClient.post(`${BASE_URL}/${orderId}/confirm`, { paymentIntentId })
    return { pending: !!response.data?.order?.pending }
  },

  /** The signed-in buyer's purchased models (full detail + their own review). */
  async getLibrary(): Promise<PurchasedModel[]> {
    const response = await apiClient.get(`${BASE_URL}/library`)
    return (response.data?.models ?? []).map((row: any) => ({
      model: mapModelRecord(row),
      purchasedAt: row.purchasedAt ?? row.purchased_at,
      myReview: row.myReview
        ? {
            id: row.myReview.id,
            rating: Number(row.myReview.rating),
            title: row.myReview.title ?? null,
            comment: row.myReview.comment ?? null,
          }
        : null,
    }))
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
