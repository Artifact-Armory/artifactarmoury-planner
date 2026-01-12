import React from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ShoppingCart } from 'lucide-react'
import { modelsApi } from '../api/endpoints/models'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import { useCartStore } from '../store/cartStore'
import { formatPrice, formatRating } from '../utils/format'

const ModelDetails: React.FC = () => {
  const { id } = useParams()
  const { addItem, openCart } = useCartStore((state) => ({
    addItem: state.addItem,
    openCart: state.openCart,
  }))

  const modelQuery = useQuery(['model', id], () => modelsApi.getModelById(id as string), {
    enabled: Boolean(id),
  })

  const relatedQuery = useQuery(['related-models', id], () => modelsApi.getRelatedModels(id as string, 4), {
    enabled: Boolean(id),
  })

  const model = modelQuery.data

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
            <p className="mt-2 text-sm text-gray-500">by {model.artistName}</p>

            <div className="mt-4 flex items-center gap-4">
              <span className="text-3xl font-bold text-gray-900">{formatPrice(model.basePrice)}</span>
              <span className="text-sm text-gray-500">
                Rating {formatRating(model.averageRating)} · {model.reviewCount ?? 0} reviews
              </span>
            </div>

            <Button className="mt-6 w-full" onClick={handleAddToCart} leftIcon={<ShoppingCart size={16} />}>
              Add to cart
            </Button>

            <ul className="mt-6 space-y-2 text-sm text-gray-600">
              <li>Category: {model.category}</li>
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
