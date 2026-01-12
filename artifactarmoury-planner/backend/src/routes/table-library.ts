// backend/src/routes/table-library.ts
// Table-scoped asset library operations

import { Router } from 'express'
import { db } from '../db'
import { asyncHandler, ValidationError } from '../middleware/error'
import { AuthRequest, optionalAuth } from '../middleware/auth'
import logger from '../utils/logger'
import { getMockTable, updateMockTable } from '../mock/mockTables'
import { findMockModel } from '../mock/mockModels'

const tableLibraryLogger = logger.child('TABLE_LIBRARY')
const router = Router({ mergeParams: true })
const IS_MOCK_DB = process.env.DB_MOCK === 'true'

router.use(optionalAuth)

interface TableRecord {
  id: string
  user_id: string | null
  session_id: string | null
  is_public: boolean
}

async function loadTable(tableId: string): Promise<TableRecord | null> {
  const result = await db.query(
    `
    SELECT id, user_id, session_id, is_public
    FROM tables
    WHERE id = $1
  `,
    [tableId],
  )

  return result.rows[0] ?? null
}

function canModifyTable(req: AuthRequest, table: TableRecord): boolean {
  if (req.user?.role === 'admin') return true
  if (table.user_id && req.userId && table.user_id === req.userId) return true
  if (!table.user_id && table.session_id && req.session?.isAnonymous && req.session.id === table.session_id) {
    return true
  }
  return false
}

function canViewTable(req: AuthRequest, table: TableRecord): boolean {
  if (table.is_public) return true
  return canModifyTable(req, table)
}

router.get(
  '/:tableId/library/assets',
  asyncHandler(async (req: AuthRequest, res) => {
    const { tableId } = req.params

    if (IS_MOCK_DB) {
      const mockTable = getMockTable(tableId)
      if (!mockTable) {
        res.status(404).json({ error: 'Table not found' })
        return
      }

      // In mock mode, return the assets from the table layout with full details
      const assets = (mockTable.layout?.models ?? []).map((model: any) => {
        // Extract model ID from asset ID (e.g., "mock-asset-mock-model-8" -> "mock-model-8")
        const modelIdMatch = model.assetId.match(/mock-model-\d+/)
        const mockModel = modelIdMatch ? findMockModel(modelIdMatch[0]) : null

        return {
          asset_id: model.assetId,
          quantity: model.quantity ?? 1,
          last_used: model.addedAt,
          name: mockModel?.model.name ?? `Asset ${model.assetId}`,
          description: mockModel?.model.description ?? '',
          category: mockModel?.model.category ?? 'terrain',
          tags: mockModel?.model.tags ?? [],
          preview_url: mockModel?.model.glbFilePath ?? '',
          thumbnail_path: mockModel?.model.thumbnailPath ?? '',
          base_price: mockModel?.model.price ?? 0,
          glb_file_path: mockModel?.model.glbFilePath ?? '',
          model_id: mockModel?.model.id ?? null,
          artist_name: null,
          artist_display_name: null,
        }
      })

      res.json({ assets })
      return
    }

    const table = await loadTable(tableId)

    if (!table) {
      res.status(404).json({ error: 'Table not found' })
      return
    }

    if (!canViewTable(req, table)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const result = await db.query(
      `
      SELECT
        ta.asset_id,
        ta.quantity,
        ta.last_used,
        a.name,
        a.description,
        a.category,
        a.tags,
        a.preview_url,
        a.thumbnail_path,
        a.base_price,
        a.glb_file_path,
        m.id AS model_id,
        u.artist_name,
        u.display_name AS artist_display_name
      FROM table_assets ta
      JOIN assets a ON a.id = ta.asset_id
      LEFT JOIN models m ON m.stl_file_path = a.file_ref
      LEFT JOIN users u ON u.id = m.artist_id
      WHERE ta.table_id = $1
      ORDER BY ta.last_used DESC, a.name ASC
    `,
      [tableId],
    )

    res.json({ assets: result.rows })
  }),
)

router.post(
  '/:tableId/library/assets',
  asyncHandler(async (req: AuthRequest, res) => {
    const { tableId } = req.params
    const { assetId, asset_id, quantity } = req.body as {
      assetId?: string
      asset_id?: string
      quantity?: number
    }

    const resolvedAssetId = assetId ?? asset_id
    if (!resolvedAssetId) {
      throw new ValidationError('assetId is required')
    }

    if (IS_MOCK_DB) {
      const mockTable = getMockTable(tableId)
      if (!mockTable) {
        res.status(404).json({ error: 'Table not found' })
        return
      }

      const qty = quantity && Number.isFinite(quantity) && quantity > 0 ? Number(quantity) : 1

      // In mock mode, just accept any asset ID and add it to the table
      updateMockTable(tableId, (draft) => {
        if (!draft.layout) {
          draft.layout = { models: [] }
        }
        if (!Array.isArray(draft.layout.models)) {
          draft.layout.models = []
        }

        // Check if asset already exists
        const existingIndex = draft.layout.models.findIndex((m: any) => m.assetId === resolvedAssetId)
        if (existingIndex >= 0) {
          // Update quantity
          draft.layout.models[existingIndex].quantity = qty
        } else {
          // Add new asset
          draft.layout.models.push({
            assetId: resolvedAssetId,
            quantity: qty,
            addedAt: new Date().toISOString(),
          })
        }
      })

      res.json({ success: true, message: 'Asset added to table' })
      return
    }

    const table = await loadTable(tableId)
    if (!table) {
      res.status(404).json({ error: 'Table not found' })
      return
    }

    if (!canModifyTable(req, table)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const assetResult = await db.query(
      `
      SELECT id
      FROM assets
      WHERE id = $1 AND status = 'published' AND visibility = 'public'
    `,
      [resolvedAssetId],
    )

    if (assetResult.rows.length === 0) {
      res.status(404).json({ error: 'Asset not found' })
      return
    }

    const qty = quantity && Number.isFinite(quantity) && quantity > 0 ? Number(quantity) : 1

    await db.query(
      `
      INSERT INTO table_assets (table_id, asset_id, quantity, added_by, last_used)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (table_id, asset_id)
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        last_used = CURRENT_TIMESTAMP
    `,
      [tableId, resolvedAssetId, qty, req.userId ?? null],
    )

    await db.query(
      `
      UPDATE assets
      SET add_count = add_count + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
      [resolvedAssetId],
    )

    tableLibraryLogger.info('Asset added to table', {
      tableId,
      assetId: resolvedAssetId,
      userId: req.userId ?? null,
    })

    res.status(201).json({ success: true })
  }),
)

router.delete(
  '/:tableId/library/assets/:assetId',
  asyncHandler(async (req: AuthRequest, res) => {
    const { tableId, assetId } = req.params

    if (IS_MOCK_DB) {
      const mockTable = getMockTable(tableId)
      if (!mockTable) {
        res.status(404).json({ error: 'Table not found' })
        return
      }

      // In mock mode, remove the asset from the table layout
      updateMockTable(tableId, (draft) => {
        if (draft.layout?.models && Array.isArray(draft.layout.models)) {
          draft.layout.models = draft.layout.models.filter((m: any) => m.assetId !== assetId)
        }
      })

      res.json({ success: true })
      return
    }

    const table = await loadTable(tableId)

    if (!table) {
      res.status(404).json({ error: 'Table not found' })
      return
    }

    if (!canModifyTable(req, table)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    await db.query(
      `
      DELETE FROM table_assets
      WHERE table_id = $1 AND asset_id = $2
    `,
      [tableId, assetId],
    )

    res.json({ success: true })
  }),
)

export default router
