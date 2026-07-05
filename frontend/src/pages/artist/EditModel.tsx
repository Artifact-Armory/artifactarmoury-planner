import React from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { modelsApi } from '../../api/endpoints/models'
import { TerrainModel } from '../../api/types'
import TermPicker from '../../components/taxonomy/TermPicker'
import { termToken } from '../../api/endpoints/taxonomy'

const CATEGORIES = [
  { value: 'buildings', label: 'Buildings' },
  { value: 'nature', label: 'Nature' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'props', label: 'Props' },
  { value: 'complete_sets', label: 'Complete sets' },
  { value: 'other', label: 'Other' },
]

function errMessage(err: unknown, fallback: string): string {
  const anyErr = err as any
  return anyErr?.response?.data?.message || anyErr?.message || fallback
}

const EditModel: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [model, setModel] = React.useState<TerrainModel | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [category, setCategory] = React.useState('buildings')
  const [tags, setTags] = React.useState('')
  const [terms, setTerms] = React.useState<string[]>([])
  const [basePrice, setBasePrice] = React.useState('')

  const [saving, setSaving] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      const m = await modelsApi.getModelById(id)
      setModel(m)
      setName(m.name ?? '')
      setDescription(m.description ?? '')
      setCategory(m.category ?? 'buildings')
      setTags((m.tags ?? []).join(', '))
      setTerms((m.taxonomyTerms ?? []).map((t) => termToken(t.facetSlug, t.path)))
      setBasePrice(m.basePrice != null ? String(m.basePrice) : '')
    } catch (err) {
      setLoadError(errMessage(err, 'Could not load this model'))
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    load()
  }, [load])

  const isDraft = (model?.status ?? 'draft') !== 'published'

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setError(null)
    setNotice(null)
    const price = parseFloat(basePrice)
    if (!name.trim()) { setError('Give your model a name'); return }
    if (isNaN(price) || price < 0) { setError('Enter a valid base price'); return }

    setSaving(true)
    try {
      await modelsApi.updateModel(id, {
        name: name.trim(),
        description: description.trim(),
        category,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        basePrice: price,
        terms,
      })
      setNotice('Changes saved.')
      await load()
    } catch (err) {
      setError(errMessage(err, 'Could not save changes'))
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    if (!id) return
    setError(null)
    setNotice(null)
    // Save first so publishing uses the latest edits (e.g. a longer description).
    setPublishing(true)
    try {
      await modelsApi.updateModel(id, {
        name: name.trim(),
        description: description.trim(),
        category,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        basePrice: parseFloat(basePrice) || 0,
        terms,
      })
      await modelsApi.publishModel(id)
      navigate('/artist/models')
    } catch (err) {
      setError(errMessage(err, 'Publish failed'))
      await load()
    } finally {
      setPublishing(false)
    }
  }

  if (loading) return <div className="px-4 py-10 max-w-2xl mx-auto text-gray-500">Loading…</div>
  if (loadError) {
    return (
      <div className="px-4 py-10 max-w-2xl mx-auto">
        <p className="text-red-600">{loadError}</p>
        <Link to="/artist/models" className="inline-block mt-4 text-blue-600">← Back to My Models</Link>
      </div>
    )
  }

  const busy = saving || publishing

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit Model</h1>
        <Link to="/artist/models" className="text-sm text-blue-600">← My Models</Link>
      </div>
      <p className="text-gray-600 mt-1">
        Status: <span className="font-medium">{model?.status ?? 'draft'}</span>
        {model?.processingStatus && model.processingStatus !== 'ready' && (
          <span className="ml-2 text-amber-700">({model.processingStatus})</span>
        )}
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSave}>
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input className="w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea className="w-full border rounded px-3 py-2" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
          <p className="text-xs mt-1 text-gray-500">Optional — a good description helps buyers find your model.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select className="w-full border rounded px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Base price (£)</label>
            <input type="number" min={0} step="0.01" className="w-full border rounded px-3 py-2" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} disabled={busy} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
          <input className="w-full border rounded px-3 py-2" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Tags & categories</label>
          <p className="text-xs text-gray-500 mb-2">
            Fields marked <span className="text-red-500">*</span> are required before publishing. Tag
            generously — a piece can belong to several eras and types.
          </p>
          <TermPicker value={terms} onChange={setTerms} disabled={busy} />
        </div>

        {!model?.thumbnailUrl && (
          <p className="text-xs text-amber-700">This model has no thumbnail — it must have one before it can be published.</p>
        )}
        {notice && <p className="text-sm text-green-700">{notice}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={busy}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {isDraft && (
            <button
              type="button"
              className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50"
              onClick={handlePublish}
              disabled={busy}
            >
              {publishing ? 'Publishing…' : 'Save & publish'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

export default EditModel
