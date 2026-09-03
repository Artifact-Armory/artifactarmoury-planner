import React, { Suspense, lazy } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { modelsApi } from '../../api/endpoints/models'
import { uploadsApi } from '../../api/endpoints/uploads'
import { TerrainModel } from '../../api/types'
import TermPicker from '../../components/taxonomy/TermPicker'
import { withPrinterTypeTerm, withLicenceTerm, PRINT_PROCESS_PATH, LICENCE_FACET } from '../../utils/derivedTerms'
import { termToken, MODEL_CLASS_SLUG } from '../../api/endpoints/taxonomy'
import { LICENSE_OPTIONS, licenseInfo } from '../../utils/licenses'
import { PRINTER_TYPE_OPTIONS, meshSeriousWarning } from '../../utils/printability'
import { Upload } from 'lucide-react'

// Lazy — this pulls in vanilla three + GLTFLoader/DRACOLoader/OrbitControls directly.
// EditModel is statically imported by app.tsx (every page is), so a static import here
// would put all of three.js in the main bundle for every visitor, not just artists
// editing a model — the same leak the planner route was just fixed for.
const ModelOrientationPreview = lazy(() => import('../../components/ModelOrientationPreview'))

const CATEGORIES = [
  { value: 'buildings', label: 'Buildings' },
  { value: 'nature', label: 'Nature' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'props', label: 'Props' },
  { value: 'complete_sets', label: 'Complete sets' },
  { value: 'other', label: 'Other' },
]

// Must match backend MAX_GALLERY_IMAGES (routes/models.ts) — fast client-side
// fail before wasting an upload, same convention as the model-file size cap.
const MAX_GALLERY_IMAGES = 10

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
  // Whether this model may be placed on the 3D planner at all (artist opt-out for
  // misc items — a paint brush holder, a display base — that aren't table scenery).
  const [showInPlanner, setShowInPlanner] = React.useState(true)

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

  // Gallery photos: unlike the thumbnail, these upload-and-attach immediately
  // (no staged/pending state) — there's no single "save" moment for a batch of
  // files, so each pick presigns + attaches straight away, same immediacy as
  // the file-version upload below.
  const [galleryBusy, setGalleryBusy] = React.useState(false)
  const [galleryErr, setGalleryErr] = React.useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = React.useState<string | null>(null)

  // Serious mesh warning (real open edges/holes) override.
  const [meshAckChecked, setMeshAckChecked] = React.useState(false)
  const [meshAckBusy, setMeshAckBusy] = React.useState(false)
  const [meshAckErr, setMeshAckErr] = React.useState<string | null>(null)

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
      setShowInPlanner(m.showInPlanner !== false)
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

  /** Presign + upload each picked file, then attach them all as gallery photos. */
  async function handleAddGalleryImages(files: FileList | null) {
    if (!id || !files || files.length === 0) return
    setGalleryErr(null)
    const picked = Array.from(files)
    const existing = model?.images?.length ?? 0
    if (existing + picked.length > MAX_GALLERY_IMAGES) {
      setGalleryErr(
        `A model can have at most ${MAX_GALLERY_IMAGES} gallery photos (${existing} already added, ${picked.length} more selected).`
      )
      return
    }
    setGalleryBusy(true)
    try {
      const keys: string[] = []
      for (const file of picked) {
        const { key } = await uploadsApi.uploadDirect(file, 'images')
        keys.push(key)
      }
      await modelsApi.addGalleryImages(id, keys)
      await load()
    } catch (err) {
      setGalleryErr(errMessage(err, 'Could not upload one or more photos'))
    } finally {
      setGalleryBusy(false)
    }
  }

  async function handleDeleteGalleryImage(imageId: string) {
    if (!id) return
    setDeletingImageId(imageId)
    setGalleryErr(null)
    try {
      await modelsApi.deleteGalleryImage(id, imageId)
      await load()
    } catch (err) {
      setGalleryErr(errMessage(err, 'Could not delete this photo'))
    } finally {
      setDeletingImageId(null)
    }
  }

  /**
   * Override a serious mesh warning (real open edges/holes) so the model can
   * publish despite it. Requires the checkbox above the button — enforced here
   * too, not just via `disabled`, in case of a stale render.
   */
  async function handleAcknowledgeMeshWarning() {
    if (!id || !meshAckChecked) return
    setMeshAckBusy(true)
    setMeshAckErr(null)
    try {
      await modelsApi.acknowledgeMeshWarning(id)
      await load()
      setMeshAckChecked(false)
    } catch (err) {
      setMeshAckErr(errMessage(err, 'Could not acknowledge the warning'))
    } finally {
      setMeshAckBusy(false)
    }
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
        showInPlanner,
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
        showInPlanner,
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

  if (loading) return <div className="px-4 py-10 max-w-2xl mx-auto text-muted-foreground">Loading…</div>
  if (loadError) {
    return (
      <div className="px-4 py-10 max-w-2xl mx-auto">
        <p className="text-red-600">{loadError}</p>
        <Link to="/artist/models" className="inline-block mt-4 text-primary">← Back to My Models</Link>
      </div>
    )
  }

  const busy = saving || publishing

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit Model</h1>
        <Link to="/artist/models" className="text-sm text-primary">← My Models</Link>
      </div>
      <p className="text-muted-foreground mt-1">
        Status: <span className="font-medium">{model?.status ?? 'draft'}</span>
        {model?.processingStatus && model.processingStatus !== 'ready' && (
          <span className="ml-2 text-amber-700">({model.processingStatus})</span>
        )}
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSave}>
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input className="w-full border rounded-sm px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea className="w-full border rounded-sm px-3 py-2" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
          <p className="text-xs mt-1 text-muted-foreground">Optional — a good description helps buyers find your model.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Sub-category only applies to terrain; vehicles/characters store their class. */}
          {modelClass === 'terrain' && (
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select className="w-full border rounded-sm px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Base price (£)</label>
            <input type="number" min={0} step="0.01" className="w-full border rounded-sm px-3 py-2" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} disabled={busy} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Usage licence</label>
          <select
            className="w-full border rounded-sm px-3 py-2"
            value={license}
            onChange={(e) => setLicense(e.target.value as 'personal' | 'commercial')}
            disabled={busy}
          >
            {LICENSE_OPTIONS.map((l) => (
              <option key={l.value} value={l.value}>{l.label} — {l.short}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">{licenseInfo(license).description}</p>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-sm font-medium">Printability</p>

          {/* Serious mesh QA warning (real open edges/holes) — artist-only. Minor
              findings (non-manifold-only, degenerate-only) aren't surfaced anywhere;
              see utils/printability.ts. Blocks publish until acknowledged. */}
          {model && (() => {
            const warning = meshSeriousWarning(model)
            if (!warning) return null
            if (warning.acknowledged) {
              return (
                <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p>
                    <span className="font-medium">⚠ Mesh warning acknowledged.</span> {warning.detail}
                  </p>
                  {warning.acknowledgedAt && (
                    <p className="mt-1 text-amber-700">
                      Acknowledged {new Date(warning.acknowledgedAt).toLocaleDateString()} — you can publish.
                    </p>
                  )}
                </div>
              )
            }
            return (
              <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 space-y-2">
                <p>
                  <span className="font-medium">⚠ This model can't publish yet.</span> {warning.detail}
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={meshAckChecked}
                    onChange={(e) => setMeshAckChecked(e.target.checked)}
                    disabled={meshAckBusy}
                  />
                  <span>I understand this may affect printability. Publish anyway (this notifies our team).</span>
                </label>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-sm border border-red-300 text-red-800 text-xs font-medium disabled:opacity-50"
                  onClick={handleAcknowledgeMeshWarning}
                  disabled={!meshAckChecked || meshAckBusy}
                >
                  {meshAckBusy ? 'Acknowledging…' : 'Acknowledge & allow publishing'}
                </button>
                {meshAckErr && <p className="text-red-700">{meshAckErr}</p>}
              </div>
            )
          })()}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">Printer type</label>
              <select
                className="w-full border rounded-sm px-3 py-2"
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
              <input type="number" min={0} step="0.01" className="w-full border rounded-sm px-3 py-2" value={layerHeight} onChange={(e) => setLayerHeight(e.target.value)} disabled={busy} placeholder="0.2" />
            </div>
            <div>
              <label className="block text-sm mb-1">Recommended infill (%)</label>
              <input type="number" min={0} max={100} step="1" className="w-full border rounded-sm px-3 py-2" value={infill} onChange={(e) => setInfill(e.target.value)} disabled={busy} placeholder="20" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={showInPlanner}
              onChange={(e) => setShowInPlanner(e.target.checked)}
              disabled={busy}
            />
            <span>
              <span className="font-medium block">Available in the 3D Table Planner</span>
              <span className="text-xs text-muted-foreground">
                Turn this off for a listing that isn't table scenery — a paint brush holder, a
                display base, a tool — so it still sells normally but never shows up as a
                placeable piece in the planner.
              </span>
            </span>
          </label>
        </div>

        <div className={`rounded-lg border border-border p-3 ${showInPlanner ? '' : 'opacity-50'}`}>
          <p className="text-sm font-medium">Planner orientation</p>
          <p className="text-xs text-muted-foreground mt-1">
            If your model imports lying on its side in the 3D planner, pick the tilt that
            stands it upright — the live preview below sits it on the table exactly as buyers
            will see it. This is applied automatically whenever a buyer places it; the
            downloadable STL is never changed.
            {!showInPlanner && ' (Not shown in the planner while "Available in the 3D Table Planner" is off.)'}
          </p>
          <Suspense
            fallback={
              <div className="mt-3 flex w-full h-56 items-center justify-center rounded-sm border bg-linear-to-b from-slate-50 to-slate-100 text-sm text-muted-foreground">
                Loading preview…
              </div>
            }
          >
            <ModelOrientationPreview url={model?.glbUrl} pitchDeg={defaultPitch} className="mt-3 relative w-full h-56 rounded-sm border bg-linear-to-b from-slate-50 to-slate-100 overflow-hidden" />
          </Suspense>
          <div className="mt-2 flex flex-wrap gap-2">
            {[0, 90, 180, 270].map((deg) => (
              <button
                key={deg}
                type="button"
                onClick={() => setDefaultPitch(deg)}
                disabled={busy}
                className={`px-3 py-1.5 rounded border text-sm ${
                  defaultPitch === deg
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-foreground hover:bg-accent'
                }`}
              >
                {deg === 0 ? 'Default (no tilt)' : `Tilt ${deg}°`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
          <input className="w-full border rounded-sm px-3 py-2" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Tags & categories</label>
          <p className="text-xs text-muted-foreground mb-2">
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
                className="h-20 w-20 rounded-sm object-cover border"
              />
            ) : (
              <div className="h-20 w-20 rounded-sm border border-dashed flex items-center justify-center text-xs text-muted-foreground text-center">
                No image
              </div>
            )}
            <div>
              <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                <Upload size={16} />
                Choose image…
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => onPickThumb(e.target.files?.[0] ?? null)}
                />
              </label>
              {thumbFile && <p className="text-xs text-muted-foreground mt-1">New image will be uploaded when you save.</p>}
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
          <button type="submit" className="px-4 py-2 rounded-sm bg-primary text-primary-foreground disabled:opacity-50" disabled={busy}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {isDraft && (
            <button
              type="button"
              className="px-4 py-2 rounded-sm bg-green-600 text-white disabled:opacity-50"
              onClick={handlePublish}
              disabled={busy}
            >
              {publishing ? 'Publishing…' : 'Save & publish'}
            </button>
          )}
        </div>
      </form>

      {/* Gallery photos — extra store-page images beyond the thumbnail (angles,
          close-ups, painted examples). Uploads attach immediately, no "save" step. */}
      <div className="mt-8 rounded-lg border border-border p-4">
        <h2 className="text-base font-semibold text-foreground">Gallery photos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Extra photos shown on the store page alongside the thumbnail. Up to {MAX_GALLERY_IMAGES}.
        </p>

        {(model?.images?.length ?? 0) > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {model!.images!.map((img) => (
              <div key={img.id} className="relative h-24 w-24">
                <img src={img.imageUrl} alt="" className="h-24 w-24 rounded-sm border object-cover" />
                <button
                  type="button"
                  onClick={() => handleDeleteGalleryImage(img.id)}
                  disabled={deletingImageId === img.id}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white disabled:opacity-50"
                  title="Remove this photo"
                >
                  {deletingImageId === img.id ? '…' : '×'}
                </button>
              </div>
            ))}
          </div>
        )}

        <label
          className={`mt-4 flex w-fit cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent ${
            galleryBusy || (model?.images?.length ?? 0) >= MAX_GALLERY_IMAGES ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <Upload size={16} />
          {galleryBusy ? 'Uploading…' : 'Add photos…'}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={galleryBusy || (model?.images?.length ?? 0) >= MAX_GALLERY_IMAGES}
            onChange={(e) => {
              handleAddGalleryImages(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        {(model?.images?.length ?? 0) >= MAX_GALLERY_IMAGES && (
          <p className="mt-1 text-xs text-muted-foreground">Maximum reached — remove one to add another.</p>
        )}
        {galleryErr && <p className="mt-2 text-sm text-red-600">{galleryErr}</p>}
      </div>

      {/* Upload a new file version — replaces the main model file. Buyers keep
          access and re-download the new version for free; they're notified. */}
      <div className="mt-8 rounded-lg border border-border p-4">
        <h2 className="text-base font-semibold text-foreground">File version</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Currently on <span className="font-medium">v{model?.fileVersion ?? 1}</span>
          {model?.filesUpdatedAt && (
            <> · updated {new Date(model.filesUpdatedAt).toLocaleDateString()}</>
          )}
          . Upload a fixed or improved file and everyone who owns this model can re-download it free.
        </p>

        <form onSubmit={handleNewVersion} className="mt-4 space-y-3">
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-accent ${versionBusy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={16} />
            {versionFile ? versionFile.name : 'Choose file…'}
            <input
              type="file"
              accept=".stl,.obj,.3mf"
              className="hidden"
              disabled={versionBusy}
              onChange={(e) => setVersionFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div>
            <label className="block text-sm mb-1">What changed? <span className="font-normal text-muted-foreground">(optional, shown to buyers)</span></label>
            <textarea
              className="w-full border rounded-sm px-3 py-2"
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
            className="px-4 py-2 rounded-sm border border-border text-foreground hover:bg-accent disabled:opacity-50"
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
