import { tablesApi } from '../api/endpoints/tables'
import type { TableLayoutCreateRequest, TableLayoutModel } from '../api/types'

const STORAGE_KEY = 'terrain_builder.activeTableId'

const DEFAULT_TABLE_PAYLOAD: TableLayoutCreateRequest = {
  name: 'Planning Table',
  description: 'Session planning table',
  width: 1800,
  depth: 1200,
  layout: { models: [] as TableLayoutModel[] },
  isPublic: false,
}

export const getStoredPlanningTableId = (): string | null => {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STORAGE_KEY)
}

export const setStoredPlanningTableId = (tableId: string) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, tableId)
}

export const ensurePlanningTable = async (): Promise<string> => {
  const existing = getStoredPlanningTableId()
  if (existing) return existing

  const table = await tablesApi.createTable({
    name: DEFAULT_TABLE_PAYLOAD.name,
    description: DEFAULT_TABLE_PAYLOAD.description,
    width: DEFAULT_TABLE_PAYLOAD.width,
    depth: DEFAULT_TABLE_PAYLOAD.depth,
    layout: DEFAULT_TABLE_PAYLOAD.layout,
    isPublic: DEFAULT_TABLE_PAYLOAD.isPublic,
  })

  if (table?.id) {
    setStoredPlanningTableId(table.id)
    return table.id
  }

  throw new Error('Failed to create planning table')
}
