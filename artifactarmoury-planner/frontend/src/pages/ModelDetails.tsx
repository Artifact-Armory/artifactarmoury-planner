import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, Layers, ShieldCheck, ShoppingCart } from 'lucide-react'
import { modelsApi } from '../api/endpoints/models'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import { useCartStore } from '../store/cartStore'
import { useLibraryStore } from '../store/libraryStore'
import { formatPrice, formatRating } from '../utils/format'
import { formatLicense } from '../utils/licenses'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { ensurePlanningTable } from '../utils/planningTable'
import { useAppStore } from '@state/store'

const ModelDetails: React.FC = () => {
  const { id } = useParams()
  const { addItem, openCart } = useCartStore((state) => ({
    addItem: state.addItem,
    openCart: state.openCart,
  }))
  const addAssetToTable = useLibraryStore((state) => state.addAssetToTable)
  const ensureAssetForModel = useLibraryStore((state) => state.ensureAssetForModel)
  const ownedAssetIds = useLibraryStore((state) => state.ownedAssetIds)
  const ownedModelIds = useLibraryStore((state) => state.ownedModelIds)
  const upsertLibraryAsset = useAppStore((state) => state.actions.upsertLibraryAsset)

  const modelQuery = useQuery({
    queryKey: ['model', id],
    queryFn: () => modelsApi.getModelById(id as string),
    enabled: Boolean(id),
  })

  const relatedQuery = useQuery({
    queryKey: ['related-models', id],
    queryFn: () => modelsApi.getRelatedModels(id as string, 4),
    enabled: Boolean(id),
  })

  const model = modelQuery.data
  const [isInLibrary, setIsInLibrary] = useState(Boolean(model?.inLibrary))
  const [addingToLibrary, setAddingToLibrary] = useState(false)
  const [assetId, setAssetId] = useState<string | null>(model?.assetId ?? null)
  const isOwned = React.useMemo(() => {
    if (assetId && ownedAssetIds.has(assetId)) return true
    return model?.id ? ownedModelIds.has(model.id) : false
  }, [assetId, ownedAssetIds, ownedModelIds, model?.id])

  const galleryImages = useMemo(() => {
    if (!model) return []
    const images = model.images ?? []
    const unique = new Map<string, { id: string; url: string; caption?: string }>()

    if (model.thumbnailUrl) {
      unique.set('__thumbnail', {
        id: '__thumbnail',
        url: model.thumbnailUrl,
        caption: 'Preview render',
      })
    }

    images.forEach((image, index) => {
      const key = image.id ?? `image-${index}`
      const url = image.imageUrl ?? image.imagePath ?? ''
      if (!url) return
      unique.set(key, {
        id: key,
        url,
        caption: image.caption,
      })
    })

    return Array.from(unique.values())
  }, [model])

  const [activeImageIndex, setActiveImageIndex] = useState(0)
  useEffect(() => {
    setActiveImageIndex(0)
  }, [galleryImages.length])
  const activeImage = galleryImages[activeImageIndex]

  useEffect(() => {
    setIsInLibrary(Boolean(model?.inLibrary))
  }, [model?.id, model?.inLibrary])
  useEffect(() => {
    setAssetId(model?.assetId ?? null)
  }, [model?.id, model?.assetId])

  const handleAddToCart = () => {
    if (!model) return
    addItem({
      modelId: model.id,
      name: model.name,
      artistName: model.artistName,
      price: model.basePrice,
      imageUrl: model.thumbnailUrl,
    })
    openCart()
  }

  const handleAddToLibrary = async () => {
    if (!model || addingToLibrary) {
      return
    }

    setAddingToLibrary(true)
    try {
      let resolvedAssetId = assetId
      if (!resolvedAssetId) {
        const ensured = await ensureAssetForModel(model.id)
        if (!ensured?.id) {
          toast.error('This model is not yet available in the asset planning library.')
          return
        }
        resolvedAssetId = ensured.id
        setAssetId(resolvedAssetId)
        upsertLibraryAsset(ensured)
      } else {
        const ensured = await ensureAssetForModel(model.id)
        if (ensured?.id) {
          upsertLibraryAsset(ensured)
        }
      }

      const tableId = await ensurePlanningTable()
      await addAssetToTable(tableId, resolvedAssetId)
      setIsInLibrary(true)
      toast.success('Added to planning library')
      modelQuery.refetch()
    } catch (error: any) {
      console.error('Failed to add model to asset library', error)
      const message =
        error?.response?.data?.message ??
        error?.message ??
        'Unable to add this model to the asset planning library.'
      toast.error(message)
    } finally {
      setAddingToLibrary(false)
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
              {activeImage ? (
                <img
                  key={activeImage.id}
                  src={activeImage.url}
                  alt={model.name}
                  className="h-full w-full object-cover"
                />
              ) : model.thumbnailUrl ? (
                <img src={model.thumbnailUrl} alt={model.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-400">
                  No images available
                </div>
              )}

              {galleryImages.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous image"
                    onClick={() =>
                      setActiveImageIndex((prev) =>
                        prev === 0 ? galleryImages.length - 1 : prev - 1,
                      )
                    }
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 text-gray-700 shadow hover:bg-white"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next image"
                    onClick={() =>
                      setActiveImageIndex((prev) =>
                        prev === galleryImages.length - 1 ? 0 : prev + 1,
                      )
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 text-gray-700 shadow hover:bg-white"
                  >
                    <ChevronRight size={18} />
                  </button>
                </>
              )}
            </div>

            {galleryImages.length > 1 && (
              <div className="flex gap-3 overflow-x-auto p-4">
                {galleryImages.map((image, index) => (
                  <button
                    type="button"
                    key={image.id}
                    onClick={() => setActiveImageIndex(index)}
                    className={`relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border ${
                      activeImageIndex === index
                        ? 'border-indigo-500 ring-2 ring-indigo-500'
                        : 'border-transparent'
                    }`}
                  >
                    <img
                      src={image.url}
                      alt={model.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

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
            <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
              <span>by {model.artistName}</span>
              {model.creatorVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <ShieldCheck size={14} />
                  {model.verificationBadge ?? 'Verified Creator'}
                </span>
              ) : null}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-3xl font-bold text-gray-900">{formatPrice(model.basePrice)}</span>
              <span className="text-sm text-gray-500">
                Rating {formatRating(model.averageRating)} · {model.reviewCount ?? 0} reviews
              </span>
              {isOwned ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-600">
                  Owned
                </span>
              ) : null}
            </div>

            <Button className="mt-6 w-full" onClick={handleAddToCart} leftIcon={<ShoppingCart size={16} />}>
              Add to cart
            </Button>
            <Button
              className="mt-3 w-full"
              variant={isInLibrary ? 'ghost' : 'outline'}
              onClick={handleAddToLibrary}
              leftIcon={
                isInLibrary ? <Check size={16} className="text-emerald-600" /> : <Layers size={16} />
              }
              disabled={isInLibrary}
              loading={addingToLibrary}
            >
              {isInLibrary ? 'In asset library' : 'Add to asset library'}
            </Button>

            <ul className="mt-6 space-y-2 text-sm text-gray-600">
              <li>Category: {model.category}</li>
              <li>License: {formatLicense(model.license)}</li>
              {model.width && model.depth && model.height && (
                <li>
                  Dimensions: {model.width} × {model.depth} × {model.height} mm
                </li>
              )}
              {model.viewCount !== undefined && <li>{model.viewCount} total views</li>}
            </ul>
          </section>

          {relatedQuery.data && relatedQuery.data.length > 0 && (
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">You might also like</h2>
              <ul className="mt-4 space-y-3">
                {relatedQuery.data.slice(0, 4).map((related) => (
                  <li key={related.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 hover:border-indigo-200">
                    <img
                      src={related.thumbnailUrl ?? ''}
                      alt={related.name}
                      className="h-14 w-14 rounded-md object-cover"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{related.name}</p>
                      <p className="text-xs text-gray-500">{formatPrice(related.basePrice)}</p>
                      <p className="text-xs text-gray-400">{related.artistName}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

export default ModelDetails
