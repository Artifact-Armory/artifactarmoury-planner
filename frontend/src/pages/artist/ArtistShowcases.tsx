import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { tablesApi } from '../../api/endpoints/tables'
import { useAuthStore } from '../../store/authStore'
import { TableLayout } from '../../api/types'

/**
 * Artist showcases — saved planners the artist builds to display their models
 * together. Only the owning artist can edit one (in the planner); buyers open
 * the read-only public page (`/tables/:id`) to add the models to their basket.
 */
const ArtistShowcases: React.FC = () => {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const email = user?.email

  const [tables, setTables] = React.useState<TableLayout[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!email) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const res = await tablesApi.getUserTables(email, 1, 100)
      setTables(res.tables)
    } catch {
      setError('Could not load your showcases')
    } finally {
      setLoading(false)
    }
  }, [email])

  React.useEffect(() => { load() }, [load])

  async function togglePublish(t: TableLayout) {
    if (!email) return
    setBusyId(t.id)
    try {
      const updated = await tablesApi.toggleVisibility(t.id, { userEmail: email, isPublic: !t.isPublic })
      setTables((list) => list.map((x) => (x.id === t.id ? { ...x, isPublic: updated.isPublic, shareToken: updated.shareToken } : x)))
      toast.success(updated.isPublic ? 'Showcase published' : 'Showcase hidden')
    } catch {
      toast.error('Could not update visibility')
    } finally {
      setBusyId(null)
    }
  }

  async function copyPublicLink(t: TableLayout) {
    if (!t.isPublic) {
      toast.error('Publish the showcase first so buyers can open it')
      return
    }
    const url = `${window.location.origin}/planner/view/${t.id}`
    await navigator.clipboard.writeText(url).catch(() => {})
    toast.success('Public showcase link copied')
  }

  async function handleDelete(t: TableLayout) {
    if (!email || !window.confirm(`Delete “${t.name}”? This cannot be undone.`)) return
    setBusyId(t.id)
    try {
      await tablesApi.deleteTable(t.id, { userEmail: email })
      setTables((list) => list.filter((x) => x.id !== t.id))
    } catch {
      toast.error('Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Showcase Tables</h1>
          <p className="mt-1 text-gray-600">
            Build a planner with your models, save it, then publish it so buyers can add the whole set — or pick pieces — to their basket.
          </p>
        </div>
        <Link
          to="/planner"
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700"
        >
          New showcase
        </Link>
      </header>

      {!email && <p className="text-gray-600">Please log in to manage your showcases.</p>}
      {email && loading && <p className="text-gray-500">Loading your showcases…</p>}
      {email && error && !loading && (
        <div><p className="text-red-600">{error}</p><button className="mt-2 rounded border px-3 py-1.5" onClick={load}>Retry</button></div>
      )}

      {email && !loading && !error && tables.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <h2 className="text-lg font-medium text-gray-900">No showcases yet</h2>
          <p className="mt-2 text-sm text-gray-600">Open the planner, place your models, and hit Save to create one.</p>
          <Link to="/planner" className="mt-6 inline-flex rounded-md bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
            Start building
          </Link>
        </div>
      )}

      {email && !loading && !error && tables.length > 0 && (
        <ul className="divide-y rounded-lg border bg-white">
          {tables.map((t) => {
            const busy = busyId === t.id
            return (
              <li key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-gray-900">{t.name}</span>
                    {t.isPublic ? (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">published</span>
                    ) : (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">draft</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Updated {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={busy} onClick={() => navigate(`/planner/t/${t.id}`)}>Open / edit</button>
                  {t.isPublic && (
                    <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => navigate(`/planner/view/${t.id}`)}>View public page</button>
                  )}
                  <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => togglePublish(t)}>{t.isPublic ? 'Unpublish' : 'Publish'}</button>
                  <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => copyPublicLink(t)}>Copy link</button>
                  <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50" disabled={busy} onClick={() => handleDelete(t)}>Delete</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ArtistShowcases
