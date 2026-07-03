import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { modelsApi } from '../../api/endpoints/models'
import { TerrainModel } from '../../api/types'

/** Pull a human-readable message out of an axios-style error. */
function errMessage(err: unknown, fallback: string): string {
  const anyErr = err as any
  return anyErr?.response?.data?.message || anyErr?.message || fallback
}

/** Why a draft can't be published yet, or null if it's good to go. */
function publishBlocker(m: TerrainModel): string | null {
  if (m.processingStatus && m.processingStatus !== 'ready') {
    return m.processingStatus === 'failed'
      ? 'Processing failed — re-upload this model'
      : 'Still processing…'
  }
  if (!m.thumbnailUrl) return 'Add a thumbnail before publishing'
  if ((m.description?.trim().length ?? 0) < 20) return 'Needs a description of 20+ characters'
  return null
}

const StatusBadge: React.FC<{ model: TerrainModel }> = ({ model }) => {
  const s = model.status ?? 'draft'
  const styles: Record<string, string> = {
    published: 'bg-green-100 text-green-800',
    draft: 'bg-amber-100 text-amber-800',
    archived: 'bg-gray-200 text-gray-700',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[s] ?? 'bg-gray-100 text-gray-700'}`}>
      {s}
    </span>
  )
}

const ProcessingBadge: React.FC<{ model: TerrainModel }> = ({ model }) => {
  const p = model.processingStatus
  if (!p || p === 'ready') return null
  const styles: Record<string, string> = {
    processing: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[p] ?? 'bg-gray-100 text-gray-700'}`}>
      {p === 'processing' ? 'processing…' : p}
    </span>
  )
}

const ArtistModels: React.FC = () => {
  const navigate = useNavigate()
  const [models, setModels] = React.useState<TerrainModel[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [rowError, setRowError] = React.useState<Record<string, string>>({})

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { models } = await modelsApi.getMyModels({ limit: 100 })
      setModels(models)
    } catch (err) {
      setError(errMessage(err, 'Could not load your models'))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  async function handlePublish(m: TerrainModel) {
    setBusyId(m.id)
    setRowError((r) => ({ ...r, [m.id]: '' }))
    try {
      await modelsApi.publishModel(m.id)
      await load()
    } catch (err) {
      setRowError((r) => ({ ...r, [m.id]: errMessage(err, 'Publish failed') }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleUnpublish(m: TerrainModel) {
    setBusyId(m.id)
    setRowError((r) => ({ ...r, [m.id]: '' }))
    try {
      await modelsApi.unpublishModel(m.id)
      await load()
    } catch (err) {
      setRowError((r) => ({ ...r, [m.id]: errMessage(err, 'Unpublish failed') }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(m: TerrainModel) {
    const ok = window.confirm(
      `Delete “${m.name}”?\n\nThis permanently removes the model, its files and its ` +
        `re-upload block (its geometry fingerprint), so you can upload it again later. ` +
        `Anyone who has purchased it will lose access. This cannot be undone.`,
    )
    if (!ok) return
    setBusyId(m.id)
    setRowError((r) => ({ ...r, [m.id]: '' }))
    try {
      await modelsApi.deleteModel(m.id)
      setModels((list) => list.filter((x) => x.id !== m.id))
    } catch (err) {
      setRowError((r) => ({ ...r, [m.id]: errMessage(err, 'Delete failed') }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="px-4 py-10 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My Models</h1>
          <p className="text-gray-600 mt-1">Create and manage your listings. Drafts stay here until you publish them.</p>
        </div>
        <Link to="/artist/models/new" className="px-4 py-2 rounded bg-blue-600 text-white whitespace-nowrap">
          + New model
        </Link>
      </div>

      {loading && <p className="mt-8 text-gray-500">Loading your models…</p>}
      {error && !loading && (
        <div className="mt-8">
          <p className="text-red-600">{error}</p>
          <button className="mt-2 px-3 py-1.5 rounded border" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && models.length === 0 && (
        <div className="mt-10 text-center border rounded-lg py-12">
          <p className="text-gray-600">You haven’t uploaded any models yet.</p>
          <Link to="/artist/models/new" className="inline-block mt-4 px-4 py-2 rounded bg-blue-600 text-white">
            Upload your first model
          </Link>
        </div>
      )}

      {!loading && !error && models.length > 0 && (
        <ul className="mt-6 divide-y border rounded-lg">
          {models.map((m) => {
            const blocker = publishBlocker(m)
            const isDraft = (m.status ?? 'draft') !== 'published'
            const busy = busyId === m.id
            return (
              <li key={m.id} className="flex items-center gap-4 p-4">
                <div className="w-16 h-16 rounded bg-gray-100 overflow-hidden flex-shrink-0">
                  {m.thumbnailUrl ? (
                    <img src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-gray-400 text-xs">No image</div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{m.name}</span>
                    <StatusBadge model={m} />
                    <ProcessingBadge model={m} />
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    £{m.basePrice.toFixed(2)}
                    {m.downloadCount != null && <> · {m.downloadCount} downloads</>}
                    {m.saleCount != null && <> · {m.saleCount} sales</>}
                  </p>
                  {isDraft && blocker && <p className="text-xs text-amber-700 mt-1">{blocker}</p>}
                  {rowError[m.id] && <p className="text-xs text-red-600 mt-1">{rowError[m.id]}</p>}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {m.status === 'published' && (
                    <button className="px-3 py-1.5 rounded border text-sm" onClick={() => navigate(`/models/${m.id}`)}>
                      View
                    </button>
                  )}
                  <button
                    className="px-3 py-1.5 rounded border text-sm"
                    onClick={() => navigate(`/artist/models/${m.id}/edit`)}
                    disabled={busy}
                  >
                    Edit
                  </button>
                  {isDraft ? (
                    <button
                      className="px-3 py-1.5 rounded bg-green-600 text-white text-sm disabled:opacity-50"
                      onClick={() => handlePublish(m)}
                      disabled={busy || !!blocker}
                      title={blocker ?? 'Publish to the marketplace'}
                    >
                      {busy ? 'Publishing…' : 'Publish'}
                    </button>
                  ) : (
                    <button
                      className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
                      onClick={() => handleUnpublish(m)}
                      disabled={busy}
                    >
                      {busy ? 'Working…' : 'Unpublish'}
                    </button>
                  )}
                  <button
                    className="px-3 py-1.5 rounded border border-red-300 text-red-700 text-sm disabled:opacity-50"
                    onClick={() => handleDelete(m)}
                    disabled={busy}
                  >
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

export default ArtistModels
