import React, { Suspense, lazy } from 'react'
import { useParams } from 'react-router-dom'

// Lazy — also loaded statically-elsewhere would defeat code-splitting for
// pages/Planner.tsx's own dynamic import of the same module (Rollup can only
// chunk-split a module that every importer reaches via import()), and it
// keeps this legacy embedded view from pulling the Three.js bundle into pages
// that don't need it.
const TerrainBuilder = lazy(() => import('@ui/App'))

const EditTable: React.FC = () => {
  const { id } = useParams<{ id?: string }>()
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">Tabletop Terrain Builder</h1>
        <p className="text-muted-foreground">
          Design your table layout, export purchase lists, and save presets for future games.
        </p>
      </header>

      <div className="rounded-xl shadow-lg overflow-hidden bg-black/30 border border-gray-900/40">
        <div style={{ minHeight: '640px', height: 'calc(100vh - 280px)' }}>
          <Suspense
            fallback={
              <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
                Loading planner…
              </div>
            }
          >
            <TerrainBuilder tableId={id} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export default EditTable
