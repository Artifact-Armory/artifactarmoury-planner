import React from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ShieldCheck, Upload } from 'lucide-react'
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

// Must match the backend cap (services/meshConvert.ts). Processing is in-memory,
// so a huge mesh crashes the server — reject it here before wasting an upload.
const MAX_MODEL_FILE_MB = 150
const MAX_MODEL_FILE_BYTES = MAX_MODEL_FILE_MB * 1024 * 1024

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
  const [stlFile, setStlFile] = React.useState<File | null>(null)
  const [thumbFile, setThumbFile] = React.useState<File | null>(null)
  // Extra STL parts for a multi-part "set" model (the main file above is part 1).
  const [partFiles, setPartFiles] = React.useState<File[]>([])

  const [phase, setPhase] = React.useState<Phase>('form')
  const [progress, setProgress] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  const busy = phase === 'uploading' || phase === 'processing'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!stlFile) { setError('Choose a model file to upload'); return }
    if (!/\.(stl|obj|3mf)$/i.test(stlFile.name)) { setError('The model file must be an .stl, .obj or .3mf'); return }
    if (partFiles.some((f) => !/\.(stl|obj|3mf)$/i.test(f.name))) { setError('Every part must be an .stl, .obj or .3mf file'); return }
    const oversized = [stlFile, ...partFiles].find((f) => f.size > MAX_MODEL_FILE_BYTES)
    if (oversized) {
      setError(
        `"${oversized.name}" is ${(oversized.size / (1024 * 1024)).toFixed(0)}MB — the maximum is ${MAX_MODEL_FILE_MB}MB per file. ` +
        `That's more detail than a 3D printer can use; reduce the model's poly count (e.g. a Decimate modifier in Blender) and upload again.`,
      )
      return
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

      // 1. Raw STL straight to R2 (quarantine prefix), with progress.
      const { key: rawKey } = await uploadsApi.uploadDirect(stlFile, 'raw', setProgress)

      // 2. Extra parts (multi-part set) — each straight to R2.
      const parts: Array<{ rawKey: string; filename: string; name: string }> = []
      for (let i = 0; i < partFiles.length; i++) {
        const f = partFiles[i]
        const p = await uploadsApi.uploadDirect(f, 'raw')
        parts.push({ rawKey: p.key, filename: f.name, name: f.name.replace(/\.(stl|obj|3mf)$/i, '') })
      }

      // 3. Thumbnail (required), also direct to R2.
      const thumbnailKey = (await uploadsApi.uploadDirect(thumbFile, 'thumbnails')).key

      // 4. Create the model row; the API processes it (+ all parts) in the background.
      const created = await modelsApi.createFromUpload({
        rawKey,
        filename: stlFile.name,
        name: name.trim(),
        description: description.trim() || undefined,
        // Vehicles / characters store their class as the legacy category; terrain
        // keeps the artist-chosen sub-category.
        category: modelClass === 'terrain' ? category : modelClass,
        basePrice: price,
        license,
        printerType: printerType || undefined,
        thumbnailKey,
        parts: parts.length ? parts : undefined,
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
      <p className="text-muted-foreground mt-1">Upload an STL and details. We’ll generate the 3D preview and print estimate for you.</p>

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

        <div>
          <label className="block text-sm font-medium mb-1">Model file (.stl, .obj or .3mf)</label>
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-accent ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={16} />
            Choose file…
            <input type="file" accept=".stl,.obj,.3mf" className="hidden" onChange={(e) => setStlFile(e.target.files?.[0] ?? null)} disabled={busy} />
          </label>
          {stlFile && <p className="text-sm text-muted-foreground mt-1">{stlFile.name} · {(stlFile.size / 1_048_576).toFixed(1)} MB</p>}
          <p className="text-xs text-muted-foreground mt-1">
            OBJ and 3MF are converted to a print-ready STL — buyers download your original file and the STL.
            Max {MAX_MODEL_FILE_MB}MB per file; decimate very high-poly models before uploading.
          </p>
        </div>

        <div className="rounded-sm border border-dashed p-3">
          <label className="block text-sm font-medium mb-1">Extra parts (optional — makes this a “set”)</label>
          <p className="text-xs text-muted-foreground mb-2">
            Add more STL/OBJ/3MF files if this piece comes in several parts (e.g. separate floors).
            Buyers pay once, download all parts as a ZIP, and can place each part in the planner.
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
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-accent ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={16} />
            Add part file(s)…
            <input
              type="file"
              accept=".stl,.obj,.3mf"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) setPartFiles((list) => [...list, ...files])
                e.target.value = '' // allow re-selecting the same file
              }}
            />
          </label>
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

        {phase === 'uploading' && (
          <div>
            <div className="h-2 rounded-sm bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">Uploading… {progress}%</p>
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
