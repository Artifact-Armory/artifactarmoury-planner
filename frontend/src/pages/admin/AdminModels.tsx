import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { adminApi } from '../../api/endpoints/admin'
import { assetUrl } from '../../api/transformers'
import { formatPrice } from '../../utils/format'

const AdminModels: React.FC = () => {
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'models', { search, page }],
    queryFn: () => adminApi.listModels({ search: search || undefined, page, limit: 24 }),
  })

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Published catalogue. For flagged/reported items use the{' '}
            <Link to="/admin/moderation" className="text-primary hover:underline">
              moderation queue
            </Link>
            .
          </p>
        </div>
        <form onSubmit={onSearch} className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search models…"
            className="pl-9 pr-3 py-2 text-sm border border-border rounded-md w-64 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </form>
      </div>

      {isLoading && <div className="text-muted-foreground">Loading…</div>}
      {isError && <div className="text-red-600">Failed to load models.</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {data.models.map((m: any) => (
              <Link
                key={m.id}
                to={`/models/${m.id}`}
                className="bg-card border border-border rounded-lg overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="aspect-square bg-muted">
                  {m.thumbnail_path ? (
                    <img
                      src={assetUrl(m.thumbnail_path)}
                      alt={m.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                      No image
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="text-sm font-medium text-foreground truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {m.artist_name || 'Unknown artist'}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {formatPrice(m.base_price ?? 0)}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {data.models.length === 0 && (
            <div className="text-center text-muted-foreground py-8">No models found.</div>
          )}

          {data.pagination.pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total}{' '}
                models
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
        </>
      )}
    </div>
  )
}

export default AdminModels
