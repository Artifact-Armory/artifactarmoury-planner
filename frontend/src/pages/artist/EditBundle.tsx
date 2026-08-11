import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import BundleForm, { BundleFormValues } from './BundleForm'
import { bundlesApi } from '../../api/endpoints/bundles'
import { Bundle } from '../../api/types'

/** Why a bundle can't be published yet, or null if it's good to go. */
function publishBlocker(b: Bundle): string | null {
  if (!b.thumbnailUrl) return 'Add a thumbnail and Save before publishing'
  if ((b.description?.trim().length ?? 0) < 20) return 'Needs a description of 20+ characters (Save first)'
  if (b.price <= 0) return 'Set a price greater than 0 (Save first)'
  if (b.modelCount < 2) return 'A bundle needs at least 2 models (Save first)'
  return null
}

const EditBundle: React.FC = () => {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [bundle, setBundle] = React.useState<Bundle | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [rowError, setRowError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [savedNote, setSavedNote] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      setBundle(await bundlesApi.getById(id))
    } catch {
      setError('Could not load this bundle')
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => { load() }, [load])

  async function handleSave(values: BundleFormValues) {
    if (!id) return
    await bundlesApi.update(id, values)
    setSavedNote(true)
    await load()
  }

  async function handlePublish() {
    if (!id) return
    setBusy(true)
    setRowError(null)
    try {
      await bundlesApi.publish(id)
      navigate('/artist/bundles')
    } catch (err: any) {
      setRowError(err?.response?.data?.message || 'Publish failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleUnpublish() {
    if (!id) return
    setBusy(true)
    try {
      await bundlesApi.unpublish(id)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="px-4 py-10 max-w-2xl mx-auto text-muted-foreground">Loading…</div>
  if (error || !bundle) return <div className="px-4 py-10 max-w-2xl mx-auto text-red-600">{error ?? 'Not found'}</div>

  const isPublished = bundle.status === 'published'
  const blocker = publishBlocker(bundle)

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit Bundle</h1>
        <span className={`px-2 py-0.5 rounded-sm text-xs font-medium ${isPublished ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
          {bundle.status}
        </span>
      </div>

      <BundleForm
        initial={{
          name: bundle.name,
          description: bundle.description ?? '',
          price: bundle.price,
          modelIds: bundle.models.map((m) => m.id),
          thumbnailUrl: bundle.thumbnailUrl,
        }}
        submitLabel="Save changes"
        onSave={handleSave}
        extraActions={
          isPublished ? (
            <button type="button" className="px-4 py-2 rounded-sm border disabled:opacity-50" onClick={handleUnpublish} disabled={busy}>
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              className="px-4 py-2 rounded-sm bg-green-600 text-white disabled:opacity-50"
              onClick={handlePublish}
              disabled={busy || !!blocker}
              title={blocker ?? 'Publish to the marketplace'}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
          )
        }
      />

      {savedNote && <p className="mt-2 text-xs text-green-700">Saved.</p>}
      {!isPublished && blocker && <p className="mt-2 text-xs text-amber-700">{blocker}</p>}
      {rowError && <p className="mt-2 text-sm text-red-600">{rowError}</p>}
    </div>
  )
}

export default EditBundle
