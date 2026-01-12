import crypto from 'crypto'

export interface MockTable {
  id: string
  userId: string | null
  sessionId: string | null
  name: string
  description: string
  width: number
  depth: number
  layout: any
  isPublic: boolean
  shareCode: string
  viewCount: number
  cloneCount: number
  createdAt: string
  updatedAt: string
}

const mockTablesById = new Map<string, MockTable>()

export function createMockTableId(): string {
  return crypto.randomUUID()
}

export function addMockTable(table: MockTable): void {
  mockTablesById.set(table.id, { ...table })
}

export function getMockTable(tableId: string): MockTable | null {
  const table = mockTablesById.get(tableId)
  return table ? { ...table } : null
}

export function listMockTables(userId?: string | null): MockTable[] {
  const tables = Array.from(mockTablesById.values())
  if (userId) {
    return tables.filter((t) => t.userId === userId)
  }
  return tables
}

export function updateMockTable(tableId: string, updater: (table: MockTable) => void): boolean {
  const table = mockTablesById.get(tableId)
  if (!table) return false

  const updated = { ...table }
  updater(updated)
  mockTablesById.set(tableId, updated)
  return true
}

export function deleteMockTable(tableId: string): boolean {
  return mockTablesById.delete(tableId)
}

