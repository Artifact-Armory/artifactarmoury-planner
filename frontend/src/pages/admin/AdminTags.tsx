import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../../api/endpoints/admin'

const AdminTags: React.FC = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => adminApi.getPopularTags(200),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Tags</h1>
        <p className="mt-1 text-sm text-gray-500">
          Popular tags across the published catalogue (used by 3+ models), sorted by usage. Tags are
          set by artists per model — this is a read-only overview for discoverability.
        </p>
      </div>

      {isLoading && <div className="text-gray-500">Loading…</div>}
      {isError && <div className="text-red-600">Failed to load tags.</div>}

      {data && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          {data.tags.length === 0 ? (
            <p className="text-sm text-gray-500">No tags used by 3+ models yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.tags.map((t) => (
                <Link
                  key={t.tag}
                  to={`/browse?tags=${encodeURIComponent(t.tag)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-sm hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {t.tag}
                  <span className="text-xs text-gray-400">{t.usage_count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AdminTags
