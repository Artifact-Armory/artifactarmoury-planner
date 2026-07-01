import React from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadsApi } from '../../api/endpoints/uploads'
import { modelsApi } from '../../api/endpoints/models'

const CATEGORIES = [
  { value: 'buildings', label: 'Buildings' },
  { value: 'nature', label: 'Nature' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'props', label: 'Props' },
  { value: 'complete_sets', label: 'Complete sets' },
  { value: 'other', label: 'Other' },
]

type Phase = 'form' | 'uploading' | 'processing' | 'done' | 'error'

const CreateModel: React.FC = () => {
  const navigate = useNavigate()

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [category, setCategory] = React.useState('buildings')
  const [tags, setTags] = React.useState('')
  const [basePrice, setBasePrice] = React.useState('')
  const [fulfillmentType, setFulfillmentType] = React.useState<'print' | 'stl'>('print')
  const [stlFile, setStlFile] = React.useState<File | null>(null)
  const [thumbFile, setThumbFile] = React.useState<File | null>(null)

  const [phase, setPhase] = React.useState<Phase>('form')
  const [progress, setProgress] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [modelId, setModelId] = React.useState<string | null>(null)

  const busy = phase === 'uploading' || phase === 'processing'

  async function pollUntilDone(id: string): Promise<void> {
    // Poll the background processor until it finishes or fails (~5 min cap).
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const s = await modelsApi.getProcessingStatus(id)
      if (s.processingStatus === 'ready') return
      if (s.processingStatus === 'failed') throw new Error(s.processingError || 'Processing failed')
    }
    throw new Error('Processing timed out — check the model in your dashboard shortly')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!stlFile) { setError('Choose an STL file to upload'); return }
    if (!/\.stl$/i.test(stlFile.name)) { setError('The model file must be an .stl'); return }
    const price = parseFloat(basePrice)
    if (!name.trim()) { setError('Give your model a name'); return }
    if (isNaN(price) || price < 0) { setError('Enter a valid base price'); return }

    try {
      setPhase('uploading')
      setProgress(0)

      // 1. Raw STL straight to R2 (quarantine prefix), with progress.
      const { key: rawKey } = await uploadsApi.uploadDirect(stlFile, 'raw', setProgress)

      // 2. Optional thumbnail, also direct to R2.
      let thumbnailKey: string | undefined
      if (thumbFile) {
        const t = await uploadsApi.uploadDirect(thumbFile, 'thumbnails')
        thumbnailKey = t.key
      }

      // 3. Create the model row; the API processes it in the background.
      const created = await modelsApi.createFromUpload({
        rawKey,
        filename: stlFile.name,
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        tags: tags.trim() || undefined,
        basePrice: price,
        fulfillmentType,
        thumbnailKey,
      })
      setModelId(created.id)

      // 4. Wait for processing (STL→GLB, geometry, print estimate).
      setPhase('processing')
      await pollUntilDone(created.id)
      setPhase('done')
    } catch (err) {
      setError((err as Error).message || 'Something went wrong')
      setPhase('error')
    }
  }

  if (phase === 'done') {
    return (
      <div className="px-4 py-10 max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold">Model ready 🎉</h1>
        <p className="text-gray-600 mt-2">
          Your model was processed successfully. It’s saved as a <strong>draft</strong> — publish it
          when you’re ready for buyers to see it.
        </p>
        <div className="mt-6 flex gap-3">
          {modelId && (
            <button
              className="px-4 py-2 rounded bg-blue-600 text-white"
              onClick={() => navigate(`/models/${modelId}`)}
            >
              View model
            </button>
          )}
          <button
            className="px-4 py-2 rounded border"
            onClick={() => {
              setPhase('form'); setName(''); setDescription(''); setTags(''); setBasePrice('')
              setStlFile(null); setThumbFile(null); setProgress(0); setModelId(null); setError(null)
            }}
          >
            Upload another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold">Create Model</h1>
      <p className="text-gray-600 mt-1">Upload an STL and details. We’ll generate the 3D preview and print estimate for you.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input className="w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea className="w-full border rounded px-3 py-2" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select className="w-full border rounded px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Fulfillment</label>
            <select className="w-full border rounded px-3 py-2" value={fulfillmentType} onChange={(e) => setFulfillmentType(e.target.value as 'print' | 'stl')} disabled={busy}>
              <option value="print">We print &amp; ship</option>
              <option value="stl">STL download</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Base price (£)</label>
            <input type="number" min={0} step="0.01" className="w-full border rounded px-3 py-2" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
            <input className="w-full border rounded px-3 py-2" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Model file (.stl)</label>
          <input type="file" accept=".stl" onChange={(e) => setStlFile(e.target.files?.[0] ?? null)} disabled={busy} />
          {stlFile && <p className="text-sm text-gray-500 mt-1">{stlFile.name} · {(stlFile.size / 1_048_576).toFixed(1)} MB</p>}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Thumbnail (optional)</label>
          <input type="file" accept="image/*" onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)} disabled={busy} />
        </div>

        {phase === 'uploading' && (
          <div>
            <div className="h-2 rounded bg-gray-200 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <p className="text-sm text-gray-500 mt-1">Uploading… {progress}%</p>
          </div>
        )}
        {phase === 'processing' && (
          <p className="text-sm text-gray-600">Uploaded. Processing your model (generating preview + print estimate)…</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={busy}>
          {phase === 'uploading' ? 'Uploading…' : phase === 'processing' ? 'Processing…' : 'Upload model'}
        </button>
      </form>
    </div>
  )
}

export default CreateModel
