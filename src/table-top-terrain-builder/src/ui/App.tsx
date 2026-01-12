import React, { useEffect } from 'react'

import { useAppStore } from '@state/store'
import { ThreeStage } from '@scene/ThreeStage'

import { LeftSidebar, useMarketplaceAssets } from './LeftSidebar'
import { BasketPill } from './BasketPill'
import { BottomToolbar } from './BottomToolbar'
import { QuickStats } from './QuickStats'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { ContextMenuOverlay } from './ContextMenuOverlay'
import { TopToolbar } from './TopToolbar'
import { ModelModal } from './ModelModal'

export default function App() {
  const { data: assetsData, isLoading } = useMarketplaceAssets()

  useEffect(() => {
    if (assetsData) {
      useAppStore.setState({ assets: assetsData })
    } else if (!isLoading) {
      useAppStore.setState({ assets: [] })
    }
  }, [assetsData, isLoading])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="absolute inset-0">
        <ThreeStage />
      </div>

      <TopToolbar>
        <BasketPill inline />
      </TopToolbar>
      <LeftSidebar assets={assetsData} isLoading={isLoading} />
      <BottomToolbar />
      <QuickStats />
      <KeyboardShortcuts />
      <ContextMenuOverlay />
      <ModelModal />
    </div>
  )
}
