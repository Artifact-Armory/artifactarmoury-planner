import React from 'react'
import ModelCard from './ModelCard'
import { TerrainModel } from '../../api/types'

interface ModelGridProps {
  models: TerrainModel[]
  emptyMessage?: string
}

const ModelGrid: React.FC<ModelGridProps> = ({ models, emptyMessage }) => {
  if (!models.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          {emptyMessage ?? 'No models found. Try adjusting your filters.'}
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {models.map((model) => (
        <ModelCard key={model.id} model={model} />
      ))}
    </div>
  )
}

export default ModelGrid

