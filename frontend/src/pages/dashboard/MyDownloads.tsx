import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Download, Package, Star } from 'lucide-react'
import { ordersApi, type PurchasedModel } from '../../api/endpoints/orders'
import { modelsApi } from '../../api/endpoints/models'
import { formatBytes } from '../../utils/format'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import ReviewModal from '../../components/models/ReviewModal'

/**
 * "My Downloads" — every STL the signed-in buyer owns, in one place, each with a
 * download button and a review prompt. Files are streamed watermarked-per-buyer
 * from the API (see modelsApi.downloadModelStl); ownership + re-download are
 * unlimited, so this is the home base for getting your files instead of hunting
 * through model pages.
 *
 * This used to be two separate pages — "My Models" (/dashboard/models) and "My
 * Downloads" — both driven by the exact same `GET /orders/library` call, one
 * with a review button and no purchase date, the other with a purchase date and
 * no review button. Merged into this one page (2026-09-08); /dashboard/models
 * now redirects here.
 */
const MyDownloads: React.FC = () => {
  const queryClient = useQueryClient()
  const libraryQuery = useQuery({
    queryKey: ['my-library'],
    queryFn: () => ordersApi.getLibrary(),
  })

  const items = libraryQuery.data ?? []
  const [busy, setBusy] = React.useState<Record<string, boolean>>({})
  const [reviewing, setReviewing] = React.useState<PurchasedModel | null>(null)

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

  async function handleDownload(id: string, name: string, parts: number) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await modelsApi.downloadModelStl(id, name)
      toast.success(parts > 1 ? 'Downloading ZIP…' : 'Downloading STL…')
    } catch (err: any) {
      const status = err?.response?.status
      toast.error(
        status === 401
          ? 'Please sign in again to download.'
          : status === 403
            ? "You don't have access to this file."
            : 'Download failed — please try again.',
      )
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">My downloads</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every STL you own, ready to download whenever you like — you only pay once and can
          re-download any time. Each file is prepared for your account, so please keep it to
          yourself rather than passing it on.
        </p>
      </section>

      <section>
        {libraryQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : libraryQuery.isError ? (
          <div className="rounded-2xl border border-border bg-card py-16 text-center shadow-xs">
            <p className="text-sm font-medium text-foreground">We couldn't load your downloads.</p>
            <Button variant="outline" className="mt-4" onClick={() => libraryQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center shadow-xs">
            <Package className="mx-auto text-muted-foreground" size={40} />
            <p className="mt-3 text-sm font-medium text-foreground">You don't own any models yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Once you buy an STL it'll show up here to download.</p>
            <Link
              to="/browse"
              className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Browse models
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {items.length} {items.length === 1 ? 'model' : 'models'}
            </p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const { model, purchasedAt, myReview } = item
                const parts = model.partCount ?? 1
                const isSet = parts > 1
                // Null when R2 is off or a file's size couldn't be read — the button
                // then reads exactly as it did before, with no size suffix.
                const size = formatBytes(model.downloadSizeBytes)
                return (
                  <div
                    key={model.id}
                    className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition hover:shadow-md"
                  >
                    <Link to={`/models/${model.id}`} className="relative block aspect-4/3 bg-muted">
                      {model.thumbnailUrl ? (
                        <img
                          src={model.thumbnailUrl}
                          alt={model.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                          No preview
                        </div>
                      )}
                      {isSet && (
                        <span className="absolute left-2 top-2 rounded-sm bg-gray-900/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Set · {parts} parts
                        </span>
                      )}
                    </Link>

                    <div className="flex flex-1 flex-col p-4">
                      <Link
                        to={`/models/${model.id}`}
                        className="truncate font-medium text-foreground hover:text-primary"
                        title={model.name}
                      >
                        {model.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{model.artistName}</p>
                      {purchasedAt && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Purchased {new Date(purchasedAt).toLocaleDateString('en-GB')}
                        </p>
                      )}
                      {myReview ? (
                        <div className="mt-2 flex items-center gap-1 text-amber-500">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star
                              key={n}
                              size={14}
                              className={n <= myReview.rating ? 'fill-amber-400' : 'fill-none text-muted-foreground'}
                            />
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-col gap-2">
                        <Button
                          className="w-full"
                          onClick={() => handleDownload(model.id, model.name, parts)}
                          disabled={busy[model.id]}
                          leftIcon={<Download size={16} />}
                        >
                          {busy[model.id]
                            ? 'Preparing…'
                            : `${isSet ? `Download ZIP (${parts} parts)` : 'Download STL'}${
                                size ? ` · ${size}` : ''
                              }`}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          leftIcon={<Star size={16} />}
                          onClick={() => setReviewing(item)}
                        >
                          {myReview ? 'Edit review' : 'Write a review'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

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

export default MyDownloads
