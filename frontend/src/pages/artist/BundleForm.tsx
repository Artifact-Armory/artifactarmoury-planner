import React from 'react'
import { modelsApi } from '../../api/endpoints/models'
import { uploadsApi } from '../../api/endpoints/uploads'
import { TerrainModel } from '../../api/types'

export interface BundleFormValues {
  name: string
  description: string
  price: number
  modelIds: string[]
  thumbnailKey?: string
}

interface BundleFormProps {
  initial?: {
    name?: string
    description?: string
    price?: number
    modelIds?: string[]
    thumbnailUrl?: string
  }
  submitLabel: string
  onSave: (values: BundleFormValues) => Promise<void>
  /** Rendered next to the primary Save button (e.g. a Publish action). */
  extraActions?: React.ReactNode
}

/** A model can go in a bundle once it's finished processing. */
const isSellable = (m: TerrainModel) => !m.processingStatus || m.processingStatus === 'ready'

const BundleForm: React.FC<BundleFormProps> = ({ initial, submitLabel, onSave, extraActions }) => {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [description, setDescription] = React.useState(initial?.description ?? '')
  const [price, setPrice] = React.useState(initial?.price != null ? String(initial.price) : '')
  const [selected, setSelected] = React.useState<string[]>(initial?.modelIds ?? [])
  const [thumbFile, setThumbFile] = React.useState<File | null>(null)

  const [models, setModels] = React.useState<TerrainModel[]>([])
  const [loadingModels, setLoadingModels] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    modelsApi
      .getMyModels({ limit: 100 })
      .then(({ models }) => setModels(models.filter(isSellable)))
      .catch(() => setError('Could not load your models'))
      .finally(() => setLoadingModels(false))
  }, [])

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const priceNum = parseFloat(price)
    if (!name.trim()) { setError('Give your bundle a name'); return }
    if (isNaN(priceNum) || priceNum < 0) { setError('Enter a valid price'); return }
    if (selected.length < 1) { setError('Select at least one model'); return }

    setBusy(true)
    try {
      let thumbnailKey: string | undefined
      if (thumbFile) {
        const t = await uploadsApi.uploadDirect(thumbFile, 'thumbnails')
        thumbnailKey = t.key
      }
      await onSave({ name: name.trim(), description: description.trim(), price: priceNum, modelIds: selected, thumbnailKey })
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
      <div>
        <label className="block text-sm font-medium mb-1">Bundle name</label>
        <input className="w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea className="w-full border rounded px-3 py-2" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
        <p className={`text-xs mt-1 ${description.trim().length >= 20 ? 'text-gray-400' : 'text-amber-700'}`}>
          {description.trim().length}/20 characters (needed to publish)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Bundle price (£)</label>
          <input type="number" min={0} step="0.01" className="w-full border rounded px-3 py-2" value={price} onChange={(e) => setPrice(e.target.value)} disabled={busy} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Thumbnail {initial?.thumbnailUrl ? '(replace)' : ''}</label>
          <input type="file" accept="image/*" onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)} disabled={busy} />
          {initial?.thumbnailUrl && !thumbFile && (
            <img src={initial.thumbnailUrl} alt="" className="mt-2 h-16 w-16 rounded object-cover" />
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Models in this bundle ({selected.length} selected)</label>
        {loadingModels ? (
          <p className="text-sm text-gray-500">Loading your models…</p>
        ) : models.length === 0 ? (
          <p className="text-sm text-gray-500">You have no finished models yet — upload some first.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto rounded border divide-y">
            {models.map((m) => {
              const checked = selected.includes(m.id)
              return (
                <li key={m.id}>
                  <label className="flex items-center gap-3 p-2 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} disabled={busy} />
                    <div className="h-10 w-10 rounded bg-gray-100 overflow-hidden flex-shrink-0">
                      {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <span className="flex-1 truncate text-sm">{m.name}</span>
                    <span className="text-xs text-gray-500">£{m.basePrice.toFixed(2)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {extraActions}
      </div>
    </form>
  )
}

export default BundleForm
