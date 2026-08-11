import React from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { releasesApi, Release, ReleaseItem, ReleaseItemType } from '../../api/endpoints/releases'
import { modelsApi } from '../../api/endpoints/models'
import { bundlesApi } from '../../api/endpoints/bundles'
import { tablesApi } from '../../api/endpoints/tables'
import { useAuthStore } from '../../store/authStore'

function errMessage(err: unknown, fallback: string): string {
  const anyErr = err as any
  return anyErr?.response?.data?.message || anyErr?.message || fallback
}

interface PickRow { id: string; name: string; status?: string }

/** ISO → value for <input type="datetime-local"> (local time, minute precision). */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const TYPE_LABELS: Record<ReleaseItemType, string> = { model: 'Models', bundle: 'Bundles', table: 'Tables' }

const EditRelease: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [release, setRelease] = React.useState<Release | null>(null)
  const [items, setItems] = React.useState<ReleaseItem[]>([])
  const [name, setName] = React.useState('')
  const [dateInput, setDateInput] = React.useState('')
  const [pickers, setPickers] = React.useState<Record<ReleaseItemType, PickRow[]>>({ model: [], bundle: [], table: [] })

  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const r = await releasesApi.getById(id)
      setRelease(r)
      setName(r.name)
      setDateInput(toLocalInput(r.scheduledAt))
      setItems(r.items ?? [])
    } catch (err) {
      setError(errMessage(err, 'Could not load this release'))
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadPickers = React.useCallback(async () => {
    const [models, bundles, tables] = await Promise.all([
      modelsApi.getMyModels({ limit: 200 }).then((r) => r.models.map((m) => ({ id: m.id, name: m.name, status: (m as any).status }))).catch(() => []),
      bundlesApi.getMyBundles().then((bs) => bs.map((b) => ({ id: b.id, name: b.name, status: (b as any).status }))).catch(() => []),
      user?.email ? tablesApi.getUserTables(user.email, 1, 200).then((r) => r.tables.map((t: any) => ({ id: t.id, name: t.name }))).catch(() => []) : Promise.resolve([]),
    ])
    setPickers({ model: models, bundle: bundles, table: tables })
  }, [user?.email])

  React.useEffect(() => { load() }, [load])
  React.useEffect(() => { loadPickers() }, [loadPickers])

  const locked = release?.status === 'published'
  const inRelease = (type: ReleaseItemType, itemId: string) => items.find((i) => i.itemType === type && i.itemId === itemId)

  async function toggle(type: ReleaseItemType, itemId: string) {
    if (!id || locked) return
    setError(null)
    try {
      const existing = inRelease(type, itemId)
      const next = existing
        ? await releasesApi.removeItem(id, existing.id)
        : await releasesApi.addItem(id, type, itemId)
      setItems(next)
    } catch (err) {
      setError(errMessage(err, 'Could not update the release'))
    }
  }

  async function saveMeta() {
    if (!id) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await releasesApi.update(id, { name: name.trim(), scheduledAt: dateInput ? new Date(dateInput).toISOString() : null })
      setRelease(r); setNotice('Saved.')
    } catch (err) {
      setError(errMessage(err, 'Could not save'))
    } finally { setBusy(false) }
  }

  async function doSchedule() {
    if (!id) return
    if (!dateInput) { setError('Pick a date and time first'); return }
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await releasesApi.schedule(id, new Date(dateInput).toISOString())
      setRelease(r); setNotice('Scheduled — everything in this release will go live automatically.')
      await load()
    } catch (err) {
      setError(errMessage(err, 'Could not schedule the release'))
    } finally { setBusy(false) }
  }

  async function doUnschedule() {
    if (!id) return
    setBusy(true); setError(null)
    try { setRelease(await releasesApi.unschedule(id)) }
    catch (err) { setError(errMessage(err, 'Could not unschedule')) }
    finally { setBusy(false) }
  }

  async function doPublishNow() {
    if (!id) return
    if (!window.confirm('Publish everything in this release right now?')) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await releasesApi.publishNow(id)
      setRelease(r); setItems(r.items ?? []); setNotice('Published!')
    } catch (err) {
      setError(errMessage(err, 'Could not publish the release'))
    } finally { setBusy(false) }
  }

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-8 text-gray-500">Loading…</div>
  if (!release) return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <p className="text-red-600">{error || 'Release not found'}</p>
      <Link to="/artist/releases" className="inline-block mt-4 text-indigo-600">← Back to Releases</Link>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Edit Release</h1>
        <Link to="/artist/releases" className="text-sm text-indigo-600">← Releases</Link>
      </div>
      <p className="text-gray-600 mt-1">Status: <span className="font-medium">{release.status}</span></p>

      {locked && (
        <div className="mt-4 rounded-sm bg-green-50 text-green-800 text-sm px-3 py-2">
          This release has gone live and can no longer be edited.
        </div>
      )}

      {/* Name + schedule time */}
      <div className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Release name</label>
          <input className="w-full border rounded-sm px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} disabled={busy || locked} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Go-live date &amp; time</label>
          <input type="datetime-local" className="border rounded-sm px-3 py-2" value={dateInput} onChange={(e) => setDateInput(e.target.value)} disabled={busy || locked} />
          <p className="text-xs text-gray-500 mt-1">Uses your local time zone.</p>
        </div>

        {notice && <p className="text-sm text-green-700">{notice}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!locked && (
          <div className="flex flex-wrap gap-3">
            <button onClick={saveMeta} className="px-4 py-2 rounded-sm bg-gray-800 text-white disabled:opacity-50" disabled={busy}>Save</button>
            {release.status === 'scheduled' ? (
              <button onClick={doUnschedule} className="px-4 py-2 rounded-sm border disabled:opacity-50" disabled={busy}>Unschedule</button>
            ) : (
              <button onClick={doSchedule} className="px-4 py-2 rounded-sm bg-amber-500 text-white disabled:opacity-50" disabled={busy}>Schedule drop</button>
            )}
            <button onClick={doPublishNow} className="px-4 py-2 rounded-sm bg-green-600 text-white disabled:opacity-50" disabled={busy}>Publish now</button>
          </div>
        )}
      </div>

      {/* Items currently in the release */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900">In this release ({items.length})</h2>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500 mt-1">Nothing added yet — pick items below.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between border rounded-sm px-3 py-2">
                <div>
                  <span className="text-xs uppercase text-gray-400 mr-2">{it.itemType}</span>
                  <span className="text-gray-900">{it.name}</span>
                  {it.publishError && <span className="block text-xs text-red-600">{it.publishError}</span>}
                </div>
                {!locked && <button onClick={() => toggle(it.itemType, it.itemId)} className="text-sm text-red-600">Remove</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pickers */}
      {!locked && (
        <div className="mt-8 space-y-6">
          {(Object.keys(TYPE_LABELS) as ReleaseItemType[]).map((type) => (
            <div key={type}>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">{TYPE_LABELS[type]}</h3>
              {pickers[type].length === 0 ? (
                <p className="text-sm text-gray-400">You have no {TYPE_LABELS[type].toLowerCase()} to add.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {pickers[type].map((row) => {
                    const added = !!inRelease(type, row.id)
                    return (
                      <button
                        key={row.id}
                        onClick={() => toggle(type, row.id)}
                        className={`flex items-center justify-between border rounded-sm px-3 py-2 text-left ${added ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'}`}
                      >
                        <span className="truncate">
                          {row.name}
                          {row.status && row.status !== 'published' && <span className="ml-2 text-xs text-amber-600">({row.status})</span>}
                        </span>
                        <span className={`text-xs ${added ? 'text-indigo-700' : 'text-gray-400'}`}>{added ? '✓ Added' : 'Add'}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default EditRelease
