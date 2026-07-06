import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { artistsApi } from '../../api/endpoints/artists'
import { formatPrice } from '../../utils/format'
import Spinner from '../../components/ui/Spinner'

const ArtistSales: React.FC = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['artist-sales'],
    queryFn: () => artistsApi.getSales({ limit: 100 }),
  })

  const sales = data?.sales ?? []

  return (
    <div className="px-4 py-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sales</h1>
          <p className="text-gray-600">{data?.total ?? 0} completed sale{(data?.total ?? 0) === 1 ? '' : 's'}.</p>
        </div>
        <Link to="/artist" className="text-sm text-indigo-600">← Dashboard</Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : sales.length === 0 ? (
        <p className="mt-10 rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No sales yet. When someone buys one of your models, it'll appear here.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">You earned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sales.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {s.model_id ? (
                      <Link to={`/models/${s.model_id}`} className="hover:text-indigo-600">{s.model_name}</Link>
                    ) : (
                      s.model_name
                    )}
                    {s.bundle_name && <span className="ml-1 text-xs text-gray-400">({s.bundle_name})</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.order_number}</td>
                  <td className="px-4 py-3 text-gray-500">{s.customer_email}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatPrice(s.total_price)}</td>
                  <td className="px-4 py-3 text-right font-medium text-green-700">{formatPrice(s.earnings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ArtistSales
