import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Download, Star, Package } from 'lucide-react'
import { ordersApi, type PurchasedModel } from '../../api/endpoints/orders'
import { modelsApi } from '../../api/endpoints/models'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import ReviewModal from '../../components/models/ReviewModal'

const MyModels: React.FC = () => {
  const queryClient = useQueryClient()
  const [reviewing, setReviewing] = useState<PurchasedModel | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const libraryQuery = useQuery({
    queryKey: ['my-library'],
    queryFn: () => ordersApi.getLibrary(),
  })

  const items = libraryQuery.data ?? []

  const reviewMutation = useMutation({
    mutationFn: (data: { modelId: string; rating: number; comment: string }) =>
      modelsApi.createReview(data),
    onSuccess: () => {
      toast.success('Thanks for your review!')
      setReviewing(null)
      queryClient.invalidateQueries({ queryKey: ['my-library'] })
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'Could not save your review. Please try again.'),
  })

  const handleDownload = async (item: PurchasedModel) => {
    setDownloadingId(item.model.id)
    try {
      await modelsApi.downloadModelStl(item.model.id, item.model.name)
    } catch {
      toast.error('Download failed. Please try again.')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">My models</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every model you've purchased — download the STL any time and leave a review.
        </p>
      </section>

      {libraryQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : items.length ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const { model, myReview } = item
            const isSet = (model.partCount ?? 1) > 1
            return (
              <article
                key={model.id}
                className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs"
              >
                <Link to={`/models/${model.id}`} className="relative block h-44 w-full overflow-hidden bg-muted">
                  {model.thumbnailUrl ? (
                    <img src={model.thumbnailUrl} alt={model.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                      No preview
                    </div>
                  )}
                  {isSet && (
                    <span className="absolute left-2 top-2 rounded-full bg-gray-900/80 px-2 py-1 text-xs font-medium text-white">
                      SET · {model.partCount} parts
                    </span>
                  )}
                </Link>

                <div className="flex flex-1 flex-col px-4 py-4">
                  <Link to={`/models/${model.id}`} className="line-clamp-1 text-base font-semibold text-foreground hover:text-primary">
                    {model.name}
                  </Link>
                  <p className="line-clamp-1 text-sm text-muted-foreground">by {model.artistName}</p>

                  {myReview ? (
                    <div className="mt-3 flex items-center gap-1 text-amber-500">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          size={16}
                          className={n <= myReview.rating ? 'fill-amber-400' : 'fill-none text-muted-foreground'}
                        />
                      ))}
                      <span className="ml-1 text-xs text-muted-foreground">Your rating</span>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">You haven't reviewed this yet.</p>
                  )}

                  <div className="mt-4 flex flex-col gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      loading={downloadingId === model.id}
                      leftIcon={<Download size={16} />}
                      onClick={() => handleDownload(item)}
                    >
                      {isSet ? `Download ZIP (${model.partCount})` : 'Download STL'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      leftIcon={<Star size={16} />}
                      onClick={() => setReviewing(item)}
                    >
                      {myReview ? 'Edit review' : 'Write a review'}
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <Package className="mx-auto text-muted-foreground" size={40} />
          <p className="mt-4 text-sm font-medium text-foreground">You haven't purchased any models yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">Browse the marketplace to start your collection.</p>
          <Link to="/browse" className="mt-5 inline-block">
            <Button variant="primary">Browse the marketplace</Button>
          </Link>
        </div>
      )}

      {reviewing && (
        <ReviewModal
          modelName={reviewing.model.name}
          isEditing={!!reviewing.myReview}
          initialRating={reviewing.myReview?.rating ?? 0}
          initialComment={reviewing.myReview?.comment ?? ''}
          submitting={reviewMutation.isPending}
          onClose={() => setReviewing(null)}
          onSubmit={({ rating, comment }) =>
            reviewMutation.mutate({ modelId: reviewing.model.id, rating, comment })
          }
        />
      )}
    </div>
  )
}

export default MyModels
