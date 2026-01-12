import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ordersApi } from '../../api/endpoints/orders'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { formatPrice } from '../../utils/format'

const PurchaseHistory: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const pageParam = Number(searchParams.get('page') ?? 1)

  const ordersQuery = useQuery({
    queryKey: ['my-orders', { page: pageParam, limit: 10 }],
    queryFn: () => ordersApi.getMyOrders(pageParam, 10),
    placeholderData: (previousData) => previousData,
  })

  const orders = ordersQuery.data?.orders ?? []
  const pagination = ordersQuery.data?.pagination
  const totalPages = pagination?.totalPages ?? 1

  const handlePageChange = (direction: 'prev' | 'next') => {
    const current = pagination?.page ?? pageParam
    const nextPage = direction === 'prev' ? Math.max(1, current - 1) : Math.min(totalPages, current + 1)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('page', String(nextPage))
    setSearchParams(nextParams)
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold text-gray-900">Purchase history</h1>
        <p className="mt-2 text-sm text-gray-600">All of your digital orders and print requests in one place.</p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        {ordersQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : orders.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Order</th>
                  <th className="px-4 py-3 text-left">Placed</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Items</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <p className="font-medium text-gray-900">#{order.orderNumber}</p>
                      {order.trackingNumber && (
                        <p className="text-xs text-gray-500">Tracking: {order.trackingNumber}</p>
                      )}
                    </td>
                    <td className="px-4 py-4 text-gray-600">
                      {new Date(order.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                        {order.fulfillmentStatus ?? 'processing'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right text-gray-600">{order.itemCount}</td>
                    <td className="px-4 py-4 text-right font-medium text-gray-900">
                      {formatPrice(order.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-gray-700">No orders yet.</p>
            <p className="mt-2 text-xs text-gray-500">Start browsing models to place your first order.</p>
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" onClick={() => handlePageChange('prev')} disabled={(pagination?.page ?? 1) <= 1}>
            Previous
          </Button>
          <span className="text-sm text-gray-600">
            Page {pagination?.page ?? pageParam} of {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={() => handlePageChange('next')}
            disabled={(pagination?.page ?? 1) >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

export default PurchaseHistory
