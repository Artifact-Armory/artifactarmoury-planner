import React, { useMemo, useRef, useState } from 'react'
import {
  ShoppingBag,
  FolderOpen,
  Search,
  CheckCircle2,
  Filter,
  GripVertical,
  Loader2,
  PackagePlus,
  BadgeCheck,
  X,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'

import { useAppStore } from '@state/store'
import { useBuilderUIStore } from '@state/uiStore'
import type { Asset } from '@core/assets'
import { modelsApi } from '@/api/endpoints/models'
import type { TerrainModel } from '@/api/types'
import { useAuthStore } from '@/store/authStore'
import { MODEL_SHOWCASE_ENABLED } from '@/config/features'

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const MARKET_FILTERS = ['All', 'Verified', 'New'] as const
const COLLECTION_FILTERS = ['all', 'basket', 'table'] as const

type MarketFilter = (typeof MARKET_FILTERS)[number]
type CollectionFilter = (typeof COLLECTION_FILTERS)[number]

type SidebarPanel = 'marketplace' | 'collection'

interface LeftSidebarProps {
  assets?: Asset[]
  isLoading: boolean
}

export function LeftSidebar({ assets = [], isLoading }: LeftSidebarProps) {
  const activePanel = useBuilderUIStore((state) => state.activePanel)
  const togglePanel = useBuilderUIStore((state) => state.togglePanel)
  const setActivePanel = useBuilderUIStore((state) => state.setActivePanel)

  return (
    <>
      <TabBar activePanel={activePanel} onToggle={togglePanel} />
      <MarketplacePanel
        assets={assets}
        isLoading={MODEL_SHOWCASE_ENABLED && isLoading}
        open={activePanel === 'marketplace'}
        onClose={() => setActivePanel(null)}
      />
      <CollectionPanel
        assets={assets}
        open={activePanel === 'collection'}
        onClose={() => setActivePanel(null)}
      />
    </>
  )
}

function TabBar({ activePanel, onToggle }: { activePanel: SidebarPanel | null; onToggle: (panel: SidebarPanel) => void }) {
  return (
    <div className="fixed left-0 top-20 z-40 flex w-14 flex-col items-center gap-4 rounded-r-lg border border-white/10 bg-slate-900/90 px-2 py-4 shadow-2xl backdrop-blur-md">
      <TabBarButton
        icon={ShoppingBag}
        label="Market"
        active={activePanel === 'marketplace'}
        onClick={() => onToggle('marketplace')}
      />
      <TabBarButton
        icon={FolderOpen}
        label="Mine"
        active={activePanel === 'collection'}
        onClick={() => onToggle('collection')}
      />
    </div>
  )
}

function TabBarButton({ icon: Icon, label, active, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={active}
      className={cn(
        'relative flex h-14 w-full flex-col items-center justify-center gap-1 rounded-r-md border-l-4 text-xs font-semibold transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500',
        active
          ? 'border-sky-400 bg-sky-500/80 text-white shadow-lg'
          : 'border-transparent bg-slate-800/40 text-slate-300 hover:bg-slate-800/80',
      )}
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

interface MarketplacePanelProps {
  assets: Asset[]
  isLoading: boolean
  open: boolean
  onClose: () => void
}

function MarketplacePanel({ assets, isLoading, open, onClose }: MarketplacePanelProps) {
  const addToBasket = useAppStore((state) => state.actions.addToBasket)
  const openModelModal = useBuilderUIStore((state) => state.openModelModal)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MarketFilter>('All')
  const [visibleCount, setVisibleCount] = useState(8)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const filteredAssets = useMemo(() => {
    const lower = query.trim().toLowerCase()
    return assets
      .filter((asset) => {
        if (filter === 'Verified') {
          return !!asset.verifiedCreator
        }
        if (filter === 'New') {
          const createdTag = asset.tags?.find((tag) => tag.toLowerCase().includes('new'))
          return Boolean(createdTag)
        }
        return true
      })
      .filter((asset) => {
        if (!lower) return true
        return asset.name.toLowerCase().includes(lower) || asset.tags.some((tag) => tag.toLowerCase().includes(lower))
      })
  }, [assets, filter, query])

  const visibleAssets = filteredAssets.slice(0, visibleCount)
  const hasMore = visibleCount < filteredAssets.length

  React.useEffect(() => {
    setVisibleCount(8)
  }, [filter, query, assets.length])

  React.useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setVisibleCount((count) => Math.min(count + 6, filteredAssets.length))
        }
      })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [filteredAssets.length])

  if (!MODEL_SHOWCASE_ENABLED) {
    return (
      <SlidingPanel open={open} onClose={onClose} title="Marketplace">
        <div className="sticky top-0 z-10 space-y-3 bg-slate-800/95 pb-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-50">Marketplace</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close marketplace panel"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-700/60 text-slate-200 transition-colors hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="mt-6 rounded-lg border border-dashed border-white/10 bg-slate-900/80 px-5 py-12 text-center text-sm text-slate-300">
          Marketplace browsing is currently disabled. Uploads you create will appear here once the catalogue is reopened.
        </div>
      </SlidingPanel>
    )
  }

  return (
    <SlidingPanel open={open} onClose={onClose} title="Marketplace">
      <div className="sticky top-0 z-10 space-y-3 bg-slate-800/95 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-50">Marketplace</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close marketplace panel"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-700/60 text-slate-200 transition-colors hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models, creators, tags"
            className="w-full rounded-md border border-white/10 bg-slate-700/70 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
            aria-label="Search marketplace"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {MARKET_FILTERS.map((chip) => (
            <button
              key={chip}
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500',
                filter === chip ? 'bg-sky-500/80 text-white shadow-md' : 'bg-slate-700/70 text-slate-300 hover:bg-slate-600/70',
              )}
              onClick={() => setFilter(chip)}
            >
              <Filter className="h-3 w-3" aria-hidden="true" />
              {chip}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex-1 space-y-4 overflow-y-auto pr-2">
        {isLoading ? (
          <SkeletonList />
        ) : filteredAssets.length === 0 ? (
          <EmptyState message="No models found. Try adjusting filters." />
        ) : (
          <>
            {visibleAssets.map((asset) => (
              <MarketplaceListItem
                key={asset.id}
                asset={asset}
                onAdd={() => {
                  toast.success(`${asset.name} added to collection`, { duration: 2000 })
                }}
                onPreview={() => openModelModal(asset.id)}
                onPlace={() => {
                  addToBasket(asset.id, 1)
                  toast.success(`${asset.name} added to basket`, { duration: 2000 })
                }}
              />
            ))}
            <div ref={sentinelRef} />
            {hasMore && (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => Math.min(count + 6, filteredAssets.length))}
                className="mb-4 w-full rounded-md border border-white/10 bg-slate-700/70 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                Load More
              </button>
            )}
          </>
        )}
      </div>
    </SlidingPanel>
  )
}

function MarketplaceListItem({
  asset,
  onPreview,
  onAdd,
  onPlace,
}: {
  asset: Asset
  onPreview: () => void
  onAdd: () => void
  onPlace: () => void
}) {
  const creatorName = asset.creatorName ?? 'Your Collection'

  return (
    <div className="group overflow-hidden rounded-lg border border-white/10 bg-slate-800/70 shadow-md transition-all duration-200 hover:shadow-lg">
      <div className="relative aspect-square w-full overflow-hidden">
        {asset.thumbnail ? (
          <img src={asset.thumbnail} alt={`${asset.name} preview`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 via-slate-700 to-slate-600 text-3xl font-semibold text-white/70">
            {asset.name.slice(0, 2)}
          </div>
        )}
        {typeof asset.price === 'number' && (
          <span className="absolute bottom-2 right-2 rounded-full bg-sky-500 px-2 py-0.5 text-xs font-semibold text-white shadow-md">
            £{asset.price.toFixed(2)}
          </span>
        )}
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex translate-y-3 flex-col gap-2 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={onPlace}
            className="pointer-events-auto inline-flex items-center justify-center gap-1 rounded-md bg-sky-500/90 px-3 py-1 text-xs font-semibold text-white shadow-md hover:bg-sky-500"
          >
            Add to Basket
          </button>
          <button
            type="button"
            onClick={onPreview}
            className="pointer-events-auto inline-flex items-center justify-center gap-1 rounded-md bg-white/20 px-3 py-1 text-xs font-semibold text-white hover:bg-white/30"
          >
            Quick View
          </button>
        </div>
      </div>
      <div className="space-y-2 px-4 py-3">
        <button
          type="button"
          onClick={onPreview}
          className="w-full truncate text-left text-base font-medium text-slate-100 hover:text-sky-300 focus:outline-none"
        >
          {asset.name}
        </button>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>{creatorName}</span>
          {asset.verifiedCreator && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />}
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled
          className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-200 opacity-80"
        >
          <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Added to Collection
        </button>
      </div>
    </div>
  )
}

interface CollectionPanelProps {
  assets: Asset[]
  open: boolean
  onClose: () => void
}

function CollectionPanel({ assets, open, onClose }: CollectionPanelProps) {
  const instances = useAppStore((state) => state.instances)
  const basket = useAppStore((state) => state.basket)
  const removeFromBasket = useAppStore((state) => state.actions.removeFromBasket)
  const addToBasket = useAppStore((state) => state.actions.addToBasket)
  const setSelectedAsset = useAppStore((state) => state.setSelectedAsset)
  const openModelModal = useBuilderUIStore((state) => state.openModelModal)

  const [sectionOpen, setSectionOpen] = useState({ basket: true, owned: true })
  const [filter, setFilter] = useState<CollectionFilter>('all')

  const basketIds = useMemo(() => new Set(basket.map((item) => item.assetId)), [basket])
  const placedCounts = useMemo(() => {
    const map = new Map<string, number>()
    instances.forEach((instance) => {
      map.set(instance.assetId, (map.get(instance.assetId) ?? 0) + 1)
    })
    return map
  }, [instances])

  const basketAssets = assets.filter((asset) => basketIds.has(asset.id))
  const ownedAssets = assets.filter((asset) => !basketIds.has(asset.id))

  const filteredOwned = ownedAssets.filter((asset) => {
    if (filter === 'table') {
      return (placedCounts.get(asset.id) ?? 0) > 0
    }
    return true
  })

  const showBasketSection = filter === 'all' || filter === 'basket'
  const showOwnedSection = filter === 'all' || filter === 'table'

  const handlePlace = (assetId: string) => {
    setSelectedAsset(assetId)
    addToBasket(assetId, 1)
    toast.success('Asset ready to place on table', { duration: 2000 })
  }

  return (
    <SlidingPanel open={open} onClose={onClose} title="My Collection">
      <div className="sticky top-0 z-10 space-y-3 bg-slate-800/95 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-50">My Collection</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close collection panel"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-700/60 text-slate-200 transition-colors hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex gap-2">
          {COLLECTION_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'flex-1 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500',
                filter === value ? 'bg-sky-500/80 text-white shadow-md' : 'bg-slate-700/70 text-slate-300 hover:bg-slate-600/70',
              )}
            >
              {value === 'all' ? 'All' : value === 'basket' ? 'In Basket' : 'On Table'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex-1 space-y-4 overflow-y-auto pr-2">
        {showBasketSection && (
          <CollectionSection
            title="In Basket"
            count={basketAssets.length}
            isOpen={sectionOpen.basket}
            onToggle={() => setSectionOpen((prev) => ({ ...prev, basket: !prev.basket }))}
            accent="sky"
          >
            {basketAssets.length === 0 ? (
              <EmptyState message="Basket is empty." />
            ) : (
              basketAssets.map((asset) => (
                <CollectionBasketItem
                  key={asset.id}
                  asset={asset}
                  placedCount={placedCounts.get(asset.id) ?? 0}
                  onRemove={() => removeFromBasket(asset.id)}
                  onPreview={() => openModelModal(asset.id)}
                />
              ))
            )}
          </CollectionSection>
        )}

        {showOwnedSection && (
          <CollectionSection
            title="Owned Models"
            count={filteredOwned.length}
            isOpen={sectionOpen.owned}
            onToggle={() => setSectionOpen((prev) => ({ ...prev, owned: !prev.owned }))}
          >
            {filteredOwned.length === 0 ? (
              <EmptyState message="No models yet. Browse the Marketplace!" />
            ) : (
              filteredOwned.map((asset) => (
                <CollectionOwnedItem
                  key={asset.id}
                  asset={asset}
                  placedCount={placedCounts.get(asset.id) ?? 0}
                  onPlace={() => handlePlace(asset.id)}
                  onPreview={() => openModelModal(asset.id)}
                />
              ))
            )}
          </CollectionSection>
        )}
      </div>
    </SlidingPanel>
  )
}

function SlidingPanel({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <aside
      aria-hidden={!open}
      aria-label={title}
      className={cn(
        'fixed top-20 left-14 z-30 flex h-[calc(100vh-5rem)] w-[400px] flex-col overflow-hidden rounded-r-xl border border-white/10 bg-slate-800/95 shadow-2xl backdrop-blur-lg transition-transform duration-300 ease-out md:left-14 md:w-[400px] max-md:left-0 max-md:w-full max-md:rounded-none',
        open ? 'translate-x-0' : 'md:-translate-x-[420px] -translate-x-full',
      )}
    >
      {children}
    </aside>
  )
}

function CollectionSection({ title, count, isOpen, onToggle, accent = 'slate', children }: { title: string; count: number; isOpen: boolean; onToggle: () => void; accent?: 'slate' | 'sky'; children: React.ReactNode }) {
  const badgeClasses = accent === 'sky' ? 'bg-sky-500 text-white' : 'bg-slate-600 text-slate-100'
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-slate-800/60 shadow-md">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <span>{title}</span>
        <span className="inline-flex items-center gap-2 text-xs text-slate-300">
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', badgeClasses)}>{count}</span>
          <svg className={cn('h-3 w-3 transition-transform', isOpen ? 'rotate-90' : '')} viewBox="0 0 8 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M1 11L6 6L1 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div className={cn('grid transition-[max-height,opacity] duration-300 ease-out', isOpen ? 'max-h-[999px] opacity-100' : 'max-h-0 opacity-0')}>
        <div className="space-y-3 px-4 py-3">{children}</div>
      </div>
    </section>
  )
}

function CollectionBasketItem({ asset, placedCount, onRemove, onPreview }: { asset: Asset; placedCount: number; onRemove: () => void; onPreview: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
      {asset.thumbnail ? (
        <img src={asset.thumbnail} alt="Thumbnail" className="h-14 w-14 rounded-md object-cover" />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded-md bg-slate-700/70 text-sm font-semibold text-white/70">
          {asset.name.slice(0, 2)}
        </div>
      )}
      <div className="flex flex-1 flex-col">
        <button
          type="button"
          onClick={onPreview}
          className="truncate text-left font-semibold text-slate-100 hover:text-sky-300 focus:outline-none"
        >
          {asset.name}
        </button>
        {placedCount > 0 && (
          <span className="text-xs text-emerald-400">On table ×{placedCount}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove from basket"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-700/60 text-slate-300 transition-colors hover:bg-red-500/20 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-400"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

function CollectionOwnedItem({ asset, placedCount, onPlace, onPreview }: { asset: Asset; placedCount: number; onPlace: () => void; onPreview: () => void }) {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData('application/x-terrain-asset', asset.id)
    event.dataTransfer.setData('text/plain', asset.id)
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.dropEffect = 'copy'
    useAppStore.getState().setSelectedAsset(asset.id)
    toast('Drag onto the table to place', { duration: 2000 })
  }

  return (
    <div
      className="group flex items-center gap-3 rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 shadow-md transition-shadow hover:shadow-lg"
      draggable
      onDragStart={handleDragStart}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-800/70 text-slate-400">
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </span>
      {asset.thumbnail ? (
        <img src={asset.thumbnail} alt="Thumbnail" className="h-16 w-16 rounded-md object-cover" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-md bg-slate-700/70 text-base font-semibold text-white/70">
          {asset.name.slice(0, 2)}
        </div>
      )}
      <div className="flex flex-1 flex-col">
        <button
          type="button"
          onClick={onPreview}
          className="truncate text-left text-sm font-semibold text-slate-100 hover:text-sky-300 focus:outline-none"
        >
          {asset.name}
        </button>
        {placedCount > 0 && (
          <span className="text-xs text-emerald-400">On table ×{placedCount}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onPlace}
        className="inline-flex items-center gap-1 rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-white opacity-0 transition-all duration-200 group-hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" /> Place
      </button>
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="animate-pulse overflow-hidden rounded-lg border border-white/10 bg-slate-800/60">
          <div className="aspect-square bg-slate-700/50" />
          <div className="space-y-2 px-4 py-3">
            <div className="h-4 w-3/4 rounded bg-slate-700/60" />
            <div className="h-3 w-1/2 rounded bg-slate-700/50" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-white/10 bg-slate-800/40 px-4 py-6 text-center text-sm text-slate-300">
      <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden="true" />
      <p>{message}</p>
    </div>
  )
}

export function useMarketplaceAssets() {
  return useQuery<Asset[]>({
    queryKey: ['terrain-assets', 'my-models'],
    staleTime: 60 * 1000,
    retry: false,
    enabled: MODEL_SHOWCASE_ENABLED,
    initialData: [],
    queryFn: async () => {
      try {
        const { models } = await modelsApi.getMyModels({ limit: 200 })
        const userId = useAuthStore.getState().user?.id
        const ownModels = userId
          ? models.filter((model) => model.artistId === userId && model.inLibrary)
          : []
        return ownModels
          .filter((model) => Boolean(model.glbUrl))
          .map(mapModelToAsset)
      } catch (error) {
        console.error('Failed to load user models for terrain builder', error)
        return []
      }
    },
  })
}

function normalizeDimension(value?: number): number {
  const fallback = 0.2
  if (!value || value <= 0) return fallback
  if (value > 10) return value / 1000
  return value
}

function mapModelToAsset(model: TerrainModel): Asset {
  const width = normalizeDimension(model.width)
  const depth = normalizeDimension(model.depth)
  const height = normalizeDimension(model.height)
  const grid = 0.3
  const cols = Math.max(1, Math.round(width / grid))
  const rows = Math.max(1, Math.round(depth / grid))

  const previewImages = model.previewImages && model.previewImages.length > 0
    ? model.previewImages
    : model.images?.map((image) => image.imageUrl ?? image.imagePath ?? '').filter(Boolean) ?? []

  const fileFormats = ['STL']
  if (model.glbUrl) fileFormats.push('GLB')

  return {
    id: model.id,
    name: model.name,
    tags: Array.isArray(model.tags) ? model.tags : [],
    aabb: { x: Math.max(width, 0.1), y: Math.max(height, 0.1), z: Math.max(depth, 0.1) },
    footprint: { cols, rows },
    rotationStepDeg: 15,
    price: model.basePrice,
    model: model.glbUrl ?? undefined,
    thumbnail: model.thumbnailUrl ?? previewImages[0],
    creatorName: model.artistName ?? 'You',
    verifiedCreator: true,
    description: model.description,
    license: model.tags.find((tag) => tag.toLowerCase().includes('license')) ?? 'Standard License',
    previewImages,
    triangleCount: model.printStats?.triangleCount,
    fileFormats,
    creatorAvatar: undefined,
    printSettings: model.printStats ? { ...model.printStats } : undefined,
  }
}
