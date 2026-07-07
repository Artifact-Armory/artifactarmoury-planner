import React from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadsApi } from '../../api/endpoints/uploads'
import { modelsApi } from '../../api/endpoints/models'
import TermPicker from '../../components/taxonomy/TermPicker'
import FacetSelects from '../../components/taxonomy/FacetSelects'

// The headline browse facets, chosen via required dropdowns and mandatory before a
// model can be uploaded. Keys are taxonomy facet slugs; values are the UI labels.
const REQUIRED_FACET_LABELS: Record<string, string> = {
  'terrain-type': 'Model type',
  'setting-era': 'Theme / Era',
  scale: 'Scale',
  condition: 'Condition',
}
const REQUIRED_FACET_SLUGS = Object.keys(REQUIRED_FACET_LABELS)

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
  const [terms, setTerms] = React.useState<string[]>([])
  const [basePrice, setBasePrice] = React.useState('')
  const [stlFile, setStlFile] = React.useState<File | null>(null)
  const [thumbFile, setThumbFile] = React.useState<File | null>(null)
  // Extra STL parts for a multi-part "set" model (the main file above is part 1).
  const [partFiles, setPartFiles] = React.useState<File[]>([])

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
    if (partFiles.some((f) => !/\.stl$/i.test(f.name))) { setError('Every part must be an .stl file'); return }
    if (!thumbFile) { setError('Add a thumbnail image for your model'); return }
    const price = parseFloat(basePrice)
    if (!name.trim()) { setError('Give your model a name'); return }
    if (isNaN(price) || price < 0) { setError('Enter a valid base price'); return }
    const missingFacets = REQUIRED_FACET_SLUGS.filter((s) => !terms.some((t) => t.startsWith(`${s}:`)))
    if (missingFacets.length) {
      setError(`Choose a value for: ${missingFacets.map((s) => REQUIRED_FACET_LABELS[s]).join(', ')}`)
      return
    }

    try {
      setPhase('uploading')
      setProgress(0)

      // 1. Raw STL straight to R2 (quarantine prefix), with progress.
      const { key: rawKey } = await uploadsApi.uploadDirect(stlFile, 'raw', setProgress)

      // 2. Extra parts (multi-part set) — each straight to R2.
      const parts: Array<{ rawKey: string; filename: string; name: string }> = []
      for (let i = 0; i < partFiles.length; i++) {
        const f = partFiles[i]
        const p = await uploadsApi.uploadDirect(f, 'raw')
        parts.push({ rawKey: p.key, filename: f.name, name: f.name.replace(/\.stl$/i, '') })
      }

      // 3. Thumbnail (required), also direct to R2.
      const thumbnailKey = (await uploadsApi.uploadDirect(thumbFile, 'thumbnails')).key

      // 4. Create the model row; the API processes it (+ all parts) in the background.
      const created = await modelsApi.createFromUpload({
        rawKey,
        filename: stlFile.name,
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        basePrice: price,
        thumbnailKey,
        parts: parts.length ? parts : undefined,
        terms: terms.length ? terms : undefined,
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
              setPhase('form'); setName(''); setDescription(''); setTerms([]); setBasePrice('')
              setStlFile(null); setThumbFile(null); setPartFiles([]); setProgress(0); setModelId(null); setError(null)
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
            <label className="block text-sm font-medium mb-1">Base price (£)</label>
            <input type="number" min={0} step="0.01" className="w-full border rounded px-3 py-2" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} disabled={busy} />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium mb-1">
            Classification <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Tell buyers what this is — all four are required so your model shows up in the right
            searches. Tick as many as apply in each (a stone barn can be Medieval <em>and</em> WW2).
          </p>
          <FacetSelects
            facetSlugs={REQUIRED_FACET_SLUGS}
            labels={REQUIRED_FACET_LABELS}
            value={terms}
            onChange={setTerms}
            disabled={busy}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">More tags (optional)</label>
          <p className="text-xs text-gray-500 mb-2">
            Add extra tags so buyers find your model — pick several where they apply (a stone barn can
            be Medieval <em>and</em> WW2). Fields marked <span className="text-red-500">*</span> are
            required before you can publish.
          </p>
          <TermPicker
            value={terms}
            onChange={setTerms}
            disabled={busy}
            excludeFacets={REQUIRED_FACET_SLUGS}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Model file (.stl)</label>
          <input type="file" accept=".stl" onChange={(e) => setStlFile(e.target.files?.[0] ?? null)} disabled={busy} />
          {stlFile && <p className="text-sm text-gray-500 mt-1">{stlFile.name} · {(stlFile.size / 1_048_576).toFixed(1)} MB</p>}
        </div>

        <div className="rounded border border-dashed p-3">
          <label className="block text-sm font-medium mb-1">Extra parts (optional — makes this a “set”)</label>
          <p className="text-xs text-gray-500 mb-2">
            Add more STL files if this piece comes in several parts (e.g. separate floors). Buyers
            pay once, download all parts as a ZIP, and can place each part in the planner.
          </p>
          {partFiles.length > 0 && (
            <ul className="mb-2 space-y-1">
              {partFiles.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="truncate">Part {i + 2}: {f.name}</span>
                  <button
                    type="button"
                    className="text-red-600 text-xs ml-2 disabled:opacity-50"
                    onClick={() => setPartFiles((list) => list.filter((_, idx) => idx !== i))}
                    disabled={busy}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            type="file"
            accept=".stl"
            multiple
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length) setPartFiles((list) => [...list, ...files])
              e.target.value = '' // allow re-selecting the same file
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Thumbnail <span className="text-red-500">*</span></label>
          <p className="text-xs text-gray-500 mb-1">A preview image is required — it's what buyers see in the marketplace.</p>
          <input type="file" accept="image/*" onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)} disabled={busy} />
          {thumbFile && <p className="text-sm text-gray-500 mt-1">{thumbFile.name}</p>}
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
