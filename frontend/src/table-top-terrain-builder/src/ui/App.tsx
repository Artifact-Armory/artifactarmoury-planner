import React, { useEffect, useState } from 'react'

import { useAppStore } from '@state/store'
import { ThreeStage } from '@scene/ThreeStage'

import { LeftSidebar, useMarketplaceAssets } from './LeftSidebar'
import { BasketPill } from './BasketPill'
import { BottomToolbar } from './BottomToolbar'
import { QuickStats } from './QuickStats'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { ContextMenuOverlay } from './ContextMenuOverlay'
import { TopToolbar } from './TopToolbar'
import { MODEL_SHOWCASE_ENABLED } from '@/config/features'
import { AssetDrawer } from '@/components/VirtualTable/AssetDrawer'
import { useLibraryStore } from '@/store/libraryStore'
import { toast } from 'react-hot-toast'

type TerrainBuilderProps = {
  tableId?: string
}

const TerrainBuilder: React.FC<TerrainBuilderProps> = ({ tableId }) => {
  const { data: assetsData = [], isLoading } = useMarketplaceAssets()
  const assets = MODEL_SHOWCASE_ENABLED ? assetsData : []
  const loadingAssets = MODEL_SHOWCASE_ENABLED && isLoading
  const setSelectedAsset = useAppStore((state) => state.setSelectedAsset)
  const addToBasket = useAppStore((state) => state.actions.addToBasket)
  const { trackAssetUsage } = useLibraryStore()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (MODEL_SHOWCASE_ENABLED) {
      useAppStore.setState({ assets })
    } else {
      useAppStore.setState({ assets: [] })
    }
  }, [assets])

  const handleAssetSelect = async (assetId: string) => {
    if (tableId) {
      await trackAssetUsage(tableId, assetId)
    }
    setSelectedAsset(assetId)
    addToBasket(assetId, 1)
    toast.success('Asset ready to place on table. Click the table to place it.', { duration: 2500 })
    setDrawerOpen(false)
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="absolute inset-0">
        <ThreeStage />
      </div>

      <TopToolbar>
        <BasketPill inline />
      </TopToolbar>
      <LeftSidebar assets={assets} isLoading={loadingAssets} />
      <BottomToolbar />
      <QuickStats />
      <KeyboardShortcuts />
      <ContextMenuOverlay />

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="absolute top-4 right-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        📚 Asset Library
      </button>

      <AssetDrawer
        tableId={tableId}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelectAsset={handleAssetSelect}
      />
    </div>
  )
}

export default TerrainBuilder
