import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { releasesApi, Release, ReleaseStatus } from '../../api/endpoints/releases'

function errMessage(err: unknown, fallback: string): string {
  const anyErr = err as any
  return anyErr?.response?.data?.message || anyErr?.message || fallback
}

const STATUS_STYLES: Record<ReleaseStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-700',
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

const ArtistReleases: React.FC = () => {
  const navigate = useNavigate()
  const [releases, setReleases] = React.useState<Release[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [newName, setNewName] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setReleases(await releasesApi.list())
    } catch (err) {
      setError(errMessage(err, 'Could not load your releases'))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const r = await releasesApi.create(newName.trim())
      navigate(`/artist/releases/${r.id}`)
    } catch (err) {
      setError(errMessage(err, 'Could not create the release'))
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this release? The models/bundles/tables in it keep their current status — only the grouping is removed.')) return
    try {
      await releasesApi.remove(id)
      setReleases((rs) => rs.filter((r) => r.id !== id))
    } catch (err) {
      setError(errMessage(err, 'Could not delete the release'))
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Releases</h1>
      <p className="text-gray-600 mt-1">
        Group models, bundles and tables into a scheduled “drop” — they all go live together at the
        time you set. Until then they stay as drafts.
      </p>

      <form onSubmit={handleCreate} className="mt-6 flex gap-2">
        <input
          className="flex-1 border rounded-sm px-3 py-2"
          placeholder="New release name (e.g. “Winter Ruins Drop”)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={creating}
        />
        <button type="submit" className="px-4 py-2 rounded-sm bg-indigo-600 text-white disabled:opacity-50" disabled={creating || !newName.trim()}>
          {creating ? 'Creating…' : 'New release'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : releases.length === 0 ? (
          <p className="text-gray-500">No releases yet. Create one above to schedule a drop.</p>
        ) : (
          releases.map((r) => (
            <div key={r.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <Link to={`/artist/releases/${r.id}`} className="font-medium text-gray-900 hover:text-indigo-700">
                    {r.name}
                  </Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                </div>
                <div className="text-sm text-gray-500 mt-0.5">
                  {r.itemCount ?? 0} item{(r.itemCount ?? 0) === 1 ? '' : 's'}
                  {r.status === 'scheduled' && <> · goes live {fmt(r.scheduledAt)}</>}
                  {r.status === 'published' && <> · published {fmt(r.publishedAt)}</>}
                </div>
                {r.publishError && <div className="text-xs text-red-600 mt-1">Some items didn’t publish: {r.publishError}</div>}
              </div>
              <div className="flex items-center gap-3">
                <Link to={`/artist/releases/${r.id}`} className="text-sm text-indigo-600">Manage</Link>
                {r.status !== 'published' && (
                  <button onClick={() => handleDelete(r.id)} className="text-sm text-red-600">Delete</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ArtistReleases
