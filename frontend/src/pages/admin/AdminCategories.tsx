import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../../api/endpoints/admin'

const AdminCategories: React.FC = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: adminApi.getCategories,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Categories</h1>
        <p className="mt-1 text-sm text-gray-500">
          Categories in use across the published catalogue, with model counts. Categories are
          assigned by artists at upload time (from the taxonomy) — this is a read-only overview.
        </p>
      </div>

      {isLoading && <div className="text-gray-500">Loading…</div>}
      {isError && <div className="text-red-600">Failed to load categories.</div>}

      {data && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">Models</th>
                <th className="px-4 py-3 font-medium text-right">Browse</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.categories
                .filter((c) => c.category)
                .map((c) => (
                  <tr key={c.category} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 capitalize">{c.category}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.model_count}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/browse?category=${encodeURIComponent(c.category)}`}
                        className="text-indigo-600 hover:underline text-xs"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              {data.categories.filter((c) => c.category).length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                    No categories in use yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default AdminCategories
