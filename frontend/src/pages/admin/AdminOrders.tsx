import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Undo2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminApi, AdminOrderRow } from '../../api/endpoints/admin'
import { assetUrl } from '../../api/transformers'
import { formatPrice } from '../../utils/format'
import Spinner from '../../components/ui/Spinner'

const FULFILLMENT = ['pending', 'processing', 'printing', 'shipped', 'delivered', 'cancelled']

const payBadge: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-muted text-foreground',
}

const AdminOrders: React.FC = () => {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'orders', { status, page }],
    queryFn: () => adminApi.getOrders({ status: status || undefined, page, limit: 25 }),
  })

  const fulfilMut = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) =>
      adminApi.setOrderFulfillment(id, { status: s }),
    onSuccess: () => {
      toast.success('Fulfillment updated')
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update'),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track orders and fulfillment status.</p>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={status}
          onChange={(e) => {
            setPage(1)
            setStatus(e.target.value)
          }}
          className="py-2 px-3 text-sm border border-border rounded-md"
        >
          <option value="">All fulfillment statuses</option>
          {FULFILLMENT.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium text-right">Items</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Fulfillment</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-red-600">
                    Failed to load orders.
                  </td>
                </tr>
              )}
              {data?.orders.map((o: AdminOrderRow) => (
                <tr key={o.id} className="cursor-pointer hover:bg-accent" onClick={() => setOpenId(o.id)}>
                  <td className="px-4 py-3 font-medium text-foreground">{o.order_number}</td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{o.customer_name || '—'}</div>
                    <div className="text-xs text-muted-foreground">{o.customer_email}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{o.item_count}</td>
                  <td className="px-4 py-3 text-right text-foreground">{formatPrice(o.total)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        payBadge[o.payment_status] || 'bg-muted text-foreground'
                      }`}
                    >
                      {o.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={o.fulfillment_status}
                      onChange={(e) => fulfilMut.mutate({ id: o.id, s: e.target.value })}
                      className="text-xs border border-border rounded-sm px-2 py-1 bg-card"
                    >
                      {FULFILLMENT.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))}
              {data && data.orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No orders found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} orders
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 border border-border rounded-md disabled:opacity-50"
            >
              Previous
            </button>
            <button
              disabled={page >= data.pagination.pages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-border rounded-md disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {openId && <OrderDetailPanel orderId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

const OrderDetailPanel: React.FC<{ orderId: string; onClose: () => void }> = ({ orderId, onClose }) => {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-order', orderId],
    queryFn: () => adminApi.getOrder(orderId),
  })

  const refund = useMutation({
    mutationFn: (itemId: string) => adminApi.refundOrderItem(orderId, itemId),
    onSuccess: (res) => {
      toast.success(res.message)
      qc.invalidateQueries({ queryKey: ['admin-order', orderId] })
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Refund failed'),
  })

  function runRefund(item: { id: string; model_name: string; total_price: string }) {
    if (!window.confirm(`Refund "${item.model_name}" (£${Number(item.total_price).toFixed(2)} + its VAT share)? This charges back through Stripe immediately and cannot be undone from here.`)) {
      return
    }
    refund.mutate(item.id)
  }

  const order = data?.order
  const items = data?.items ?? []

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {order ? `Order ${order.order_number}` : 'Order'}
          </h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent">
            <X size={20} />
          </button>
        </div>

        {isLoading || !order ? (
          <div className="flex justify-center py-24">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="space-y-6 px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</p>
                <p className="mt-1 text-sm font-medium text-foreground">{order.customer_name || '—'}</p>
                <p className="text-xs text-muted-foreground">{order.customer_email}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {formatPrice(order.total)} · {order.payment_method}
                </p>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    payBadge[order.payment_status] || 'bg-muted text-foreground'
                  }`}
                >
                  {order.payment_status}
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Items ({items.length})
              </p>
              <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                {items.map((item) => {
                  const isRefunded = !!item.refunded_at
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-muted">
                        {item.thumbnail_path && (
                          <img src={assetUrl(item.thumbnail_path)} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.model_name}
                          {item.bundle_name && <span className="ml-1 text-xs text-muted-foreground">({item.bundle_name})</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatPrice(item.total_price)}</p>
                      </div>
                      {isRefunded ? (
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          Refunded £{Number(item.refund_amount).toFixed(2)}
                        </span>
                      ) : (
                        <button
                          onClick={() => runRefund(item)}
                          disabled={refund.isPending || order.payment_status !== 'succeeded'}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {refund.isPending && refund.variables === item.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Undo2 size={14} />
                          )}
                          Refund
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminOrders
