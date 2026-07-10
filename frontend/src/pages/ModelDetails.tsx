import React from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ShoppingCart, Download, Heart, Share2, Flag, MessageSquare, Printer } from 'lucide-react'
import { modelsApi } from '../api/endpoints/models'
import { ordersApi } from '../api/endpoints/orders'
import { artistsApi } from '../api/endpoints/artists'
import { messagesApi } from '../api/endpoints/messages'
import type { TerrainModel } from '../api/types'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import { useCartStore } from '../store/cartStore'
import { useAuthStore } from '../store/authStore'
import { formatPrice, formatRating } from '../utils/format'
import { TRADEMARK_DISCLAIMER } from '../components/legal/TrademarkDisclaimer'
import ReportModelModal from '../components/reports/ReportModelModal'

/** Horizontal, scrollable strip of model tiles used for the discovery carousels. */
const ModelCarousel: React.FC<{ title: string; models: TerrainModel[] }> = ({ title, models }) => {
  if (!models.length) return null
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
        {models.map((m) => (
          <Link
            key={m.id}
            to={`/models/${m.id}`}
            className="group w-44 flex-shrink-0 rounded-xl border border-gray-100 bg-white p-2 shadow-sm hover:border-indigo-200 hover:shadow"
          >
            <div className="h-32 w-full overflow-hidden rounded-lg bg-gray-100">
              {m.thumbnailUrl ? (
                <img src={m.thumbnailUrl} alt={m.name} className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">No image</div>
              )}
            </div>
            <p className="mt-2 truncate text-sm font-medium text-gray-900">{m.name}</p>
            <p className="text-xs text-gray-500">{formatPrice(m.basePrice)}</p>
            <p className="truncate text-xs text-gray-400">{m.artistName}</p>
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
    const shareData = { title: model?.name ?? 'Artifact Planner model', url }
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
      price: model.basePrice,
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
        <h1 className="text-2xl font-semibold text-gray-900">Model not found</h1>
        <p className="mt-2 text-sm text-gray-500">We couldn&apos;t load this model. It may be private or removed.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="relative h-80 w-full bg-gray-100">
              {model.thumbnailUrl ? (
                <img src={model.thumbnailUrl} alt={model.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-400">No thumbnail available</div>
              )}
            </div>
            {model.images && model.images.length > 0 && (
              <div className="flex gap-3 overflow-x-auto p-4">
                {model.images.map((image) => (
                  <img
                    key={image.id}
                    src={image.imageUrl ?? image.imagePath}
                    alt={image.caption ?? model.name}
                    className="h-20 w-20 flex-shrink-0 rounded-lg object-cover"
                  />
                ))}
              </div>
            )}
          </div>

          {model.partCount && model.partCount > 1 && (
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                  SET · {model.partCount} parts
                </span>
                <h2 className="text-lg font-semibold text-gray-900">Multi-part model</h2>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                This piece comes as {model.partCount} STL files — buy once and download them all as a
                ZIP. Each part can be placed separately in the planner.
              </p>
              {model.parts && model.parts.length > 0 && (
                <ul className="mt-4 divide-y">
                  {[{ id: 'primary', name: 'Part 1', thumbnailUrl: model.thumbnailUrl }, ...model.parts].map((p, i) => (
                    <li key={p.id} className="flex items-center gap-3 py-2">
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                        {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <span className="text-sm text-gray-700">{p.name || `Part ${i + 1}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Description</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">{model.description ?? 'No description provided.'}</p>

            {model.taxonomyTerms?.length ? (
              <div className="mt-5 space-y-2 border-t border-gray-100 pt-4">
                {Object.entries(
                  model.taxonomyTerms.reduce<Record<string, typeof model.taxonomyTerms>>((acc, t) => {
                    ;(acc[t.facetName] ||= []).push(t)
                    return acc
                  }, {}),
                ).map(([facetName, terms]) => (
                  <div key={facetName} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{facetName}</span>
                    {terms.map((t) => (
                      <Link
                        key={t.termId}
                        to={`/browse?terms=${encodeURIComponent(`${t.facetSlug}:${t.path}`)}`}
                        className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
                      >
                        {t.name}
                      </Link>
                    ))}
                  </div>
                ))}
                {model.taxonomyTerms.some((t) => t.facetSlug === 'designed-for') && (
                  <p className="pt-1 text-[11px] leading-relaxed text-gray-400">{TRADEMARK_DISCLAIMER}</p>
                )}
              </div>
            ) : model.tags?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {model.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          {tablesQuery.data && tablesQuery.data.length > 0 && (
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">
                Featured in {tablesQuery.data.length} table{tablesQuery.data.length === 1 ? '' : 's'}
              </h2>
              <p className="mt-1 text-sm text-gray-500">See this piece in a full build — shop the whole look.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {tablesQuery.data.map((t) => (
                  <Link
                    key={t.id}
                    to={`/planner/view/${t.id}`}
                    className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/40"
                  >
                    <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    <span className="text-xs text-gray-400">{t.modelCount} pieces</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {model.recentReviews && model.recentReviews.length > 0 && (
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Recent reviews</h2>
              <div className="mt-4 space-y-4">
                {model.recentReviews.map((review) => (
                  <div key={review.id} className="rounded-lg border border-gray-100 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-amber-500">
                        <span className="font-semibold text-gray-900">{formatRating(review.rating)}</span>
                        <span className="text-xs text-gray-500">{review.reviewerName ?? 'Anonymous'}</span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(review.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {review.comment && <p className="mt-2 text-sm text-gray-600">{review.comment}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl bg-white p-6 shadow-md">
            <h1 className="text-2xl font-semibold text-gray-900">{model.name}</h1>
            <p className="mt-2 text-sm text-gray-500">
              by{' '}
              {model.artistId ? (
                <Link to={`/artists/${model.artistId}`} className="text-indigo-600 hover:text-indigo-700">
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
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:border-indigo-200 hover:text-indigo-600 disabled:opacity-60"
              >
                <MessageSquare size={16} />
                Message artist
              </button>
            )}

            <div className="mt-4 flex items-center gap-4">
              <span className="text-3xl font-bold text-gray-900">{formatPrice(model.basePrice)}</span>
              <span className="text-sm text-gray-500">
                Rating {formatRating(model.averageRating)} · {model.reviewCount ?? 0} reviews
              </span>
            </div>

            {/* Like + share */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleLike}
                disabled={likeBusy}
                aria-pressed={liked}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  liked
                    ? 'border-rose-200 bg-rose-50 text-rose-600'
                    : 'border-gray-200 text-gray-600 hover:border-rose-200 hover:text-rose-600'
                }`}
              >
                <Heart size={16} className={liked ? 'fill-rose-500 text-rose-500' : ''} />
                {likeCount}
              </button>
              <button
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-indigo-200 hover:text-indigo-600"
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
                {downloadError && <p className="mt-2 text-xs text-red-600">{downloadError}</p>}
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
            {model.printConsent && model.printPrice != null && (
              <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
                <div className="flex items-center gap-2">
                  <Printer size={18} className="text-indigo-600" />
                  <h3 className="text-sm font-semibold text-indigo-900">No 3D printer? Print &amp; Ship</h3>
                </div>
                <p className="mt-1.5 text-sm text-indigo-800/80">
                  Order this model printed and delivered to your door — the price covers the print and postage.
                </p>
                <button
                  onClick={handlePrintAndShip}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                >
                  <Printer size={16} />
                  Order printed &amp; shipped · {formatPrice(model.printPrice)}
                </button>
              </div>
            )}

            <ul className="mt-6 space-y-2 text-sm text-gray-600">
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
                className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-red-600"
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
