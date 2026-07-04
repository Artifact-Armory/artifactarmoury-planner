import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ShoppingCart, Check } from 'lucide-react'
import { tablesApi } from '../api/endpoints/tables'
import { modelsApi } from '../api/endpoints/models'
import { useCartStore } from '../store/cartStore'
import { useAuthStore } from '../store/authStore'
import Spinner from '../components/ui/Spinner'
import { formatPrice } from '../utils/format'
import type { TerrainModel } from '../api/types'

/**
 * Public "showcase" view of a saved planner. Buyers can't edit the layout (only
 * the owning artist can, in the planner) — instead they see every model used in
 * the build and can add them all to the basket or cherry-pick specific ones.
 */
const TableDetails: React.FC = () => {
  const { id } = useParams()
  const user = useAuthStore((s) => s.user)
  const addItem = useCartStore((s) => s.addItem)
  const openCart = useCartStore((s) => s.openCart)

  const tableQuery = useQuery({
    queryKey: ['table', id],
    queryFn: () => tablesApi.getById(id as string, { userEmail: user?.email }),
    enabled: Boolean(id),
  })

  // Unique model ids referenced by the layout (skip planner-only set-part ids).
  const modelIds = React.useMemo(() => {
    const raw = (tableQuery.data?.layoutData?.models ?? []) as Array<{ modelId?: string; assetId?: string }>
    const ids = raw
      .map((m) => String(m.modelId ?? m.assetId ?? ''))
      .filter((x) => x && !x.startsWith('part:'))
    return Array.from(new Set(ids))
  }, [tableQuery.data])

  const modelsQuery = useQuery({
    queryKey: ['table-models', id, modelIds],
    enabled: modelIds.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(modelIds.map((mid) => modelsApi.getModelById(mid)))
      return results
        .filter((r): r is PromiseFulfilledResult<TerrainModel> => r.status === 'fulfilled')
        .map((r) => r.value)
    },
  })

  const models = modelsQuery.data ?? []
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  const toggle = (mid: string) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(mid) ? next.delete(mid) : next.add(mid)
      return next
    })

  const addModels = (list: TerrainModel[]) => {
    if (!list.length) return
    list.forEach((m) =>
      addItem(
        {
          kind: 'model',
          id: m.id,
          name: m.name,
          artistName: m.artistName,
          price: m.basePrice,
          imageUrl: m.thumbnailUrl,
        },
        false,
      ),
    )
    openCart()
    toast.success(`Added ${list.length} model${list.length > 1 ? 's' : ''} to your basket`)
  }

  const addAll = () => addModels(models)
  const addSelected = () => addModels(models.filter((m) => selected.has(m.id)))

  if (tableQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (tableQuery.isError || !tableQuery.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Showcase not available</h1>
        <p className="mt-2 text-sm text-gray-500">This layout may be private or no longer exists.</p>
        <Link to="/tables" className="mt-6 inline-flex text-sm font-medium text-indigo-600">Browse showcases</Link>
      </div>
    )
  }

  const table = tableQuery.data
  const total = models.reduce((sum, m) => sum + m.basePrice, 0)

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{table.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {models.length} model{models.length === 1 ? '' : 's'} in this build · {formatPrice(total)} for the full set
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={addSelected}
            disabled={selected.size === 0}
            className="inline-flex items-center gap-2 rounded-md border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
          >
            <Check size={16} /> Add selected ({selected.size})
          </button>
          <button
            onClick={addAll}
            disabled={models.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-40"
          >
            <ShoppingCart size={16} /> Add all to basket
          </button>
        </div>
      </header>

      {modelsQuery.isLoading && (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      )}

      {!modelsQuery.isLoading && models.length === 0 && (
        <p className="mt-10 rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          This showcase doesn&apos;t reference any purchasable models yet.
        </p>
      )}

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {models.map((m) => {
          const isSelected = selected.has(m.id)
          return (
            <li
              key={m.id}
              className={`overflow-hidden rounded-xl border bg-white shadow-sm transition ${
                isSelected ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-100'
              }`}
            >
              <button type="button" onClick={() => toggle(m.id)} className="block w-full text-left">
                <div className="relative h-36 w-full bg-gray-100">
                  {m.thumbnailUrl ? (
                    <img src={m.thumbnailUrl} alt={m.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">No image</div>
                  )}
                  <span
                    className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                      isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-white bg-white/70 text-transparent'
                    }`}
                  >
                    <Check size={14} />
                  </span>
                </div>
              </button>
              <div className="p-3">
                <Link to={`/models/${m.id}`} className="text-sm font-medium text-gray-900 hover:text-indigo-600">
                  {m.name}
                </Link>
                <p className="text-xs text-gray-500">{m.artistName}</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatPrice(m.basePrice)}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default TableDetails
