import React from 'react'
import { useAppStore } from '@state/store'
import { ThreeStage } from '@scene/ThreeStage'
import { unitLabel, parseDimensionToMetres } from '@core/units'
import { Basket } from './Basket'
import { ControlsPanel } from './ControlsPanel'
import { StatusBar } from './StatusBar'
import { useLibraryStore, AssetSet, LibraryAsset, TableLibraryAsset } from '@/store/libraryStore'
import { useAuthStore } from '@/store/authStore'
import { ensurePlanningTable } from '@/utils/planningTable'
import { browseApi } from '@/api/endpoints/browse'
import type { TerrainModel, Category, SearchFilters, Pagination } from '@/api/types'
import toast from 'react-hot-toast'
import './styles.css'

type TerrainBuilderProps = {
  tableId?: string
}

const TAB_CONFIG = [
  { key: 'browse', label: 'Browse' },
  { key: 'sets', label: 'Asset Library' },
  { key: 'owned', label: 'Owned Assets' },
] as const

type BuilderTab = (typeof TAB_CONFIG)[number]['key']

type AssetItemProps = {
  asset: LibraryAsset
  onSelect: (asset: LibraryAsset) => void
  onPlace: (asset: LibraryAsset) => void
  onRemove?: (asset: LibraryAsset) => void
}

const AssetListItem: React.FC<AssetItemProps> = ({ asset, onSelect, onPlace, onRemove }) => {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3 shadow-sm hover:border-slate-500 transition">
      <div className="flex gap-3">
        {asset.thumbnail_path ? (
          <img
            src={asset.thumbnail_path}
            alt={asset.name}
            className="h-14 w-14 flex-shrink-0 rounded-md object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-14 w-14 flex-shrink-0 rounded-md border border-dashed border-slate-700 text-[11px] text-slate-400 flex items-center justify-center">
            No preview
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-100">{asset.name}</div>
            {asset.owned ? (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                Owned
              </span>
            ) : null}
          </div>
          <div className="text-xs text-slate-400 line-clamp-2">
            {asset.category ?? 'Uncategorised'}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              className="rounded-md border border-slate-600 px-2 py-1 text-xs font-medium text-slate-200 hover:border-slate-400"
              onClick={() => onSelect(asset)}
              type="button"
            >
              Select
            </button>
            <button
              className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500"
              onClick={() => onPlace(asset)}
              type="button"
            >
              Place on Table
            </button>
            {onRemove ? (
              <button
                className="rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-rose-400 hover:border-rose-400"
                onClick={() => onRemove(asset)}
                type="button"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

const BrowseResultItem: React.FC<{
  model: TerrainModel
  owned?: boolean
  onAddToLibrary: () => void
  onPlace: () => void
}> = ({ model, owned = false, onAddToLibrary, onPlace }) => {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 shadow-sm">
      <div className="flex gap-3">
        {model.thumbnailUrl ? (
          <img
            src={model.thumbnailUrl}
            alt={model.name}
            className="h-16 w-16 flex-shrink-0 rounded-md object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-16 w-16 flex-shrink-0 rounded-md border border-dashed border-slate-700 text-[11px] text-slate-400 flex items-center justify-center">
            No image
          </div>
        )}
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-100 line-clamp-1">{model.name}</h4>
              <p className="text-xs text-slate-400 line-clamp-1">{model.artistName}</p>
            </div>
            {owned ? (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                Owned
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{model.category}</span>
            <span>{model.tags?.slice(0, 2).map((tag) => `#${tag}`).join(' ')}</span>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onAddToLibrary}
              className="flex-1 rounded-md border border-slate-600 px-2 py-1 text-xs font-medium text-slate-200 hover:border-slate-400"
            >
              Save to Library
            </button>
            <button
              type="button"
              onClick={onPlace}
              className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Place on Table
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const AssetSetGroup: React.FC<{
  set: AssetSet
  onSelect: (asset: LibraryAsset) => void
  onPlace: (asset: LibraryAsset) => void
}> = ({ set, onSelect, onPlace }) => {
  return (
    <section className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <header>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-100">{set.name}</h3>
          {set.owner_name ? (
            <span className="text-xs text-slate-400">by {set.owner_name}</span>
          ) : null}
        </div>
        {set.description ? (
          <p className="mt-1 text-xs text-slate-400">{set.description}</p>
        ) : null}
      </header>
      <div className="space-y-2">
        {(set.assets ?? []).length === 0 ? (
          <div className="text-xs text-slate-500">No assets in this set yet.</div>
        ) : (
          set.assets.map((asset) => (
            <AssetListItem
              key={asset.id ?? `${set.id}-${asset.modelId}`}
              asset={asset}
              onSelect={onSelect}
              onPlace={onPlace}
            />
          ))
        )}
      </div>
    </section>
  )
}

export default function App({ tableId }: TerrainBuilderProps) {
  const [activeTab, setActiveTab] = React.useState<BuilderTab>('browse')
  const [showBasket, setShowBasket] = React.useState(false)
  const [browseFilters, setBrowseFilters] = React.useState<Pick<SearchFilters, 'search' | 'category' | 'sortBy'>>({
    search: '',
    category: '',
    sortBy: 'recent',
  })
  const [browsePage, setBrowsePage] = React.useState(1)
  const [browseModels, setBrowseModels] = React.useState<TerrainModel[]>([])
  const [browsePagination, setBrowsePagination] = React.useState<Pagination | null>(null)
  const [browseLoading, setBrowseLoading] = React.useState(false)
  const [browseError, setBrowseError] = React.useState<string | null>(null)
  const [categories, setCategories] = React.useState<Category[]>([])

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  const table = useAppStore((state) => state.table)
  const setTable = useAppStore((state) => state.setTable)
  const setSelectedAsset = useAppStore((state) => state.setSelectedAsset)
  const loadCatalogue = useAppStore((state) => state.actions.loadAssetCatalogue)
  const fitView = useAppStore((state) => state.actions.fitView)
  const addInstance = useAppStore((state) => state.actions.addInstance)
  const basket = useAppStore((state) => state.basket)

  const fetchAssets = useLibraryStore((state) => state.fetchAssets)
  const fetchAssetSets = useLibraryStore((state) => state.fetchAssetSets)
  const fetchTableAssets = useLibraryStore((state) => state.fetchTableAssets)
  const fetchOwnedAssets = useLibraryStore((state) => state.fetchOwnedAssets)
  const trackAssetUsage = useLibraryStore((state) => state.trackAssetUsage)
  const ensureAssetForModel = useLibraryStore((state) => state.ensureAssetForModel)
  const tableAssetsMap = useLibraryStore((state) => state.tableAssets)
  const assetSets = useLibraryStore((state) => state.sets)
  const ownedAssets = useLibraryStore((state) => state.ownedAssets)
  const removeFromLibrary = useLibraryStore((state) => state.removeAssetFromLibrary)
  const upsertLibraryAsset = useAppStore((state) => state.actions.upsertLibraryAsset)
  const removeSceneAsset = useAppStore((state) => state.actions.removeLibraryAsset)

  const planningAssets = React.useMemo(() => {
    if (tableId) {
      return tableAssetsMap[tableId] ?? []
    }
    return []
  }, [tableAssetsMap, tableId])

  React.useEffect(() => {
    loadCatalogue()
    fetchAssets({ limit: 500 })
    fetchAssetSets()
  }, [loadCatalogue, fetchAssets, fetchAssetSets])

  React.useEffect(() => {
    if (tableId) {
      fetchTableAssets(tableId)
    }
  }, [fetchTableAssets, tableId])

  React.useEffect(() => {
    if (isAuthenticated) {
      fetchOwnedAssets()
    }
  }, [isAuthenticated, fetchOwnedAssets])

  // Sync basket when assets are loaded to clean up stale asset IDs
  const syncBasketWithTable = useAppStore((state) => state.actions.syncBasketWithTable)
  React.useEffect(() => {
    syncBasketWithTable()
  }, [syncBasketWithTable])

  const [widthInput, setWidthInput] = React.useState(() => (table.width ?? 1.8288).toString())
  const [heightInput, setHeightInput] = React.useState(() => (table.height ?? 1.2192).toString())
  const [unit, setUnit] = React.useState<'m' | 'cm' | 'ft' | 'in'>(table.unitDisplay ?? 'm')
  const [gridInput, setGridInput] = React.useState(() => (table.gridSize ?? 0.3048).toString())

  const ownedModelIds = useLibraryStore((state) => state.ownedModelIds)
  const [librarySearch, setLibrarySearch] = React.useState('')
  const filteredLibraryAssets = React.useMemo(() => {
    const query = librarySearch.trim().toLowerCase()
    if (!query) return planningAssets
    return planningAssets.filter(
      (asset) =>
        asset.name?.toLowerCase().includes(query) ||
        asset.category?.toLowerCase().includes(query) ||
        asset.tags?.some((tag) => tag.toLowerCase().includes(query)) ||
        asset.artistName?.toLowerCase().includes(query),
    )
  }, [planningAssets, librarySearch])

  const basketCount = basket.reduce((sum, item) => sum + item.quantity, 0)

  const applyTableDimensions = () => {
    const widthM = parseDimensionToMetres(widthInput, unit)
    const heightM = parseDimensionToMetres(heightInput, unit)
    const gridM = parseDimensionToMetres(gridInput, unit)
    setTable({ width: widthM, height: heightM, unitDisplay: unit, gridSize: gridM })
    fitView()
  }

  React.useEffect(() => {
    browseApi
      .getCategories()
      .then((cats) => setCategories(cats))
      .catch((error) => {
        console.error('Failed to load categories', error)
        setCategories([])
      })
  }, [])

  const runBrowseSearch = React.useCallback(async () => {
    setBrowseLoading(true)
    setBrowseError(null)
    try {
      const response = await browseApi.searchModels({
        search: browseFilters.search || undefined,
        category: browseFilters.category || undefined,
        sortBy: browseFilters.sortBy,
        page: browsePage,
        limit: 24,
      })
      setBrowseModels(response.models)
      setBrowsePagination(response.pagination)
      if (response.pagination?.page && response.pagination.page !== browsePage) {
        setBrowsePage(response.pagination.page)
      }
    } catch (error) {
      console.error('Failed to load marketplace models', error)
      setBrowseError('Unable to load marketplace models right now.')
    } finally {
      setBrowseLoading(false)
    }
  }, [browseFilters, browsePage])

  React.useEffect(() => {
    runBrowseSearch()
  }, [runBrowseSearch])

  const handleBrowseFilterChange = (patch: Partial<typeof browseFilters>) => {
    setBrowseFilters((prev) => ({ ...prev, ...patch }))
    setBrowsePage(1)
  }

  const resolveAssetId = async (asset: LibraryAsset) => {
    if (asset.id) return asset.id
    if (asset.modelId) {
      const ensured = await ensureAssetForModel(asset.modelId)
      if (ensured?.id) {
        upsertLibraryAsset(ensured)
        return ensured.id
      }
    }
    return null
  }

  const handleSelectAsset = async (asset: LibraryAsset) => {
    const id = await resolveAssetId(asset)
    if (!id) return
    setSelectedAsset(id)
    if (tableId) {
      await trackAssetUsage(tableId, id)
    }
  }

  const handlePlaceAsset = async (asset: LibraryAsset) => {
    const id = await resolveAssetId(asset)
    if (!id) return
    const currentTable = useAppStore.getState().table
    const centreX = (currentTable.width ?? 1) / 2
    const centreZ = (currentTable.height ?? 1) / 2
    addInstance({
      assetId: id,
      position: { x: centreX, z: centreZ },
      rotationDeg: 0,
    })
    if (tableId) {
      await trackAssetUsage(tableId, id)
    }
  }

  const handleBrowsePageChange = (direction: 'prev' | 'next') => {
    if (browsePagination) {
      const total = browsePagination.totalPages || 1
      const nextPage = direction === 'prev' ? Math.max(1, browsePage - 1) : Math.min(total, browsePage + 1)
      if (nextPage !== browsePage) {
        setBrowsePage(nextPage)
      }
    }
  }

  const handleAddModelToLibrary = async (model: TerrainModel) => {
    try {
      const asset = await ensureAssetForModel(model.id)
      if (!asset?.id) {
        toast.error('Unable to add this model to the planning library.')
        return
      }
      upsertLibraryAsset(asset)
      if (tableId) {
        await fetchTableAssets(tableId)
      }
      toast.success('Model added to your planning library')
    } catch (error) {
      console.error('Failed to add model to library', error)
      toast.error('Unable to add this model to the planning library.')
    }
  }

  const handlePlaceModel = async (model: TerrainModel) => {
    try {
      const asset = await ensureAssetForModel(model.id)
      if (!asset?.id) {
        toast.error('Unable to place this model on the table.')
        return
      }
      upsertLibraryAsset(asset)
      if (tableId) {
        await fetchTableAssets(tableId)
      }
      await handlePlaceAsset(asset)
      toast.success('Model placed on the table')
    } catch (error) {
      console.error('Failed to place model', error)
      toast.error('Unable to place this model on the table just yet.')
    }
  }

  const handleRemovePlanningAsset = async (asset: LibraryAsset) => {
    const targetId = asset.id ?? (asset as TableLibraryAsset).asset_id
    if (!targetId) return
    try {
      await removeFromLibrary(targetId)
      removeSceneAsset(targetId)
      if (tableId) {
        await fetchTableAssets(tableId)
      }
      toast.success('Removed from planning library')
    } catch (error) {
      console.error('Failed to remove asset from library', error)
      toast.error('Unable to remove this asset right now.')
    }
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'browse':
        return (
          <div className="space-y-3">
            <div className="grid gap-2">
              <input
                type="search"
                value={browseFilters.search}
                onChange={(event) => handleBrowseFilterChange({ search: event.target.value })}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Search marketplace models…"
              />
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={browseFilters.category}
                  onChange={(event) => handleBrowseFilterChange({ category: event.target.value })}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.category ?? category.id}>
                      {category.name} ({category.modelCount})
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={browseFilters.sortBy}
                  onChange={(event) => handleBrowseFilterChange({ sortBy: event.target.value as SearchFilters['sortBy'] })}
                >
                  <option value="recent">Newest</option>
                  <option value="popular">Most Popular</option>
                  <option value="sales">Top Selling</option>
                  <option value="rating">Highest Rated</option>
                  <option value="price_low">Price: Low to High</option>
                  <option value="price_high">Price: High to Low</option>
                  <option value="name">Name A-Z</option>
                </select>
              </div>
            </div>
            <div className="space-y-2 overflow-y-auto pb-4">
              {browseLoading ? (
                <div className="text-sm text-slate-400">Loading marketplace models…</div>
              ) : browseError ? (
                <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {browseError}
                </div>
              ) : browseModels.length === 0 ? (
                <div className="text-sm text-slate-400">
                  No marketplace models match your filters. Try a different search.
                </div>
              ) : (
                browseModels.map((model) => (
                  <BrowseResultItem
                    key={model.id}
                    model={model}
                    owned={ownedModelIds.has(model.id)}
                    onAddToLibrary={() => handleAddModelToLibrary(model)}
                    onPlace={() => handlePlaceModel(model)}
                  />
                ))
              )}
            </div>
            {browsePagination && browsePagination.totalPages > 1 ? (
              <div className="flex items-center justify-between text-xs text-slate-300">
                <button
                  type="button"
                  onClick={() => handleBrowsePageChange('prev')}
                  disabled={browseLoading || browsePage <= 1}
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium disabled:opacity-50"
                >
                  Previous
                </button>
                <span>
                  Page {browsePagination.page ?? browsePage} of {browsePagination.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => handleBrowsePageChange('next')}
                  disabled={
                    browseLoading ||
                    (browsePagination.page ?? browsePage) >= (browsePagination.totalPages ?? browsePage)
                  }
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        )
      case 'sets':
        return (
          <div className="space-y-4 overflow-y-auto pb-4">
            <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/80 p-3">
              <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">My Planning Library</h3>
                <span className="text-xs text-slate-400">{planningAssets.length} items</span>
              </header>
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Search saved assets…"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="space-y-2">
                {filteredLibraryAssets.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    {planningAssets.length === 0
                      ? 'No assets in your planning library yet. Add models from the Browse tab.'
                      : 'No assets match your search.'}
                  </div>
                ) : (
                  filteredLibraryAssets.map((asset) => (
                  <AssetListItem
                    key={asset.id}
                    asset={asset}
                    onSelect={handleSelectAsset}
                    onPlace={handlePlaceAsset}
                    onRemove={handleRemovePlanningAsset}
                  />
                  ))
                )}
              </div>
            </section>

            <section className="space-y-3">
              <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">Curated Sets</h3>
                <span className="text-xs text-slate-400">{assetSets.length} sets</span>
              </header>
              {assetSets.length === 0 ? (
                <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-400">
                  No curated sets have been published yet.
                </div>
              ) : (
                assetSets.map((set) => (
                  <AssetSetGroup
                    key={set.id}
                    set={set}
                    onSelect={handleSelectAsset}
                    onPlace={handlePlaceAsset}
                  />
                ))
              )}
            </section>
          </div>
        )
      case 'owned':
        if (!isAuthenticated) {
          return (
            <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-300">
              Sign in to see the models you already own.
            </div>
          )
        }
        return ownedAssets.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-400">
            You haven&apos;t purchased any assets yet. Once you do, they&apos;ll appear here.
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto">
            {ownedAssets.map((asset) => (
              <AssetListItem
                key={asset.id}
                asset={asset}
                onSelect={handleSelectAsset}
                onPlace={handlePlaceAsset}
              />
            ))}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="tb-root">
      <aside className="tb-sidebar">
        <div className="space-y-4">
          <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/80 p-3">
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Table Dimensions</h2>
              <button
                type="button"
                onClick={applyTableDimensions}
                className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                Apply &amp; Fit
              </button>
            </header>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
              <label className="space-y-1">
                <span className="block text-[11px] uppercase tracking-wide text-slate-400">
                  Width ({unitLabel(unit)})
                </span>
                <input
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                  value={widthInput}
                  onChange={(e) => setWidthInput(e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] uppercase tracking-wide text-slate-400">
                  Depth ({unitLabel(unit)})
                </span>
                <input
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                  value={heightInput}
                  onChange={(e) => setHeightInput(e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] uppercase tracking-wide text-slate-400">Units</span>
                <select
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as typeof unit)}
                >
                  <option value="m">Metres</option>
                  <option value="cm">Centimetres</option>
                  <option value="ft">Feet</option>
                  <option value="in">Inches</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] uppercase tracking-wide text-slate-400">
                  Grid ({unitLabel(unit)})
                </span>
                <input
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                  value={gridInput}
                  onChange={(e) => setGridInput(e.target.value)}
                />
              </label>
            </div>
          </section>

          <nav className="flex gap-2">
            {TAB_CONFIG.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold ${
                  activeTab === tab.key
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-hidden">{renderTabContent()}</div>
        </div>
      </aside>

      <div className="tb-stage">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-slate-100">Tabletop Terrain Builder</h1>
            <span className="text-xs text-slate-500">
              Orbit: drag · Pan: <span className="rounded border border-slate-600 px-1 py-0.5">Ctrl</span> + drag · Zoom:
              wheel
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fitView()}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500"
            >
              Fit View
            </button>
            <button
              type="button"
              onClick={() => setShowBasket((prev) => !prev)}
              className={`relative rounded-md px-3 py-1.5 text-xs font-semibold ${
                showBasket ? 'bg-emerald-500 text-white' : 'border border-slate-700 bg-slate-900 text-slate-200'
              }`}
            >
              Basket
              {basketCount > 0 && (
                <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-semibold text-white">
                  {basketCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <div className="tb-canvas-wrap">
          <ThreeStage />
        </div>
        <ControlsPanel />
        <StatusBar />

        {showBasket ? (
          <div className="absolute right-4 top-20 z-40 w-80 max-w-full rounded-lg border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
              <h2 className="text-sm font-semibold text-slate-100">Basket</h2>
              <button
                type="button"
                onClick={() => setShowBasket(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-3">
              <Basket />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
