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
        <h1 className="text-2xl font-semibold text-foreground">Tags</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Popular tags across the published catalogue (used by 3+ models), sorted by usage. Tags are
          set by artists per model — this is a read-only overview for discoverability.
        </p>
      </div>

      {isLoading && <div className="text-muted-foreground">Loading…</div>}
      {isError && <div className="text-red-600">Failed to load tags.</div>}

      {data && (
        <div className="bg-card border border-border rounded-lg p-5">
          {data.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tags used by 3+ models yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.tags.map((t) => (
                <Link
                  key={t.tag}
                  to={`/browse?tags=${encodeURIComponent(t.tag)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-foreground text-sm hover:bg-primary/10 hover:text-primary"
                >
                  {t.tag}
                  <span className="text-xs text-muted-foreground">{t.usage_count}</span>
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
