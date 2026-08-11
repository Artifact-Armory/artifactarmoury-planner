import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { bundlesApi } from '../../api/endpoints/bundles'
import { Bundle } from '../../api/types'

function errMessage(err: unknown, fallback: string): string {
  const anyErr = err as any
  return anyErr?.response?.data?.message || anyErr?.message || fallback
}

const ArtistBundles: React.FC = () => {
  const navigate = useNavigate()
  const [bundles, setBundles] = React.useState<Bundle[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [rowError, setRowError] = React.useState<Record<string, string>>({})

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setBundles(await bundlesApi.getMyBundles())
    } catch (err) {
      setError(errMessage(err, 'Could not load your bundles'))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  async function handleUnpublish(b: Bundle) {
    setBusyId(b.id)
    try {
      await bundlesApi.unpublish(b.id)
      await load()
    } catch (err) {
      setRowError((r) => ({ ...r, [b.id]: errMessage(err, 'Unpublish failed') }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(b: Bundle) {
    if (!window.confirm(`Delete bundle “${b.name}”? This removes the bundle only — the models in it are not deleted.`)) return
    setBusyId(b.id)
    try {
      await bundlesApi.remove(b.id)
      setBundles((list) => list.filter((x) => x.id !== b.id))
    } catch (err) {
      setRowError((r) => ({ ...r, [b.id]: errMessage(err, 'Delete failed') }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="px-4 py-10 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My Bundles</h1>
          <p className="text-muted-foreground mt-1">Group several models under one price. Buyers get every STL in the bundle.</p>
        </div>
        <Link to="/artist/bundles/new" className="px-4 py-2 rounded-sm bg-primary text-primary-foreground whitespace-nowrap">
          + New bundle
        </Link>
      </div>

      {loading && <p className="mt-8 text-muted-foreground">Loading your bundles…</p>}
      {error && !loading && (
        <div className="mt-8">
          <p className="text-red-600">{error}</p>
          <button className="mt-2 px-3 py-1.5 rounded-sm border" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && bundles.length === 0 && (
        <div className="mt-10 text-center border rounded-lg py-12">
          <p className="text-muted-foreground">You haven’t created any bundles yet.</p>
          <Link to="/artist/bundles/new" className="inline-block mt-4 px-4 py-2 rounded-sm bg-primary text-primary-foreground">
            Create your first bundle
          </Link>
        </div>
      )}

      {!loading && !error && bundles.length > 0 && (
        <ul className="mt-6 divide-y border rounded-lg">
          {bundles.map((b) => {
            const busy = busyId === b.id
            const isPublished = b.status === 'published'
            return (
              <li key={b.id} className="flex items-center gap-4 p-4">
                <div className="w-16 h-16 rounded-sm bg-muted overflow-hidden shrink-0">
                  {b.thumbnailUrl ? (
                    <img src={b.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-muted-foreground text-xs">No image</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{b.name}</span>
                    <span className={`px-2 py-0.5 rounded-sm text-xs font-medium ${isPublished ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                      {b.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">£{b.price.toFixed(2)} · {b.modelCount} models</p>
                  {rowError[b.id] && <p className="text-xs text-red-600 mt-1">{rowError[b.id]}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isPublished && (
                    <button className="px-3 py-1.5 rounded-sm border text-sm" onClick={() => navigate(`/bundles/${b.id}`)}>View</button>
                  )}
                  <button className="px-3 py-1.5 rounded-sm border text-sm" onClick={() => navigate(`/artist/bundles/${b.id}/edit`)} disabled={busy}>
                    Edit
                  </button>
                  {isPublished && (
                    <button className="px-3 py-1.5 rounded-sm border text-sm disabled:opacity-50" onClick={() => handleUnpublish(b)} disabled={busy}>
                      {busy ? 'Working…' : 'Unpublish'}
                    </button>
                  )}
                  <button className="px-3 py-1.5 rounded-sm border border-red-300 text-red-700 text-sm disabled:opacity-50" onClick={() => handleDelete(b)} disabled={busy}>
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ArtistBundles
