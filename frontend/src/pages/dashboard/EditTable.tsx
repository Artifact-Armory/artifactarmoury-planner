import React from 'react'
import { useParams } from 'react-router-dom'
import TerrainBuilder from '@ui/App'

const EditTable: React.FC = () => {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">Tabletop Terrain Builder</h1>
        <p className="text-gray-600">
          Design your table layout, export purchase lists, and save presets for future games.
        </p>
      </header>

      <div className="rounded-xl shadow-lg overflow-hidden bg-black/30 border border-gray-900/40">
        <div style={{ minHeight: '640px', height: 'calc(100vh - 280px)' }}>
          <TerrainBuilder tableId={id} />
        </div>
      </div>
    </div>
  )
}

export default EditTable
