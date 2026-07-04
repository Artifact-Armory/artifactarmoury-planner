import React from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ShoppingCart, Download, Heart, Share2 } from 'lucide-react'
import { modelsApi } from '../api/endpoints/models'
import { ordersApi } from '../api/endpoints/orders'
import { artistsApi } from '../api/endpoints/artists'
import type { TerrainModel } from '../api/types'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import { useCartStore } from '../store/cartStore'
import { useAuthStore } from '../store/authStore'
import { formatPrice, formatRating } from '../utils/format'

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

            {model.tags?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {model.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

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
          </section>
        </aside>
      </div>

      {/* Discovery carousels */}
      <ModelCarousel title="More like this" models={relatedQuery.data ?? []} />
      <ModelCarousel title={`More from ${model.artistName}`} models={sameArtistModels} />
    </div>
  )
}

export default ModelDetails
