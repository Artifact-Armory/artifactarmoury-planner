import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { adminApi, AdminOrderRow } from '../../api/endpoints/admin'
import { formatPrice } from '../../utils/format'

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
                <tr key={o.id} className="hover:bg-accent">
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
                  <td className="px-4 py-3">
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
    </div>
  )
}

export default AdminOrders
