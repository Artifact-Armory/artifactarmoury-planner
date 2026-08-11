import React from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { modelsApi } from '../../api/endpoints/models'
import { TerrainModel } from '../../api/types'
import { FEATURES } from '../../config/features'

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
    <span className={`inline-block px-2 py-0.5 rounded-sm text-xs font-medium ${styles[s] ?? 'bg-gray-100 text-gray-700'}`}>
      {s}
    </span>
  )
}

/**
 * The live preview state for a row: "generating…" while the 3D preview bakes,
 * "failed" if it errored, and a green "Preview ready" flag for models that just
 * finished during this visit (so existing models don't all carry the badge).
 */
const PreviewBadge: React.FC<{ model: TerrainModel; recentlyReady: boolean }> = ({ model, recentlyReady }) => {
  const p = model.processingStatus
  if (p === 'processing') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium bg-blue-100 text-blue-800">
        <Loader2 size={12} className="animate-spin" />
        Preview generating…
      </span>
    )
  }
  if (p === 'failed') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-sm text-xs font-medium bg-red-100 text-red-800">
        Preview failed
      </span>
    )
  }
  if (recentlyReady) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium bg-green-100 text-green-800">
        <CheckCircle2 size={12} />
        Preview ready
      </span>
    )
  }
  return null
}

interface PrintQuote {
  providerCost: number
  artistFee: number
  siteFee: number
  total: number
  currency: string
  provider: string
  estimatedDays?: number
}

const ArtistModels: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  // Passed by CreateModel after an upload so we can spotlight the new model and
  // flag its preview as ready the moment the background processor finishes.
  const justUploadedId = (location.state as any)?.justUploadedId as string | undefined
  const justUploadedName = (location.state as any)?.justUploadedName as string | undefined

  const [models, setModels] = React.useState<TerrainModel[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [rowError, setRowError] = React.useState<Record<string, string>>({})
  const [quotingId, setQuotingId] = React.useState<string | null>(null)
  const [quotes, setQuotes] = React.useState<Record<string, PrintQuote>>({})
  // Models whose preview finished while this page was open — they show a green
  // "Preview ready" flag (existing already-ready models don't, to avoid clutter).
  const [recentlyReady, setRecentlyReady] = React.useState<Set<string>>(new Set())
  const wasProcessing = React.useRef<Set<string>>(new Set(justUploadedId ? [justUploadedId] : []))

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const { models } = await modelsApi.getMyModels({ limit: 100 })
      setModels(models)
      // Any model that was processing (or was just uploaded) and is now ready
      // gets the green flag; refresh the "still processing" set for next poll.
      const nowProcessing = new Set<string>()
      const becameReady: string[] = []
      for (const m of models) {
        if (m.processingStatus === 'processing') nowProcessing.add(m.id)
        else if (wasProcessing.current.has(m.id) && m.processingStatus !== 'failed') becameReady.push(m.id)
      }
      if (becameReady.length) {
        setRecentlyReady((prev) => {
          const next = new Set(prev)
          becameReady.forEach((id) => next.add(id))
          return next
        })
      }
      wasProcessing.current = nowProcessing
    } catch (err) {
      setError(errMessage(err, 'Could not load your models'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // While any model's preview is still generating, quietly re-poll so the badge
  // flips to "Preview ready" on its own — no manual refresh, no watching a spinner.
  const anyProcessing = models.some((m) => m.processingStatus === 'processing')
  React.useEffect(() => {
    if (!anyProcessing) return
    const t = setInterval(() => load(true), 4000)
    return () => clearInterval(t)
  }, [anyProcessing, load])

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

  async function handlePrintQuote(m: TerrainModel) {
    // First time for this model, the artist must agree it can be manufactured
    // by a third-party print service. Consent is captured once, then remembered.
    let consent: boolean | undefined
    if (!m.printConsent) {
      const ok = window.confirm(
        `Allow a third-party print service to manufacture “${m.name}”?\n\n` +
          `Buyers without a 3D printer will be able to order it printed and shipped. The print ` +
          `price they pay is your set price (£${m.basePrice.toFixed(2)}) + the third-party print cost ` +
          `+ a £1 site fee. You earn exactly what you would on a normal sale of this model — the ` +
          `print cost and site fee don't come out of your share.`,
      )
      if (!ok) return
      consent = true
    }
    setQuotingId(m.id)
    setRowError((r) => ({ ...r, [m.id]: '' }))
    try {
      const q = await modelsApi.getPrintQuote(m.id, consent)
      setQuotes((s) => ({ ...s, [m.id]: q }))
      // Reflect the freshly-stored price + consent on the row too.
      setModels((list) =>
        list.map((x) =>
          x.id === m.id
            ? { ...x, printPrice: q.total, printProviderCost: q.providerCost, printProvider: q.provider, printQuotedAt: new Date().toISOString(), printConsent: true }
            : x,
        ),
      )
    } catch (err) {
      setRowError((r) => ({ ...r, [m.id]: errMessage(err, 'Could not get a print quote') }))
    } finally {
      setQuotingId(null)
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
          <p className="text-gray-500 text-sm mt-1">
            Offer your model as a <span className="text-indigo-700">print</span> for buyers without a 3D printer. They pay your set
            price + the third-party print cost (+ a £1 site fee), and you earn exactly what you would on a normal sale of this model.
          </p>
        </div>
        <Link to="/artist/models/new" className="px-4 py-2 rounded-sm bg-blue-600 text-white whitespace-nowrap">
          + New model
        </Link>
      </div>

      {justUploadedId && (() => {
        const jm = models.find((m) => m.id === justUploadedId)
        const label = justUploadedName ? `“${justUploadedName}”` : 'Your model'
        const state = jm?.processingStatus
        if (state === 'failed') {
          return (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {label} was uploaded but its 3D preview couldn’t be generated. Open it to see why, or re-upload the file.
            </div>
          )
        }
        if (jm && state !== 'processing') {
          return (
            <div className="mt-6 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <CheckCircle2 size={16} />
              {label}’s 3D preview is ready. It’s saved as a draft — publish it when you’re ready for buyers to see it.
            </div>
          )
        }
        return (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <Loader2 size={16} className="animate-spin" />
            {label} was uploaded — we’re creating its 3D preview now. You can keep working; it’ll show a green “Preview ready” flag below when it’s done.
          </div>
        )
      })()}

      {loading && <p className="mt-8 text-gray-500">Loading your models…</p>}
      {error && !loading && (
        <div className="mt-8">
          <p className="text-red-600">{error}</p>
          <button className="mt-2 px-3 py-1.5 rounded-sm border" onClick={() => load()}>Retry</button>
        </div>
      )}

      {!loading && !error && models.length === 0 && (
        <div className="mt-10 text-center border rounded-lg py-12">
          <p className="text-gray-600">You haven’t uploaded any models yet.</p>
          <Link to="/artist/models/new" className="inline-block mt-4 px-4 py-2 rounded-sm bg-blue-600 text-white">
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
            const quoting = quotingId === m.id
            const notReady = !!m.processingStatus && m.processingStatus !== 'ready'
            const quote = quotes[m.id]
            return (
              <li
                key={m.id}
                className={`flex items-center gap-4 p-4 ${m.id === justUploadedId ? 'bg-blue-50/60 ring-1 ring-inset ring-blue-200' : ''}`}
              >
                <div className="w-16 h-16 rounded-sm bg-gray-100 overflow-hidden shrink-0">
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
                    <PreviewBadge model={m} recentlyReady={recentlyReady.has(m.id)} />
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    £{m.basePrice.toFixed(2)}
                    {m.downloadCount != null && <> · {m.downloadCount} downloads</>}
                    {m.saleCount != null && <> · {m.saleCount} sales</>}
                  </p>
                  {isDraft && blocker && <p className="text-xs text-amber-700 mt-1">{blocker}</p>}
                  {rowError[m.id] && <p className="text-xs text-red-600 mt-1">{rowError[m.id]}</p>}

                  {FEATURES.printAndShip && (quote || m.printPrice != null) && (
                    <div className="mt-2 text-xs text-gray-700 bg-indigo-50 border border-indigo-100 rounded-sm px-2 py-1.5 inline-block">
                      <span className="font-medium">Print price: £{(quote?.total ?? m.printPrice ?? 0).toFixed(2)}</span>
                      {quote ? (
                        <span className="text-gray-500">
                          {' '}
                          = £{quote.providerCost.toFixed(2)} print + £{quote.artistFee.toFixed(2)} your fee + £{quote.siteFee.toFixed(2)} site
                          {quote.estimatedDays != null && <> · ~{quote.estimatedDays} days</>}
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          {' '}(incl. £{(m.printProviderCost ?? 0).toFixed(2)} print cost) — re-quote to refresh
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {m.status === 'published' && (
                    <button className="px-3 py-1.5 rounded-sm border text-sm" onClick={() => navigate(`/models/${m.id}`)}>
                      View
                    </button>
                  )}
                  <button
                    className="px-3 py-1.5 rounded-sm border text-sm"
                    onClick={() => navigate(`/artist/models/${m.id}/edit`)}
                    disabled={busy}
                  >
                    Edit
                  </button>
                  {FEATURES.printAndShip && (
                    <button
                      className="px-3 py-1.5 rounded-sm border border-indigo-300 text-indigo-700 text-sm disabled:opacity-50"
                      onClick={() => handlePrintQuote(m)}
                      disabled={quoting || busy || notReady}
                      title={notReady ? 'Model must finish processing before it can be priced for print' : 'Get a print-on-demand price from the print service'}
                    >
                      {quoting ? 'Pricing…' : m.printPrice != null ? 'Re-quote print' : 'Print price'}
                    </button>
                  )}
                  {isDraft ? (
                    <button
                      className="px-3 py-1.5 rounded-sm bg-green-600 text-white text-sm disabled:opacity-50"
                      onClick={() => handlePublish(m)}
                      disabled={busy || !!blocker}
                      title={blocker ?? 'Publish to the marketplace'}
                    >
                      {busy ? 'Publishing…' : 'Publish'}
                    </button>
                  ) : (
                    <button
                      className="px-3 py-1.5 rounded-sm border text-sm disabled:opacity-50"
                      onClick={() => handleUnpublish(m)}
                      disabled={busy}
                    >
                      {busy ? 'Working…' : 'Unpublish'}
                    </button>
                  )}
                  <button
                    className="px-3 py-1.5 rounded-sm border border-red-300 text-red-700 text-sm disabled:opacity-50"
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
