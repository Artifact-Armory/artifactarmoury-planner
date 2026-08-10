import React from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { modelsApi } from '../../api/endpoints/models'
import { uploadsApi } from '../../api/endpoints/uploads'
import { TerrainModel } from '../../api/types'
import TermPicker from '../../components/taxonomy/TermPicker'
import { withPrinterTypeTerm, withLicenceTerm, PRINT_PROCESS_PATH, LICENCE_FACET } from '../../utils/derivedTerms'
import { termToken, MODEL_CLASS_SLUG } from '../../api/endpoints/taxonomy'
import { LICENSE_OPTIONS, licenseInfo } from '../../utils/licenses'
import { PRINTER_TYPE_OPTIONS, meshQualitySummary } from '../../utils/printability'
import ModelOrientationPreview from '../../components/ModelOrientationPreview'

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
  const [license, setLicense] = React.useState<'personal' | 'commercial'>('personal')
  const [printerType, setPrinterType] = React.useState<'' | 'fdm' | 'resin' | 'both'>('')
  const [supportsRequired, setSupportsRequired] = React.useState(false)
  const [layerHeight, setLayerHeight] = React.useState('')
  const [infill, setInfill] = React.useState('')
  // Default tilt applied in the 3D planner so the model stands upright (0/90/180/270).
  const [defaultPitch, setDefaultPitch] = React.useState(0)

  // The model's class (set at upload) — scopes which facets the tag picker shows.
  const modelClass = React.useMemo(() => {
    const tok = terms.find((t) => t.startsWith(`${MODEL_CLASS_SLUG}:`))
    return tok ? tok.slice(MODEL_CLASS_SLUG.length + 1) : 'terrain'
  }, [terms])

  // Thumbnail: `thumbFile` is a freshly-picked image not yet uploaded; on save we
  // presign it to R2 and send the resulting key. `thumbPreview` is a local object URL.
  const [thumbFile, setThumbFile] = React.useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = React.useState<string | null>(null)

  const [saving, setSaving] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // New-version upload (replaces the primary file; owners re-download free).
  const [versionFile, setVersionFile] = React.useState<File | null>(null)
  const [versionNotes, setVersionNotes] = React.useState('')
  const [versionBusy, setVersionBusy] = React.useState(false)
  const [versionMsg, setVersionMsg] = React.useState<string | null>(null)
  const [versionErr, setVersionErr] = React.useState<string | null>(null)

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
      setLicense(m.license === 'commercial' ? 'commercial' : 'personal')
      setPrinterType((m.printerType ?? '') as '' | 'fdm' | 'resin' | 'both')
      setSupportsRequired(Boolean(m.supportsRequired))
      setLayerHeight(m.recommendedLayerHeight != null ? String(m.recommendedLayerHeight) : '')
      setInfill(m.recommendedInfill != null ? String(m.recommendedInfill) : '')
      setDefaultPitch(Number(m.defaultPitchDeg ?? 0))
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
  // A model is publishable only once it has a thumbnail — either an existing one or
  // a freshly-picked file about to be uploaded.
  const hasThumbnail = Boolean(model?.thumbnailUrl) || Boolean(thumbFile)

  function onPickThumb(file: File | null) {
    setThumbFile(file)
    setThumbPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }

  // Clean up the object URL on unmount.
  React.useEffect(() => () => { if (thumbPreview) URL.revokeObjectURL(thumbPreview) }, [thumbPreview])

  /** Upload a freshly-picked thumbnail to R2 (if any) and return its key. */
  async function uploadThumbIfNeeded(): Promise<string | undefined> {
    if (!thumbFile) return undefined
    const { key } = await uploadsApi.uploadDirect(thumbFile, 'thumbnails')
    return key
  }

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
      const thumbnailKey = await uploadThumbIfNeeded()
      await modelsApi.updateModel(id, {
        name: name.trim(),
        description: description.trim(),
        category,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        basePrice: price,
        license,
        printerType,
        supportsRequired,
        recommendedLayerHeight: layerHeight.trim() === '' ? null : Number(layerHeight),
        recommendedInfill: infill.trim() === '' ? null : Number(infill),
        defaultPitchDeg: defaultPitch,
        terms: withLicenceTerm(withPrinterTypeTerm(terms, printerType), license),
        thumbnailKey,
      })
      onPickThumb(null)
      setNotice('Changes saved.')
      await load()
    } catch (err) {
      setError(errMessage(err, 'Could not save changes'))
    } finally {
      setSaving(false)
    }
  }

  async function pollProcessing(modelId: string): Promise<void> {
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const s = await modelsApi.getProcessingStatus(modelId)
      if (s.processingStatus === 'ready') return
      if (s.processingStatus === 'failed') throw new Error(s.processingError || 'Processing failed')
    }
    throw new Error('Processing timed out — check the model shortly')
  }

  async function handleNewVersion(e: React.FormEvent) {
    e.preventDefault()
    if (!id || !versionFile) return
    setVersionErr(null)
    setVersionMsg(null)
    setVersionBusy(true)
    try {
      const { key } = await uploadsApi.uploadDirect(versionFile, 'raw')
      await modelsApi.uploadNewVersion(id, {
        rawKey: key,
        filename: versionFile.name,
        notes: versionNotes.trim() || undefined,
      })
      await pollProcessing(id)
      // A dedup/geometry rejection is recorded as processing_error but leaves the
      // model 'ready' with the OLD file — surface it rather than claiming success.
      const refreshed = await modelsApi.getModelById(id)
      const rejected = refreshed.processingError
      setVersionFile(null)
      setVersionNotes('')
      if (rejected) {
        setVersionErr(rejected)
      } else {
        setVersionMsg('New version published. Owners have been notified and can re-download it free.')
      }
      await load()
    } catch (err) {
      setVersionErr(errMessage(err, 'Could not upload the new version'))
    } finally {
      setVersionBusy(false)
    }
  }

  async function handlePublish() {
    if (!id) return
    setError(null)
    setNotice(null)
    // Save first so publishing uses the latest edits (e.g. a longer description).
    setPublishing(true)
    try {
      const thumbnailKey = await uploadThumbIfNeeded()
      await modelsApi.updateModel(id, {
        name: name.trim(),
        description: description.trim(),
        category,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        basePrice: parseFloat(basePrice) || 0,
        license,
        printerType,
        supportsRequired,
        recommendedLayerHeight: layerHeight.trim() === '' ? null : Number(layerHeight),
        recommendedInfill: infill.trim() === '' ? null : Number(infill),
        defaultPitchDeg: defaultPitch,
        terms: withLicenceTerm(withPrinterTypeTerm(terms, printerType), license),
        thumbnailKey,
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
          {/* Sub-category only applies to terrain; vehicles/characters store their class. */}
          {modelClass === 'terrain' && (
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select className="w-full border rounded px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Base price (£)</label>
            <input type="number" min={0} step="0.01" className="w-full border rounded px-3 py-2" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} disabled={busy} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Usage licence</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={license}
            onChange={(e) => setLicense(e.target.value as 'personal' | 'commercial')}
            disabled={busy}
          >
            {LICENSE_OPTIONS.map((l) => (
              <option key={l.value} value={l.value}>{l.label} — {l.short}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">{licenseInfo(license).description}</p>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <p className="text-sm font-medium">Printability</p>

          {/* Mesh QA result (read-only, from processing). */}
          {model && (() => {
            const mq = meshQualitySummary(model)
            if (!mq) return null
            return (
              <p className={`text-xs ${mq.tone === 'good' ? 'text-green-700' : 'text-amber-700'}`}>
                {mq.tone === 'good' ? '✓ ' : '⚠ '}
                <span className="font-medium">{mq.label}.</span> {mq.detail}
              </p>
            )
          })()}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">Printer type</label>
              <select
                className="w-full border rounded px-3 py-2"
                value={printerType}
                onChange={(e) => setPrinterType(e.target.value as '' | 'fdm' | 'resin' | 'both')}
                disabled={busy}
              >
                <option value="">Not specified</option>
                {PRINTER_TYPE_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={supportsRequired}
                onChange={(e) => setSupportsRequired(e.target.checked)}
                disabled={busy}
              />
              Supports required
            </label>
            <div>
              <label className="block text-sm mb-1">Recommended layer height (mm)</label>
              <input type="number" min={0} step="0.01" className="w-full border rounded px-3 py-2" value={layerHeight} onChange={(e) => setLayerHeight(e.target.value)} disabled={busy} placeholder="0.2" />
            </div>
            <div>
              <label className="block text-sm mb-1">Recommended infill (%)</label>
              <input type="number" min={0} max={100} step="1" className="w-full border rounded px-3 py-2" value={infill} onChange={(e) => setInfill(e.target.value)} disabled={busy} placeholder="20" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-sm font-medium">Planner orientation</p>
          <p className="text-xs text-gray-500 mt-1">
            If your model imports lying on its side in the 3D planner, pick the tilt that
            stands it upright — the live preview below sits it on the table exactly as buyers
            will see it. This is applied automatically whenever a buyer places it; the
            downloadable STL is never changed.
          </p>
          <ModelOrientationPreview url={model?.glbUrl} pitchDeg={defaultPitch} className="mt-3 relative w-full h-56 rounded border bg-gradient-to-b from-slate-50 to-slate-100 overflow-hidden" />
          <div className="mt-2 flex flex-wrap gap-2">
            {[0, 90, 180, 270].map((deg) => (
              <button
                key={deg}
                type="button"
                onClick={() => setDefaultPitch(deg)}
                disabled={busy}
                className={`px-3 py-1.5 rounded border text-sm ${
                  defaultPitch === deg
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {deg === 0 ? 'Default (no tilt)' : `Tilt ${deg}°`}
              </button>
            ))}
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
          <TermPicker
            value={terms}
            onChange={setTerms}
            disabled={busy}
            excludeFacets={[LICENCE_FACET]}
            excludeTermPaths={[PRINT_PROCESS_PATH]}
            modelClass={modelClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Thumbnail</label>
          <div className="flex items-center gap-4">
            {(thumbPreview || model?.thumbnailUrl) ? (
              <img
                src={thumbPreview || model?.thumbnailUrl}
                alt="Thumbnail preview"
                className="h-20 w-20 rounded object-cover border"
              />
            ) : (
              <div className="h-20 w-20 rounded border border-dashed flex items-center justify-center text-xs text-gray-400 text-center">
                No image
              </div>
            )}
            <div>
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => onPickThumb(e.target.files?.[0] ?? null)}
              />
              {thumbFile && <p className="text-xs text-gray-500 mt-1">New image will be uploaded when you save.</p>}
            </div>
          </div>
          {!hasThumbnail && (
            <p className="text-xs text-amber-700 mt-2">
              This model has no thumbnail — add one here before you can publish it.
            </p>
          )}
        </div>

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

      {/* Upload a new file version — replaces the main model file. Buyers keep
          access and re-download the new version for free; they're notified. */}
      <div className="mt-8 rounded-lg border border-gray-200 p-4">
        <h2 className="text-base font-semibold text-gray-900">File version</h2>
        <p className="mt-1 text-sm text-gray-600">
          Currently on <span className="font-medium">v{model?.fileVersion ?? 1}</span>
          {model?.filesUpdatedAt && (
            <> · updated {new Date(model.filesUpdatedAt).toLocaleDateString()}</>
          )}
          . Upload a fixed or improved file and everyone who owns this model can re-download it free.
        </p>

        <form onSubmit={handleNewVersion} className="mt-4 space-y-3">
          <input
            type="file"
            accept=".stl,.obj,.3mf"
            disabled={versionBusy}
            onChange={(e) => setVersionFile(e.target.files?.[0] ?? null)}
          />
          <div>
            <label className="block text-sm mb-1">What changed? <span className="font-normal text-gray-400">(optional, shown to buyers)</span></label>
            <textarea
              className="w-full border rounded px-3 py-2"
              rows={2}
              maxLength={1000}
              value={versionNotes}
              onChange={(e) => setVersionNotes(e.target.value)}
              disabled={versionBusy}
              placeholder="e.g. Thickened a fragile wall and fixed a non-manifold edge."
            />
          </div>
          {versionMsg && <p className="text-sm text-green-700">{versionMsg}</p>}
          {versionErr && <p className="text-sm text-red-600">{versionErr}</p>}
          <button
            type="submit"
            className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            disabled={versionBusy || !versionFile}
          >
            {versionBusy ? 'Publishing new version…' : 'Publish new version'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default EditModel
