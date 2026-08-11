import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Download, Package, ShieldCheck } from 'lucide-react'
import { ordersApi } from '../../api/endpoints/orders'
import { modelsApi } from '../../api/endpoints/models'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'

/**
 * "My Downloads" — every STL the signed-in buyer owns, in one place, each with a
 * download button. Files are streamed watermarked-per-buyer from the API (see
 * modelsApi.downloadModelStl); ownership + re-download are unlimited, so this is
 * the home base for getting your files instead of hunting through model pages.
 */
const MyDownloads: React.FC = () => {
  const libraryQuery = useQuery({
    queryKey: ['my-library'],
    queryFn: () => ordersApi.getLibrary(),
  })

  const items = libraryQuery.data ?? []
  const [busy, setBusy] = React.useState<Record<string, boolean>>({})

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
      <section className="rounded-3xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">My downloads</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">
          Every STL you own, ready to download whenever you like — you only pay once and can
          re-download any time.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          <ShieldCheck size={13} />
          Each file is watermarked to your account
        </p>
      </section>

      <section>
        {libraryQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : libraryQuery.isError ? (
          <div className="rounded-2xl border border-gray-200 bg-white py-16 text-center shadow-xs">
            <p className="text-sm font-medium text-gray-700">We couldn't load your downloads.</p>
            <Button variant="outline" className="mt-4" onClick={() => libraryQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center shadow-xs">
            <Package className="mx-auto text-gray-300" size={40} />
            <p className="mt-3 text-sm font-medium text-gray-700">You don't own any models yet.</p>
            <p className="mt-1 text-xs text-gray-500">Once you buy an STL it'll show up here to download.</p>
            <Link
              to="/browse"
              className="mt-4 inline-flex rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Browse models
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-500">
              {items.length} {items.length === 1 ? 'model' : 'models'}
            </p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map(({ model, purchasedAt }) => {
                const parts = model.partCount ?? 1
                const isSet = parts > 1
                return (
                  <div
                    key={model.id}
                    className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs transition hover:shadow-md"
                  >
                    <Link to={`/models/${model.id}`} className="relative block aspect-4/3 bg-gray-100">
                      {model.thumbnailUrl ? (
                        <img
                          src={model.thumbnailUrl}
                          alt={model.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-xs text-gray-400">
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
                        className="truncate font-medium text-gray-900 hover:text-indigo-700"
                        title={model.name}
                      >
                        {model.name}
                      </Link>
                      <p className="truncate text-xs text-gray-500">{model.artistName}</p>
                      {purchasedAt && (
                        <p className="mt-1 text-[11px] text-gray-400">
                          Purchased {new Date(purchasedAt).toLocaleDateString('en-GB')}
                        </p>
                      )}

                      <Button
                        className="mt-3 w-full"
                        onClick={() => handleDownload(model.id, model.name, parts)}
                        disabled={busy[model.id]}
                        leftIcon={<Download size={16} />}
                      >
                        {busy[model.id]
                          ? 'Preparing…'
                          : isSet
                            ? `Download ZIP (${parts} parts)`
                            : 'Download STL'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default MyDownloads
