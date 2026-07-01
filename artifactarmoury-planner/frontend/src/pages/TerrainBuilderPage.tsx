import React from 'react'
import TerrainBuilder from '@ui/App'
import { ensurePlanningTable, getStoredPlanningTableId } from '../utils/planningTable'

const TerrainBuilderPage: React.FC = () => {
  const [planningTableId, setPlanningTableId] = React.useState<string | null>(() =>
    getStoredPlanningTableId(),
  )

  React.useEffect(() => {
    let mounted = true
    if (!planningTableId) {
      ensurePlanningTable()
        .then((id) => {
          if (mounted) {
            setPlanningTableId(id)
          }
        })
        .catch((error) => {
          console.error('Failed to ensure planning table', error)
        })
    }
    return () => {
      mounted = false
    }
  }, [planningTableId])

  return <TerrainBuilder tableId={planningTableId ?? undefined} />
}

export default TerrainBuilderPage
