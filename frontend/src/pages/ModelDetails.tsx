import React from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ShoppingCart, Download, Heart, Share2, Flag, MessageSquare, Printer, FileText, ShieldCheck } from 'lucide-react'
import { modelsApi } from '../api/endpoints/models'
import { ordersApi } from '../api/endpoints/orders'
import { artistsApi } from '../api/endpoints/artists'
import { messagesApi } from '../api/endpoints/messages'
import type { TerrainModel } from '../api/types'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import PriceDisplay from '../components/models/PriceDisplay'
import { useCartStore } from '../store/cartStore'
import { useAuthStore } from '../store/authStore'
import { formatPrice, formatRating } from '../utils/format'
import { licenseInfo } from '../utils/licenses'
import { printerTypeLabel, meshQualitySummary } from '../utils/printability'
import { TRADEMARK_DISCLAIMER } from '../components/legal/TrademarkDisclaimer'
import ReportModelModal from '../components/reports/ReportModelModal'
import Seo from '../components/common/Seo'
import { FEATURES } from '../config/features'
import { SITE_NAME } from '../config/brand'

/**
 * SEO title/description PATTERN for a product page. Every visible model on
 * the live site right now is test data ("Model 2" by "Tester Artist"), so
 * there's no real copy to hand-write here — this is the template real
 * listings plug into once artists are onboarded. Keep it in sync with
 * whatever fields a listing actually has (name/category/artistName/description).
 */
function modelSeoDescription(model: TerrainModel): string {
  const category = model.category ? model.category.toLowerCase() : 'tabletop terrain'
  if (model.description) {
    const trimmed = model.description.trim()
    const truncated = trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed
    return `${truncated} A print-ready ${category} STL by ${model.artistName} on ${SITE_NAME}.`
  }
  return `Buy ${model.name} by ${model.artistName}: a print-ready ${category} STL, available on ${SITE_NAME}. Buy once, print as many times as your table needs.`
}

/**
 * Group a multi-file listing's parts into its components ("included models").
 * A listing sold as a group — a "Small Village" of a tower, a tavern and a well —
 * tags each file with the component it belongs to; component 0 owns the model's
 * primary file. An ungrouped set comes back as a single unnamed component.
 */
function partComponents(model: TerrainModel): Array<{ index: number; name: string | null; parts: Array<{ id: string; name: string }> }> {
  const groups = new Map<number, { index: number; name: string | null; parts: Array<{ id: string; name: string }> }>()
  groups.set(0, {
    index: 0,
    name: model.primaryGroupName ?? null,
    parts: [{ id: 'primary', name: 'Part 1' }],
  })
  // A part that failed ingest (e.g. too heavy to preview) was excluded from
  // the listing server-side — its file is gone, so it must never appear here
  // as if it were a real, buyable component.
  ;(model.parts ?? []).filter((p) => p.processingStatus !== 'failed').forEach((p, i) => {
    const gi = p.groupIndex ?? 0
    let g = groups.get(gi)
    if (!g) { g = { index: gi, name: p.groupName ?? null, parts: [] }; groups.set(gi, g) }
    if (!g.name && p.groupName) g.name = p.groupName
    g.parts.push({ id: p.id, name: p.name || `Part ${g.parts.length + 1}` })
  })
  return [...groups.values()].sort((a, b) => a.index - b.index)
}

/** Horizontal, scrollable strip of model tiles used for the discovery carousels. */
const ModelCarousel: React.FC<{ title: string; models: TerrainModel[] }> = ({ title, models }) => {
  if (!models.length) return null
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
        {models.map((m) => (
          <Link
            key={m.id}
            to={`/models/${m.id}`}
            className="group w-44 shrink-0 rounded-xl border border-border bg-card p-2 shadow-xs hover:border-primary/30 hover:shadow-sm"
          >
            <div className="h-32 w-full overflow-hidden rounded-lg bg-muted">
              {m.thumbnailUrl ? (
                <img src={m.thumbnailUrl} alt={m.name} className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No image</div>
              )}
            </div>
            <p className="mt-2 truncate text-sm font-medium text-foreground">{m.name}</p>
            <p className="text-xs text-muted-foreground">{formatPrice(m.basePrice)}</p>
            <p className="truncate text-xs text-muted-foreground">{m.artistName}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}

const ModelDetails: React.FC = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { addItem, openCart } = useCartStore((state) => ({
    addItem: state.addItem,
    openCart: state.openCart,
  }))
  const inCart = useCartStore((state) => state.hasItem('model', id ?? ''))
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const currentUser = useAuthStore((state) => state.user)
  const [reportOpen, setReportOpen] = React.useState(false)
  // Which photo the hero image shows — null means "the thumbnail" (the default).
  // Clicking a gallery strip thumbnail below swaps it; reset on model change so a
  // stale selection from the previous product page doesn't carry over.
  const [activeImage, setActiveImage] = React.useState<string | null>(null)
  React.useEffect(() => { setActiveImage(null) }, [id])

  const modelQuery = useQuery({
    queryKey: ['model', id],
    queryFn: () => modelsApi.getModelById(id as string),
    enabled: Boolean(id),
  })

  const entitlementsQuery = useQuery({
    queryKey: ['entitlements'],
    queryFn: () => ordersApi.getEntitlements(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })
  const owned = Boolean(id && entitlementsQuery.data?.models.has(id))

  const relatedQuery = useQuery({
    queryKey: ['related-models', id],
    queryFn: () => modelsApi.getRelatedModels(id as string, 12),
    enabled: Boolean(id),
  })

  const tablesQuery = useQuery({
    queryKey: ['model-tables', id],
    queryFn: () => modelsApi.getModelTables(id as string, 12),
    enabled: Boolean(id),
  })

  const model = modelQuery.data

  // "Other models from the same artist" carousel (excludes the current model).
  const artistModelsQuery = useQuery({
    queryKey: ['artist-models', model?.artistId],
    queryFn: () => artistsApi.getArtistModels(model!.artistId as string, { limit: 12 }),
    enabled: Boolean(model?.artistId),
  })
  const sameArtistModels = (artistModelsQuery.data?.models ?? []).filter((m) => m.id !== id)

  // Like (favorite) state — seeded from the model, then owned locally so the
  // button feels instant.
  const [liked, setLiked] = React.useState(false)
  const [likeCount, setLikeCount] = React.useState(0)
  const [likeBusy, setLikeBusy] = React.useState(false)
  React.useEffect(() => {
    if (model) {
      setLiked(Boolean(model.isFavorited))
      setLikeCount(model.favoriteCount ?? 0)
    }
  }, [model])

  const handleLike = async () => {
    if (!id) return
    if (!isAuthenticated) {
      toast.error('Sign in to like this model')
      navigate('/login')
      return
    }
    if (likeBusy) return
    setLikeBusy(true)
    // Optimistic toggle, reconciled with the server's authoritative count.
    const next = !liked
    setLiked(next)
    setLikeCount((c) => c + (next ? 1 : -1))
    try {
      const res = next ? await modelsApi.likeModel(id) : await modelsApi.unlikeModel(id)
      setLiked(res.favorited)
      setLikeCount(res.favoriteCount)
    } catch {
      // Roll back on failure.
      setLiked(!next)
      setLikeCount((c) => c + (next ? -1 : 1))
      toast.error('Could not update like')
    } finally {
      setLikeBusy(false)
    }
  }

  const handleShare = async () => {
    const url = window.location.href
    const shareData = { title: model?.name ?? `${SITE_NAME} model`, url }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
      } else {
        await navigator.clipboard.writeText(url)
        toast.success('Link copied to clipboard')
      }
    } catch {
      /* user cancelled the share sheet — no-op */
    }
  }

  const [downloading, setDownloading] = React.useState(false)
  const [downloadError, setDownloadError] = React.useState<string | null>(null)
  const [messageBusy, setMessageBusy] = React.useState(false)

  const messageArtist = async () => {
    if (!model?.artistId) return
    if (!isAuthenticated) {
      navigate('/login')
      return
    }
    setMessageBusy(true)
    try {
      const conversationId = await messagesApi.start({ recipientId: model.artistId })
      navigate(`/dashboard/messages?c=${conversationId}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not start a conversation')
    } finally {
      setMessageBusy(false)
    }
  }

  const handlePrintAndShip = () => {
    // Print checkout isn't wired yet — remind the buyer the option exists.
    toast('Print & Ship checkout is coming soon — you\'ll be able to order this printed and delivered to your door.', {
      icon: '🖨️',
    })
  }

  const handleAddToCart = () => {
    if (!model) return
    addItem({
      kind: 'model',
      id: model.id,
      name: model.name,
      artistName: model.artistName,
      price: model.onSale && model.salePrice != null ? model.salePrice : model.basePrice,
      originalPrice: model.onSale && model.salePrice != null ? model.basePrice : undefined,
      imageUrl: model.thumbnailUrl,
    })
    openCart()
  }

  const handleDownload = async () => {
    if (!model) return
    setDownloading(true)
    setDownloadError(null)
    try {
      await modelsApi.downloadModelStl(model.id, model.name)
    } catch (err: any) {
      const status = err?.response?.status
      setDownloadError(
        status === 401
          ? 'Please sign in to download.'
          : status === 403
            ? 'Purchase this model first to download the STL.'
            : 'Download failed — please try again.',
      )
    } finally {
      setDownloading(false)
    }
  }

  if (modelQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (modelQuery.isError || !model) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Model not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">We couldn&apos;t load this model. It may be private or removed.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Seo
        title={`${model.name}: 3D Printable ${model.category ? model.category.replace(/^\w/, (c) => c.toUpperCase()) : 'Terrain'} STL`}
        description={modelSeoDescription(model)}
        path={`/models/${model.id}`}
        image={model.thumbnailUrl}
      />
      <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
            <div className="relative h-80 w-full bg-muted">
              {activeImage || model.thumbnailUrl ? (
                <img src={activeImage || model.thumbnailUrl} alt={model.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">No thumbnail available</div>
              )}
            </div>
            {model.images && model.images.length > 0 && (
              <div className="flex gap-3 overflow-x-auto p-4">
                {/* The thumbnail itself is the first "photo" in the strip, so it's
                    easy to get back to after clicking into the gallery. */}
                {model.thumbnailUrl && (
                  <button
                    type="button"
                    onClick={() => setActiveImage(null)}
                    className={`h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${
                      !activeImage ? 'border-primary' : 'border-transparent'
                    }`}
                  >
                    <img src={model.thumbnailUrl} alt={model.name} className="h-full w-full object-cover" />
                  </button>
                )}
                {model.images.map((image) => {
                  const src = image.imageUrl ?? image.imagePath
                  return (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => src && setActiveImage(src)}
                      className={`h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${
                        activeImage === src ? 'border-primary' : 'border-transparent'
                      }`}
                    >
                      <img src={src} alt={image.caption ?? model.name} className="h-full w-full object-cover" />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {model.partCount && model.partCount > 1 && (() => {
            const components = partComponents(model)
            // A "group" listing sells several named models as one product; a plain
            // set is one piece that prints in several parts.
            const isGroup = components.length > 1
            return (
              <section className="rounded-2xl bg-card p-6 shadow-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded-sm bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                    {isGroup ? `GROUP · ${components.length} models` : `SET · ${model.partCount} parts`}
                  </span>
                  <h2 className="text-lg font-semibold text-foreground">
                    {isGroup ? "What's included" : 'Multi-part model'}
                  </h2>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {isGroup
                    ? `${components.length} models across ${model.partCount} STL files — buy once and download them all as a ZIP. Every piece can be placed separately in the planner.`
                    : `This piece comes as ${model.partCount} STL files — buy once and download them all as a ZIP. Each part can be placed separately in the planner.`}
                </p>
                {isGroup ? (
                  <ul className="mt-4 space-y-3">
                    {components.map((c) => (
                      <li key={c.index} className="rounded-sm border border-border/70 p-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {c.name || `Model ${c.index + 1}`}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {c.parts.length} part{c.parts.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.parts.map((p) => p.name).join(' · ')}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="mt-4 divide-y">
                    {components[0].parts.map((p, i) => (
                      <li key={p.id} className="flex items-center gap-3 py-2">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-muted">
                          {i === 0 && model.thumbnailUrl && (
                            <img src={model.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <span className="text-sm text-foreground">{p.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })()}

          <section className="rounded-2xl bg-card p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-foreground">Description</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{model.description ?? 'No description provided.'}</p>

            {model.taxonomyTerms?.length ? (
              <div className="mt-5 space-y-2 border-t border-border pt-4">
                {Object.entries(
                  model.taxonomyTerms.reduce<Record<string, typeof model.taxonomyTerms>>((acc, t) => {
                    ;(acc[t.facetName] ||= []).push(t)
                    return acc
                  }, {}),
                ).map(([facetName, terms]) => (
                  <div key={facetName} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{facetName}</span>
                    {terms.map((t) => (
                      <Link
                        key={t.termId}
                        to={`/browse?terms=${encodeURIComponent(`${t.facetSlug}:${t.path}`)}`}
                        className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                      >
                        {t.name}
                      </Link>
                    ))}
                  </div>
                ))}
                {model.taxonomyTerms.some((t) => t.facetSlug === 'designed-for') && (
                  <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">{TRADEMARK_DISCLAIMER}</p>
                )}
              </div>
            ) : model.tags?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {model.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          {tablesQuery.data && tablesQuery.data.length > 0 && (
            <section className="rounded-2xl bg-card p-6 shadow-xs">
              <h2 className="text-lg font-semibold text-foreground">
                Featured in {tablesQuery.data.length} table{tablesQuery.data.length === 1 ? '' : 's'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">See this piece in a full build — shop the whole look.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {tablesQuery.data.map((t) => (
                  <Link
                    key={t.id}
                    to={`/planner/view/${t.id}`}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3 hover:border-primary/40 hover:bg-primary/10"
                  >
                    <span className="text-sm font-medium text-foreground">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.modelCount} pieces</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {model.recentReviews && model.recentReviews.length > 0 && (
            <section className="rounded-2xl bg-card p-6 shadow-xs">
              <h2 className="text-lg font-semibold text-foreground">Recent reviews</h2>
              <div className="mt-4 space-y-4">
                {model.recentReviews.map((review) => (
                  <div key={review.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-amber-500">
                        <span className="font-semibold text-foreground">{formatRating(review.rating)}</span>
                        <span className="text-xs text-muted-foreground">{review.reviewerName ?? 'Anonymous'}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(review.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {review.comment && <p className="mt-2 text-sm text-muted-foreground">{review.comment}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {model.versions && model.versions.length > 0 && (
            <section className="rounded-2xl bg-card p-6 shadow-xs">
              <h2 className="text-lg font-semibold text-foreground">Version history</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Own this model? You can re-download the latest version free from your library.
              </p>
              <ul className="mt-4 space-y-3">
                {model.versions.map((v) => (
                  <li key={v.version} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">Version {v.version}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(v.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {v.notes && <p className="mt-1 text-sm text-muted-foreground">{v.notes}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl bg-card p-6 shadow-md">
            <h1 className="text-2xl font-semibold text-foreground">{model.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              by{' '}
              {model.artistId ? (
                <Link to={`/artists/${model.artistId}`} className="text-primary hover:text-primary/80">
                  {model.artistName}
                </Link>
              ) : (
                model.artistName
              )}
            </p>

            {model.artistId && currentUser?.id !== model.artistId && (
              <button
                onClick={messageArtist}
                disabled={messageBusy}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-primary/30 hover:text-primary disabled:opacity-60"
              >
                <MessageSquare size={16} />
                Message artist
              </button>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <PriceDisplay
                price={model.onSale && model.salePrice != null ? model.salePrice : model.basePrice}
                originalPrice={
                  model.onSale && model.salePrice != null ? model.originalPrice ?? model.basePrice : undefined
                }
                salePercent={model.salePercent}
                size="lg"
                showTaxNote
              />
              <span className="text-sm text-muted-foreground">
                Rating {formatRating(model.averageRating)} · {model.reviewCount ?? 0} reviews
              </span>
            </div>

            {model.onSale && model.saleEndsAt && (
              <p className="mt-1 text-xs font-medium text-rose-600">
                Sale ends {new Date(model.saleEndsAt).toLocaleDateString()}
              </p>
            )}

            {model.filesUpdatedAt && (model.fileVersion ?? 1) > 1 && (
              <p className="mt-2 text-xs font-medium text-green-700">
                Updated {new Date(model.filesUpdatedAt).toLocaleDateString()} · v{model.fileVersion}
              </p>
            )}

            {/* Like + share */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleLike}
                disabled={likeBusy}
                aria-pressed={liked}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  liked
                    ? 'border-rose-200 bg-rose-50 text-rose-600'
                    : 'border-border text-muted-foreground hover:border-rose-200 hover:text-rose-600'
                }`}
              >
                <Heart size={16} className={liked ? 'fill-rose-500 text-rose-500' : ''} />
                {likeCount}
              </button>
              <button
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-primary/30 hover:text-primary"
              >
                <Share2 size={16} />
                Share
              </button>
            </div>

            {owned ? (
              <>
                <p className="mt-6 rounded-md bg-green-50 px-3 py-2 text-center text-sm font-medium text-green-800">
                  You own this model
                </p>
                <Button
                  className="mt-3 w-full"
                  onClick={handleDownload}
                  disabled={downloading}
                  leftIcon={<Download size={16} />}
                >
                  {downloading ? 'Preparing…' : model.partCount && model.partCount > 1 ? `Download ZIP (${model.partCount} parts)` : 'Download STL'}
                </Button>
                {downloadError && <p className="mt-2 text-xs text-destructive">{downloadError}</p>}
                <p className="mt-2 text-xs text-muted-foreground">
                  Prepared for your account — print it as often as you like, but please don’t pass
                  the file on.
                </p>
              </>
            ) : inCart ? (
              <Button className="mt-6 w-full" onClick={() => openCart()} variant="outline" leftIcon={<ShoppingCart size={16} />}>
                In cart — view
              </Button>
            ) : (
              <Button className="mt-6 w-full" onClick={handleAddToCart} leftIcon={<ShoppingCart size={16} />}>
                Add to cart
              </Button>
            )}

            {/* Print & Ship reminder — shown when the artist has enabled printing
                for this model. Lets buyers without a 3D printer order it printed. */}
            {FEATURES.printAndShip && model.printConsent && model.printPrice != null && (
              <div className="mt-4 rounded-xl border border-primary/30 bg-primary/10 p-4">
                <div className="flex items-center gap-2">
                  <Printer size={18} className="text-primary" />
                  <h3 className="text-sm font-semibold text-primary">No 3D printer? Print &amp; Ship</h3>
                </div>
                <p className="mt-1.5 text-sm text-primary/80">
                  Order this model printed and delivered to your door — the price covers the print and postage.
                </p>
                <button
                  onClick={handlePrintAndShip}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90"
                >
                  <Printer size={16} />
                  Order printed &amp; shipped · {formatPrice(model.printPrice)}
                </button>
              </div>
            )}

            {/* Usage licence + anti-piracy watermark disclosure. The licence defines
                what a buyer may do with the file; the disclosure is the GDPR notice
                that downloads embed the buyer's identity for traceability. */}
            <div className="mt-6 rounded-xl border border-border bg-muted p-4">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">
                  Licence: {licenseInfo(model.license).label}
                </h3>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{licenseInfo(model.license).description}</p>
              <div className="mt-3 flex items-start gap-2 border-t border-border pt-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  For anti-piracy, every file you download is invisibly watermarked with a
                  code tied to your account and order, so a leaked file can be traced back to
                  the buyer. See our{' '}
                  <Link to="/terms-of-service" className="underline hover:text-foreground">terms</Link> and{' '}
                  <Link to="/privacy-policy" className="underline hover:text-foreground">privacy policy</Link>.
                </p>
              </div>
            </div>

            {/* Printability — artist-declared + automated mesh QA */}
            {(() => {
              const mq = meshQualitySummary(model)
              const printer = printerTypeLabel(model.printerType)
              if (!mq && !printer && model.supportsRequired === undefined) return null
              return (
                <div className="mt-6 rounded-xl border border-border p-4">
                  <h3 className="text-sm font-semibold text-foreground">Printability</h3>
                  {mq && (
                    <p
                      className={`mt-2 text-sm ${
                        mq.tone === 'good' ? 'text-green-700' : 'text-amber-700'
                      }`}
                    >
                      {mq.tone === 'good' ? '✓ ' : '⚠ '}
                      <span className="font-medium">{mq.label}.</span> {mq.detail}
                    </p>
                  )}
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {printer && <li>Printer type: {printer}</li>}
                    {model.supportsRequired !== undefined && (
                      <li>Supports: {model.supportsRequired ? 'required' : 'not required'}</li>
                    )}
                    {model.recommendedLayerHeight != null && (
                      <li>Recommended layer height: {model.recommendedLayerHeight} mm</li>
                    )}
                    {model.recommendedInfill != null && (
                      <li>Recommended infill: {model.recommendedInfill}%</li>
                    )}
                  </ul>
                </div>
              )
            })()}

            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li>Category: {model.category}</li>
              {model.width && model.depth && model.height && (
                <li>
                  Dimensions: {model.width} × {model.depth} × {model.height} mm
                </li>
              )}
              <li>{model.saleCount ?? 0} purchases</li>
              {model.downloadCount !== undefined && <li>{model.downloadCount} downloads</li>}
              {model.viewCount !== undefined && <li>{model.viewCount} total views</li>}
            </ul>

            {/* Report — hidden on the artist's own listing */}
            {currentUser?.id !== model.artistId && (
              <button
                onClick={() => (isAuthenticated ? setReportOpen(true) : navigate('/login'))}
                className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-destructive"
              >
                <Flag size={13} /> Report this model
              </button>
            )}
          </section>
        </aside>
      </div>

      {/* Discovery carousels */}
      <ModelCarousel title="More like this" models={relatedQuery.data ?? []} />
      <ModelCarousel title={`More from ${model.artistName}`} models={sameArtistModels} />

      {reportOpen && (
        <ReportModelModal modelId={model.id} modelName={model.name} onClose={() => setReportOpen(false)} />
      )}
    </div>
  )
}

export default ModelDetails
