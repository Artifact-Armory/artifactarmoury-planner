import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { tablesApi } from '../../api/endpoints/tables'
import { useAuthStore } from '../../store/authStore'
import { TableLayout } from '../../api/types'

const MyTables: React.FC = () => {
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
      setError('Could not load your tables')
    } finally {
      setLoading(false)
    }
  }, [email])

  React.useEffect(() => { load() }, [load])

  async function handleShare(t: TableLayout) {
    if (!email) return
    setBusyId(t.id)
    try {
      let token = t.shareToken
      // The shared route only serves public tables — make it public on first share.
      if (!t.isPublic) {
        const updated = await tablesApi.toggleVisibility(t.id, { userEmail: email, isPublic: true })
        token = updated.shareToken
        setTables((list) => list.map((x) => (x.id === t.id ? { ...x, isPublic: true, shareToken: token } : x)))
      }
      const url = `${window.location.origin}/planner/s/${token}`
      await navigator.clipboard.writeText(url).catch(() => {})
      toast.success('Share link copied — anyone can open an editable copy')
    } catch {
      toast.error('Could not create share link')
    } finally {
      setBusyId(null)
    }
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
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My Table Layouts</h1>
          <p className="text-gray-600 mt-1">Your saved tabletop layouts. Open one to keep editing, or share a link.</p>
        </div>
        <Link
          to="/planner"
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700"
        >
          Open Builder
        </Link>
      </header>

      {!email && <p className="text-gray-600">Please log in to see your saved tables.</p>}
      {email && loading && <p className="text-gray-500">Loading your tables…</p>}
      {email && error && !loading && (
        <div><p className="text-red-600">{error}</p><button className="mt-2 rounded border px-3 py-1.5" onClick={load}>Retry</button></div>
      )}

      {email && !loading && !error && tables.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <h2 className="text-lg font-medium text-gray-900">No saved tables yet</h2>
          <p className="mt-2 text-sm text-gray-600">Design a table in the builder and hit Save to keep it here.</p>
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
              <li key={t.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">{t.name}</span>
                    {t.isPublic && <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">shared</span>}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Updated {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={busy} onClick={() => navigate(`/planner/t/${t.id}`)}>Open</button>
                  <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => handleShare(t)}>Share link</button>
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

export default MyTables
