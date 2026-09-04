import React from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, ShieldCheck, Upload } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { uploadsApi } from '../../api/endpoints/uploads'
import { modelsApi } from '../../api/endpoints/models'
import TermPicker from '../../components/taxonomy/TermPicker'
import FacetSelects from '../../components/taxonomy/FacetSelects'
import { LICENSE_OPTIONS, licenseInfo } from '../../utils/licenses'
import { PRINTER_TYPE_OPTIONS } from '../../utils/printability'
import { withPrinterTypeTerm, withLicenceTerm, PRINT_PROCESS_PATH, LICENCE_FACET } from '../../utils/derivedTerms'
import {
  taxonomyApi,
  facetAppliesTo,
  MODEL_CLASSES,
  MODEL_CLASS_SLUG,
  type TaxFacet,
} from '../../api/endpoints/taxonomy'

// The "type" facet a model must be tagged with, per class — the headline
// classification is class-conditional (a Vehicle needs vehicle-type, not terrain-type).
const TYPE_FACET_BY_CLASS: Record<string, string> = {
  terrain: 'terrain-type',
  vehicles: 'vehicle-type',
  characters: 'character-type',
}

// The legacy sub-category dropdown only applies to terrain; vehicles / characters
// store their class as the legacy category (see backend from-upload).
const CATEGORIES = [
  { value: 'buildings', label: 'Buildings' },
  { value: 'nature', label: 'Nature' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'props', label: 'Props' },
  { value: 'complete_sets', label: 'Complete sets' },
  { value: 'other', label: 'Other' },
]

type Phase = 'form' | 'uploading' | 'processing' | 'done' | 'error'

// Must match the backend cap (services/meshConvert.ts) — a middle ground
// between MyMiniFactory's two tiers (100MB regular-designer, 500MB Store
// Manager). A dense binary STL will still be turned away well under this by
// the backend's separate triangle-count ceiling (fileProcessor.ts's
// MAX_INGEST_TRIANGLES); this is just the fast client-side check so an
// oversized file fails before wasting an upload.
const MAX_MODEL_FILE_MB = 250
const MAX_MODEL_FILE_BYTES = MAX_MODEL_FILE_MB * 1024 * 1024

// Caps mirrored from the backend (routes/models.ts).
const MAX_EXTRA_FILES = 60
const MAX_COMPONENTS = 20
const MAX_GALLERY_IMAGES = 10

const MESH_FILE_RE = /\.(stl|obj|3mf)$/i
const baseName = (filename: string) => filename.replace(MESH_FILE_RE, '')

/**
 * A "component" — one named model inside the listing. A plain single-piece
 * upload is one component with one file; a multi-part piece is one component
 * with several; a collection ("Small Village") is several named components, each
 * with its own parts. It's still ONE listing, one price, one purchase.
 */
type Component = {
  key: string
  name: string
  files: File[]
  // Pre-supported print file for THIS component: when its primary file already
  // has supports built in, isPresupported reveals a per-component upload for a
  // support-free version used only to render that component's preview. One per
  // named model, not one for the whole listing — a grouped listing otherwise
  // has no way to say which of its several models needs this.
  isPresupported: boolean
  previewFile: File | null
  // Optional thumbnail shown in the planner palette so a buyer can tell this
  // named model apart from the rest of the set — only offered for components
  // after the first (component 0 already has the listing's own required
  // Thumbnail field above, which doubles as its planner thumbnail).
  thumbnailFile: File | null
}

let componentKeySeq = 0
const newComponent = (): Component => ({
  key: `c${componentKeySeq++}`, name: '', files: [], isPresupported: false, previewFile: null, thumbnailFile: null,
})

const CreateModel: React.FC = () => {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [category, setCategory] = React.useState('buildings')
  // Terms carry the chosen model-class token from the start (Terrain by default).
  const [terms, setTerms] = React.useState<string[]>([`${MODEL_CLASS_SLUG}:terrain`])
  const [facetTree, setFacetTree] = React.useState<TaxFacet[]>([])

  React.useEffect(() => {
    taxonomyApi.getTree().then(setFacetTree).catch(() => {})
  }, [])

  // Current class from the selected model-class token (defaults to terrain).
  const modelClass = React.useMemo(() => {
    const tok = terms.find((t) => t.startsWith(`${MODEL_CLASS_SLUG}:`))
    return tok ? tok.slice(MODEL_CLASS_SLUG.length + 1) : 'terrain'
  }, [terms])

  const appliesToBySlug = React.useMemo(() => {
    const m = new Map<string, string[] | null>()
    for (const f of facetTree) m.set(f.slug, f.appliesTo)
    return m
  }, [facetTree])

  // Switch class: replace the model-class token and drop any tags for class-specific
  // facets that no longer apply (universal tags are kept).
  const setModelClass = (slug: string) => {
    setTerms((prev) => {
      const next: string[] = []
      for (const tok of prev) {
        const facetSlug = tok.slice(0, tok.indexOf(':'))
        if (facetSlug === MODEL_CLASS_SLUG) continue
        const appliesTo = appliesToBySlug.get(facetSlug)
        const scoped = appliesTo && appliesTo.length > 0
        if (!scoped) next.push(tok)
        else if (appliesTo!.includes(slug)) next.push(tok)
      }
      next.push(`${MODEL_CLASS_SLUG}:${slug}`)
      return next
    })
  }

  // Class-driven headline (required) facets: the type facet swaps per class, and
  // condition doesn't apply to characters & units.
  const typeFacet = TYPE_FACET_BY_CLASS[modelClass] ?? 'terrain-type'
  const requiredFacetSlugs = [
    typeFacet,
    'setting-era',
    'scale',
    ...(modelClass === 'characters' ? [] : ['condition']),
  ]
  const requiredFacetLabels: Record<string, string> = {
    [typeFacet]: 'Model type',
    'setting-era': 'Theme / Era',
    scale: 'Scale',
    condition: 'Condition',
  }
  const [basePrice, setBasePrice] = React.useState('')
  const [license, setLicense] = React.useState<'personal' | 'commercial'>('personal')
  const [printerType, setPrinterType] = React.useState<'' | 'fdm' | 'resin' | 'both'>('')
  // Whether this listing may be placed on the 3D table planner at all. Defaults on —
  // most models are terrain/scenery; an artist unticks this for a misc item (a paint
  // brush holder, a display base, a tool) that isn't meant to go on a battlefield table.
  const [showInPlanner, setShowInPlanner] = React.useState(true)
  const [thumbFile, setThumbFile] = React.useState<File | null>(null)
  // Extra store-page photos (beyond the required thumbnail) — optional, uploaded
  // alongside everything else in the same batch so this is all done from one page.
  const [galleryFiles, setGalleryFiles] = React.useState<File[]>([])
  // The listing's files, grouped into named models (see Component above). The very
  // first file of the first component is the primary — the model row's own STL.
  const [components, setComponents] = React.useState<Component[]>([newComponent()])

  const [phase, setPhase] = React.useState<Phase>('form')
  const [progress, setProgress] = React.useState(0)
  const [uploadLabel, setUploadLabel] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const busy = phase === 'uploading' || phase === 'processing'

  const totalFiles = components.reduce((n, c) => n + c.files.length, 0)
  const componentLabel = (i: number) =>
    components[i]?.name.trim() || (i === 0 ? 'your first model' : `model ${i + 1}`)

  const patchComponent = (i: number, patch: Partial<Component>) =>
    setComponents((list) => list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const addFiles = (i: number, files: File[]) =>
    setComponents((list) => list.map((c, idx) => (idx === i ? { ...c, files: [...c.files, ...files] } : c)))
  const removeFile = (i: number, fileIndex: number) =>
    setComponents((list) =>
      list.map((c, idx) => (idx === i ? { ...c, files: c.files.filter((_, f) => f !== fileIndex) } : c)))
  const addComponent = () => setComponents((list) => [...list, newComponent()])
  const removeComponent = (i: number) => setComponents((list) => list.filter((_, idx) => idx !== i))

  const addGalleryFiles = (files: File[]) =>
    setGalleryFiles((list) => [...list, ...files].slice(0, MAX_GALLERY_IMAGES))
  const removeGalleryFile = (i: number) =>
    setGalleryFiles((list) => list.filter((_, idx) => idx !== i))

  // Object-URL previews for the picked gallery files — revoked whenever the
  // picked set changes (add/remove) or the page unmounts.
  const galleryPreviews = React.useMemo(
    () => galleryFiles.map((f) => URL.createObjectURL(f)),
    [galleryFiles],
  )
  React.useEffect(() => () => { galleryPreviews.forEach((u) => URL.revokeObjectURL(u)) }, [galleryPreviews])

  // Same treatment for each component's optional planner thumbnail, keyed by
  // component so picking/clearing one doesn't touch the others' URLs.
  const componentThumbPreviews = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const c of components) if (c.thumbnailFile) map.set(c.key, URL.createObjectURL(c.thumbnailFile))
    return map
  }, [components])
  React.useEffect(() => () => { componentThumbPreviews.forEach((u) => URL.revokeObjectURL(u)) }, [componentThumbPreviews])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const primaryFile = components[0]?.files[0] ?? null
    const allFiles = components.flatMap((c) => c.files)
    const grouped = components.length > 1

    if (!primaryFile) { setError('Choose at least one model file to upload'); return }
    const emptyIdx = components.findIndex((c) => c.files.length === 0)
    if (emptyIdx >= 0) { setError(`Add at least one file to ${componentLabel(emptyIdx)}`); return }
    if (grouped && components.some((c) => !c.name.trim())) {
      setError('Give every included model a name (e.g. “Village Tower”) so buyers know what each one is')
      return
    }
    if (allFiles.some((f) => !MESH_FILE_RE.test(f.name))) {
      setError('Every model file must be an .stl, .obj or .3mf')
      return
    }
    if (allFiles.length - 1 > MAX_EXTRA_FILES) {
      setError(`A listing can have at most ${MAX_EXTRA_FILES + 1} files — split it into two listings or a bundle`)
      return
    }
    const oversized = allFiles.find((f) => f.size > MAX_MODEL_FILE_BYTES)
    if (oversized) {
      setError(
        `"${oversized.name}" is ${(oversized.size / (1024 * 1024)).toFixed(0)}MB — the maximum is ${MAX_MODEL_FILE_MB}MB per file. ` +
        `That's more detail than a 3D printer can use; reduce the model's poly count (e.g. a Decimate modifier in Blender) and upload again.`,
      )
      return
    }
    for (let ci = 0; ci < components.length; ci++) {
      const c = components[ci]
      if (c.isPresupported && !c.previewFile) {
        setError(`Upload a support-free preview model for ${componentLabel(ci)}, or untick "pre-supported"`)
        return
      }
      if (c.previewFile && !MESH_FILE_RE.test(c.previewFile.name)) {
        setError(`The preview model for ${componentLabel(ci)} must be an .stl, .obj or .3mf`)
        return
      }
      if (c.previewFile && c.previewFile.size > MAX_MODEL_FILE_BYTES) {
        setError(
          `The preview model for ${componentLabel(ci)} is ${(c.previewFile.size / (1024 * 1024)).toFixed(0)}MB — the maximum is ${MAX_MODEL_FILE_MB}MB.`,
        )
        return
      }
    }
    if (!thumbFile) { setError('Add a thumbnail image for your model'); return }
    const price = parseFloat(basePrice)
    if (!name.trim()) { setError('Give your model a name'); return }
    if (isNaN(price) || price < 0) { setError('Enter a valid base price'); return }
    const missingFacets = requiredFacetSlugs.filter((s) => !terms.some((t) => t.startsWith(`${s}:`)))
    if (missingFacets.length) {
      setError(`Choose a value for: ${missingFacets.map((s) => requiredFacetLabels[s]).join(', ')}`)
      return
    }
    const submittedTerms = withLicenceTerm(withPrinterTypeTerm(terms, printerType), license)

    try {
      setPhase('uploading')
      setProgress(0)

      // Every file (all components + the thumbnail + gallery photos + every
      // component's optional preview model) contributes to one bar, so a 12-file
      // village doesn't look stuck at 100% after the first upload.
      const previewFileCount = components.filter((c) => c.isPresupported && c.previewFile).length
      const componentThumbCount = components.filter((c) => c.thumbnailFile).length
      const totalUploads = allFiles.length + 1 + galleryFiles.length + previewFileCount + componentThumbCount
      let uploadsDone = 0
      const bump = (pct: number) =>
        setProgress(Math.round(((uploadsDone + pct / 100) / totalUploads) * 100))
      const startFile = (label: string) =>
        setUploadLabel(`${label} — file ${uploadsDone + 1} of ${totalUploads}`)

      // 1. The primary file (first file of the first model) straight to R2
      //    (quarantine prefix), with progress.
      startFile(primaryFile.name)
      const { key: rawKey } = await uploadsApi.uploadDirect(primaryFile, 'raw', bump)
      uploadsDone++

      // 1b. Component 0's own clean preview (pre-supported print file) — applies
      //     to the whole listing when it isn't grouped into several models.
      let displayRawKey: string | undefined
      const primaryComp = components[0]

      // 1c. Component 0's own planner thumbnail — separate from the listing's
      //     required store Thumbnail (uploaded in step 3 below), which is
      //     often a group shot of every model together.
      let primaryThumbnailKey: string | undefined
      if (primaryComp.thumbnailFile) {
        startFile(primaryComp.thumbnailFile.name)
        primaryThumbnailKey = (await uploadsApi.uploadDirect(primaryComp.thumbnailFile, 'thumbnails', bump)).key
        uploadsDone++
      }
      if (primaryComp.isPresupported && primaryComp.previewFile) {
        startFile(primaryComp.previewFile.name)
        displayRawKey = (await uploadsApi.uploadDirect(primaryComp.previewFile, 'raw', bump)).key
        uploadsDone++
      }

      // 2. Every other file, tagged with the component ("included model") it
      //    belongs to so the backend can group them. Each component's own clean
      //    preview (if any) rides along on the FIRST part of that component —
      //    that's the component's primary file, same idea as component 0 above.
      const parts: Array<{
        rawKey: string; filename: string; name: string; groupIndex: number; groupName?: string
        isPresupported?: boolean; displayRawKey?: string; thumbnailKey?: string
      }> = []
      for (let ci = 0; ci < components.length; ci++) {
        const comp = components[ci]
        for (let fi = ci === 0 ? 1 : 0; fi < comp.files.length; fi++) {
          const f = comp.files[fi]
          startFile(f.name)
          const p = await uploadsApi.uploadDirect(f, 'raw', bump)
          uploadsDone++
          let partDisplayRawKey: string | undefined
          let partThumbnailKey: string | undefined
          const isComponentPrimary = ci > 0 && fi === 0
          if (isComponentPrimary && comp.isPresupported && comp.previewFile) {
            startFile(comp.previewFile.name)
            partDisplayRawKey = (await uploadsApi.uploadDirect(comp.previewFile, 'raw', bump)).key
            uploadsDone++
          }
          // Component's own planner thumbnail (migration 058) — same "rides
          // along on the component's first/primary part" convention as the
          // clean-preview file above.
          if (isComponentPrimary && comp.thumbnailFile) {
            startFile(comp.thumbnailFile.name)
            partThumbnailKey = (await uploadsApi.uploadDirect(comp.thumbnailFile, 'thumbnails', bump)).key
            uploadsDone++
          }
          parts.push({
            rawKey: p.key,
            filename: f.name,
            name: baseName(f.name),
            groupIndex: ci,
            groupName: comp.name.trim() || undefined,
            isPresupported: isComponentPrimary && comp.isPresupported ? true : undefined,
            displayRawKey: partDisplayRawKey,
            thumbnailKey: partThumbnailKey,
          })
        }
      }

      // 3. Thumbnail (required), also direct to R2.
      startFile(thumbFile.name)
      const thumbnailKey = (await uploadsApi.uploadDirect(thumbFile, 'thumbnails', bump)).key
      uploadsDone++

      // 3b. Optional extra store-page photos — same direct-to-R2 upload, just to
      //     the 'images' prefix instead of 'thumbnails'.
      const galleryKeys: string[] = []
      for (const f of galleryFiles) {
        startFile(f.name)
        galleryKeys.push((await uploadsApi.uploadDirect(f, 'images', bump)).key)
        uploadsDone++
      }

      // 4. Create the model row; the API processes it (+ all parts) in the background.
      const created = await modelsApi.createFromUpload({
        rawKey,
        filename: primaryFile.name,
        name: name.trim(),
        description: description.trim() || undefined,
        // Vehicles / characters store their class as the legacy category; terrain
        // keeps the artist-chosen sub-category.
        category: modelClass === 'terrain' ? category : modelClass,
        basePrice: price,
        license,
        printerType: printerType || undefined,
        thumbnailKey,
        primaryThumbnailKey,
        galleryKeys: galleryKeys.length ? galleryKeys : undefined,
        showInPlanner,
        isPresupported: primaryComp.isPresupported,
        displayRawKey,
        parts: parts.length ? parts : undefined,
        // Names the primary file's component — only meaningful once the listing is
        // split into several named models.
        primaryGroupName: grouped ? components[0].name.trim() || undefined : undefined,
        // The print-process term is derived from the Printer type select above
        // rather than asked again in the tag picker.
        terms: submittedTerms.length ? submittedTerms : undefined,
      })

      // Hand off to My Models so the artist isn't stuck watching a "processing"
      // line here. The 3D preview is generated in the background; My Models shows
      // a banner and flips to a green "Preview ready" flag when it's done.
      navigate('/artist/models', {
        state: { justUploadedId: created.id, justUploadedName: name.trim() },
      })
    } catch (err) {
      setError((err as Error).message || 'Something went wrong')
      setPhase('error')
    }
  }

  // Sellers must have 2FA on before they can upload (the API enforces this too).
  if (user && user.twoFactorEnabled === false) {
    return (
      <div className="px-4 py-10 max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold">Create Model</h1>
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-amber-600" size={20} />
            <h2 className="font-semibold text-amber-900">Turn on two-factor authentication first</h2>
          </div>
          <p className="mt-2 text-sm text-amber-800">
            Selling accounts hold your earnings, so we require two-factor authentication before you can
            upload. It only takes a minute with any authenticator app.
          </p>
          <Link
            to="/dashboard/security"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
          >
            <ShieldCheck size={16} />
            Set up two-factor authentication
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold">Create Model</h1>
      <p className="text-muted-foreground mt-1">
        Upload your files and details — one model, a multi-part piece, or a whole group like a
        “Small Village” sold as one product. We’ll generate the 3D previews and print estimate for you.
      </p>
      <p className="text-muted-foreground mt-2 text-sm">
        Visitors never receive your real file, and each buyer’s download is prepared just for
        them.{' '}
        <Link to="/creator-protection" className="text-primary hover:underline">
          How we look after your files
        </Link>
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input className="w-full border rounded-sm px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea className="w-full border rounded-sm px-3 py-2" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Model class <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-muted-foreground mb-2">What kind of model is this? It sets which type and filters buyers use to find it.</p>
          <div className="flex flex-wrap gap-2">
            {MODEL_CLASSES.map((c) => (
              <button
                key={c.slug}
                type="button"
                disabled={busy}
                onClick={() => setModelClass(c.slug)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${
                  modelClass === c.slug
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-primary/50 hover:text-primary'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
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

        <div>
          <label className="block text-sm font-medium mb-1">
            Printer type <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <select
            className="w-full border rounded-sm px-3 py-2"
            value={printerType}
            onChange={(e) => setPrinterType(e.target.value as '' | 'fdm' | 'resin' | 'both')}
            disabled={busy}
          >
            <option value="">Not specified</option>
            {PRINTER_TYPE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.short}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Tell buyers which printer this model is authored for — helps set expectations for detail and supports.
          </p>
        </div>

        <div className="rounded-lg border border-border p-3">
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
                On by default. Turn this off for a listing that isn't table scenery — a paint
                brush holder, a display base, a tool — so it still sells normally but never
                shows up as a placeable piece in the planner.
              </span>
            </span>
          </label>
        </div>

        <div className="rounded-lg border border-border p-3">
          <label className="block text-sm font-medium mb-1">
            Classification <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Tell buyers what this is — all four are required so your model shows up in the right
            searches. Tick as many as apply in each (a stone barn can be Medieval <em>and</em> WW2).
          </p>
          <FacetSelects
            facetSlugs={requiredFacetSlugs}
            labels={requiredFacetLabels}
            value={terms}
            onChange={setTerms}
            disabled={busy}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">More tags (optional)</label>
          <p className="text-xs text-muted-foreground mb-2">
            Add extra tags so buyers find your model — pick several where they apply (a stone barn can
            be Medieval <em>and</em> WW2). Fields marked <span className="text-red-500">*</span> are
            required before you can publish.
          </p>
          <TermPicker
            value={terms}
            onChange={setTerms}
            disabled={busy}
            excludeFacets={[...requiredFacetSlugs, LICENCE_FACET]}
            excludeTermPaths={[PRINT_PROCESS_PATH]}
            modelClass={modelClass}
          />
        </div>

        <div className="rounded-lg border border-border p-3">
          <label className="block text-sm font-medium mb-1">
            Model files <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Add every file a buyer gets for this listing. If one piece prints as several parts
            (separate floors, a roof), add them all under the same model. Selling a group as one
            product — a “Small Village”? Hit <strong>Add another model</strong> for each building
            and name it (“Village Tower”). It stays one listing at one price: buyers download
            everything as a ZIP and can place each piece separately in the planner.
          </p>

          <div className="space-y-3">
            {components.map((comp, ci) => (
              <div key={comp.key} className="rounded-sm border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ci === 0 ? 'Model 1 (main)' : `Model ${ci + 1}`}
                  </span>
                  {ci > 0 && (
                    <button
                      type="button"
                      className="ml-auto text-xs text-red-600 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => removeComponent(ci)}
                    >
                      remove model
                    </button>
                  )}
                </div>

                <input
                  className="mt-2 w-full border rounded-sm px-3 py-2 text-sm"
                  placeholder={
                    components.length > 1
                      ? 'Name this model — e.g. “Village Tower”'
                      : 'Name (optional — only needed if you add more models below)'
                  }
                  value={comp.name}
                  onChange={(e) => patchComponent(ci, { name: e.target.value })}
                  disabled={busy}
                />

                {comp.files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {comp.files.map((f, fi) => (
                      <li key={`${f.name}-${fi}`} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">
                          {f.name}
                          <span className="text-muted-foreground"> · {(f.size / 1_048_576).toFixed(1)} MB</span>
                          {ci === 0 && fi === 0 && (
                            <span className="ml-2 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                              primary
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="text-red-600 text-xs disabled:opacity-50"
                          onClick={() => removeFile(ci, fi)}
                          disabled={busy}
                        >
                          remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <label className={`mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-accent ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                  <Upload size={16} />
                  {comp.files.length ? 'Add another part file…' : 'Choose file(s)…'}
                  <input
                    type="file"
                    accept=".stl,.obj,.3mf"
                    multiple
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      if (files.length) addFiles(ci, files)
                      e.target.value = '' // allow re-selecting the same file
                    }}
                  />
                </label>

                {comp.files.length > 1 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {comp.files.length} parts — buyers get them all and place each one separately.
                  </p>
                )}

                <div className="mt-3 border-t border-border/70 pt-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={comp.isPresupported}
                      onChange={(e) =>
                        patchComponent(ci, {
                          isPresupported: e.target.checked,
                          previewFile: e.target.checked ? comp.previewFile : null,
                        })
                      }
                      disabled={busy}
                    />
                    <span>
                      <span className="font-medium block">
                        {componentLabel(ci)}'s print file already has supports
                      </span>
                      <span className="text-xs text-muted-foreground">
                        If this model's main file is pre-supported (common for resin models), the
                        marketplace and 3D planner preview would otherwise be built from all those
                        support struts. Tick this and upload a separate, support-free version
                        below — it's used only to render this model's preview. Buyers still
                        download your actual print file, supports included.
                      </span>
                    </span>
                  </label>

                  {comp.isPresupported && (
                    <div className="mt-2">
                      <label className="block text-sm font-medium mb-1">
                        Preview model (no supports) <span className="text-red-500">*</span>
                      </label>
                      <p className="text-xs text-muted-foreground mb-2">
                        A clean version of this model — ideally the whole thing assembled in one
                        file, even if its print files are split into separate parts. Only used to
                        build the preview; never given to buyers.
                      </p>
                      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-accent ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                        <Upload size={16} />
                        {comp.previewFile ? 'Change file…' : 'Choose file…'}
                        <input
                          type="file"
                          accept=".stl,.obj,.3mf"
                          className="hidden"
                          disabled={busy}
                          onChange={(e) => patchComponent(ci, { previewFile: e.target.files?.[0] ?? null })}
                        />
                      </label>
                      {comp.previewFile && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {comp.previewFile.name} · {(comp.previewFile.size / 1_048_576).toFixed(1)} MB
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Optional per-model planner thumbnail — component 0 already has the
                    listing's own required Thumbnail field further down, which doubles
                    as its planner thumbnail, so this only applies to models after it. */}
                {components.length > 1 && (
                  <div className="mt-3 border-t border-border/70 pt-3">
                    <label className="block text-sm font-medium mb-1">
                      Thumbnail for {componentLabel(ci)} <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <p className="text-xs text-muted-foreground mb-2">
                      {ci === 0
                        ? "Shown in the planner palette when a buyer places just this model. Your listing's main Thumbnail below is often a group shot of everything together, which isn't the same thing — add one here so this model shows correctly on its own. Without one it falls back to the main Thumbnail."
                        : "Shown in the planner palette so buyers can tell this model apart from the rest of the set. Without one it just shows a generic icon there."}
                    </p>
                    <div className="flex items-center gap-3">
                      {comp.thumbnailFile ? (
                        <img
                          src={componentThumbPreviews.get(comp.key)}
                          alt=""
                          className="h-14 w-14 rounded-sm border object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-sm border border-dashed text-[10px] text-muted-foreground text-center">
                          No image
                        </div>
                      )}
                      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                        <Upload size={14} />
                        {comp.thumbnailFile ? 'Change…' : 'Choose image…'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={busy}
                          onChange={(e) => patchComponent(ci, { thumbnailFile: e.target.files?.[0] ?? null })}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addComponent}
            disabled={busy || components.length >= MAX_COMPONENTS}
            className="mt-3 inline-flex items-center gap-2 rounded-sm border border-dashed border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            <Plus size={16} />
            Add another model
          </button>

          {totalFiles > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {components.length} model{components.length === 1 ? '' : 's'} · {totalFiles} file
              {totalFiles === 1 ? '' : 's'} · sold as one product for one price.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            OBJ and 3MF are converted to a print-ready STL — buyers download your original file and the STL.
            Max {MAX_MODEL_FILE_MB}MB per file; decimate very high-poly models before uploading.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Reusing your own files is fine — list a piece on its own <em>and</em> inside a set. Only a
            file matching <strong>another artist’s</strong> model is rejected.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Thumbnail <span className="text-red-500">*</span></label>
          <p className="text-xs text-muted-foreground mb-1">A preview image is required — it's what buyers see in the marketplace.</p>
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-accent ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={16} />
            Choose image…
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)} disabled={busy} />
          </label>
          {thumbFile && <p className="text-sm text-muted-foreground mt-1">{thumbFile.name}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Gallery photos <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            Extra photos shown on the store page alongside the thumbnail — angles, close-ups, painted
            examples. Up to {MAX_GALLERY_IMAGES}.
          </p>

          {galleryFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-3">
              {galleryFiles.map((f, i) => (
                <div key={`${f.name}-${i}`} className="relative h-20 w-20">
                  <img src={galleryPreviews[i]} alt="" className="h-20 w-20 rounded-sm border object-cover" />
                  <button
                    type="button"
                    onClick={() => removeGalleryFile(i)}
                    disabled={busy}
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white disabled:opacity-50"
                    title="Remove this photo"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <label
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-accent ${
              busy || galleryFiles.length >= MAX_GALLERY_IMAGES ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            <Upload size={16} />
            Add photos…
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={busy || galleryFiles.length >= MAX_GALLERY_IMAGES}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) addGalleryFiles(files)
                e.target.value = ''
              }}
            />
          </label>
          {galleryFiles.length >= MAX_GALLERY_IMAGES && (
            <p className="mt-1 text-xs text-muted-foreground">Maximum reached — remove one to add another.</p>
          )}
        </div>

        {phase === 'uploading' && (
          <div>
            <div className="h-2 rounded-sm bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Uploading… {progress}%{uploadLabel ? ` · ${uploadLabel}` : ''}
            </p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" className="px-4 py-2 rounded-sm bg-primary text-primary-foreground disabled:opacity-50" disabled={busy}>
          {phase === 'uploading' ? 'Uploading…' : phase === 'processing' ? 'Processing…' : 'Upload model'}
        </button>
      </form>
    </div>
  )
}

export default CreateModel
