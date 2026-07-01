// backend/src/routes/tables.ts
// Table layout routes aligned with tables schema

import express from 'express'
import crypto from 'crypto'
import { db } from '../db'
import logger from '../utils/logger'
import { validateString } from '../utils/validation'
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/error'
import { createMockTableId, addMockTable, getMockTable, listMockTables, updateMockTable, deleteMockTable, MockTable } from '../mock/mockTables'

const router = express.Router()
const tablesLogger = logger.child('TABLES')
const IS_MOCK_DB = process.env.DB_MOCK === 'true'

const DEFAULT_WIDTH = 1200
const DEFAULT_DEPTH = 900

interface TableRow {
  id: string
  user_id: string | null
  name: string
  description: string | null
  width: number | null
  depth: number | null
  layout: any
  is_public: boolean
  share_code: string | null
  view_count: number | null
  clone_count: number | null
  created_at: string
  updated_at: string
  model_count?: number
  owner_name?: string | null
}

function parseLayout(layout: unknown) {
  if (!layout) {
    return { models: [] }
  }
  if (typeof layout === 'string') {
    try {
      return JSON.parse(layout)
    } catch {
      return { models: [] }
    }
  }
  if (typeof layout === 'object') {
    return layout
  }
  return { models: [] }
}

function mapTableRow(row: TableRow) {
  const layout = parseLayout(row.layout)
  const modelCount =
    row.model_count !== undefined
      ? Number(row.model_count)
      : Array.isArray(layout?.models)
        ? layout.models.length
        : 0

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    width: row.width !== null && row.width !== undefined ? Number(row.width) : null,
    depth: row.depth !== null && row.depth !== undefined ? Number(row.depth) : null,
    layout,
    isPublic: row.is_public,
    shareCode: row.share_code,
    viewCount: Number(row.view_count ?? 0),
    cloneCount: Number(row.clone_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    modelCount,
    ownerName: row.owner_name ?? null,
  }
}

async function requireTableOwnership(tableId: string, req: AuthRequest) {
  const result = await db.query(
    `SELECT user_id FROM tables WHERE id = $1`,
    [tableId]
  )

  if (result.rowCount === 0) {
    return { exists: false, ownerId: null }
  }

  const ownerId: string | null = result.rows[0].user_id
  const isOwner = ownerId !== null && req.userId === ownerId
  const isAdmin = req.user?.role === 'admin'

  return {
    exists: true,
    ownerId,
    allowed: isOwner || isAdmin,
  }
}

function buildPublicSort(sort: string | undefined): string {
  switch (sort) {
    case 'newest':
      return 't.created_at DESC'
    case 'updated':
      return 't.updated_at DESC'
    case 'popular':
    default:
      return 't.view_count DESC, t.clone_count DESC, t.created_at DESC'
  }
}

// ---------------------------------------------------------------------------
// Create table layout
// ---------------------------------------------------------------------------

router.post(
  '/',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const {
      name,
      description = '',
      width,
      depth,
      layout,
      isPublic = false,
    } = req.body as Record<string, unknown>

    validateString(name, 'name', { minLength: 3, maxLength: 255 })

    const widthValue = Number(width ?? DEFAULT_WIDTH)
    const depthValue = Number(depth ?? DEFAULT_DEPTH)

    if (!Number.isFinite(widthValue) || widthValue <= 0) {
      res.status(400).json({ error: 'width must be a positive number' })
      return
    }
    if (!Number.isFinite(depthValue) || depthValue <= 0) {
      res.status(400).json({ error: 'depth must be a positive number' })
      return
    }

    let sessionId: string | null = null
    if (!req.userId) {
      const sessionInfo = req.session
      if (!sessionInfo?.id) {
        res.status(401).json({ error: 'Session required to create tables' })
        return
      }

      const countResult = IS_MOCK_DB
        ? { rows: [{ count: listMockTables(sessionInfo.id).length }] }
        : await db.query(
            `
            SELECT COUNT(*)::INT AS count
            FROM tables
            WHERE session_id = $1
          `,
            [sessionInfo.id],
          )
      const existingCount = countResult.rows[0]?.count ?? 0

      if (existingCount >= sessionInfo.tableLimit) {
        res.status(402).json({
          error: `Table limit reached for this session (limit ${sessionInfo.tableLimit})`,
        })
        return
      }

      sessionId = sessionInfo.id
    }

    const layoutValue = parseLayout(layout)
    const shareCode = crypto.randomBytes(8).toString('hex').toUpperCase()
    const now = new Date().toISOString()

    if (IS_MOCK_DB) {
      const mockTable: MockTable = {
        id: createMockTableId(),
        userId: req.userId ?? null,
        sessionId,
        name: String(name).trim(),
        description: description ? String(description) : '',
        width: widthValue,
        depth: depthValue,
        layout: layoutValue,
        isPublic: Boolean(isPublic),
        shareCode,
        viewCount: 0,
        cloneCount: 0,
        createdAt: now,
        updatedAt: now,
      }

      addMockTable(mockTable)

      tablesLogger.info('Mock table layout created', {
        tableId: mockTable.id,
        userId: mockTable.userId,
        sessionId,
        isPublic: mockTable.isPublic,
      })

      res.status(201).json({
        table: {
          id: mockTable.id,
          userId: mockTable.userId,
          name: mockTable.name,
          description: mockTable.description,
          width: mockTable.width,
          depth: mockTable.depth,
          layout: mockTable.layout,
          isPublic: mockTable.isPublic,
          shareCode: mockTable.shareCode,
          viewCount: mockTable.viewCount,
          cloneCount: mockTable.cloneCount,
          createdAt: mockTable.createdAt,
          updatedAt: mockTable.updatedAt,
          modelCount: Array.isArray(layoutValue?.models) ? layoutValue.models.length : 0,
        },
      })
      return
    }

    const result = await db.query(
      `
      INSERT INTO tables (
        user_id,
        session_id,
        name,
        description,
        width,
        depth,
        layout,
        is_public,
        share_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
      [
        req.userId ?? null,
        sessionId,
        String(name).trim(),
        description ? String(description) : '',
        widthValue,
        depthValue,
        JSON.stringify(layoutValue),
        Boolean(isPublic),
        shareCode,
      ],
    )

    const saved = mapTableRow(result.rows[0])

    tablesLogger.info('Table layout created', {
      tableId: saved.id,
      userId: saved.userId,
      sessionId,
      isPublic: saved.isPublic,
    })

    res.status(201).json({ table: saved })
  }),
)

// ---------------------------------------------------------------------------
// Update table layout
// ---------------------------------------------------------------------------

router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const ownership = await requireTableOwnership(id, req)

    if (!ownership.exists) {
      res.status(404).json({ error: 'Table not found' })
      return
    }

    if (!ownership.allowed) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const { name, description, width, depth, layout, isPublic } = req.body as Record<
      string,
      unknown
    >

    const updates: string[] = []
    const params: any[] = []

    if (name !== undefined) {
      validateString(name, 'name', { minLength: 3, maxLength: 255 })
      updates.push(`name = $${updates.length + 1}`)
      params.push(String(name).trim())
    }

    if (description !== undefined) {
      updates.push(`description = $${updates.length + 1}`)
      params.push(description === null ? null : String(description))
    }

    if (width !== undefined) {
      const widthValue = Number(width)
      if (!Number.isFinite(widthValue) || widthValue <= 0) {
        res.status(400).json({ error: 'width must be a positive number' })
        return
      }
      updates.push(`width = $${updates.length + 1}`)
      params.push(widthValue)
    }

    if (depth !== undefined) {
      const depthValue = Number(depth)
      if (!Number.isFinite(depthValue) || depthValue <= 0) {
        res.status(400).json({ error: 'depth must be a positive number' })
        return
      }
      updates.push(`depth = $${updates.length + 1}`)
      params.push(depthValue)
    }

    if (layout !== undefined) {
      updates.push(`layout = $${updates.length + 1}`)
      params.push(JSON.stringify(parseLayout(layout)))
    }

    if (isPublic !== undefined) {
      updates.push(`is_public = $${updates.length + 1}`)
      params.push(Boolean(isPublic))
    }

    if (updates.length === 0) {
      const current = await db.query(`SELECT * FROM tables WHERE id = $1`, [id])
      res.json({ table: mapTableRow(current.rows[0]) })
      return
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`)
    params.push(id)

    const result = await db.query(
      `
      UPDATE tables
      SET ${updates.join(', ')}
      WHERE id = $${params.length}
      RETURNING *
    `,
      params
    )

    const updated = mapTableRow(result.rows[0])

    tablesLogger.info('Table layout updated', {
      tableId: updated.id,
      userId: updated.userId,
      updatedFields: updates.length,
    })

    res.json({ table: updated })
  })
)

// ---------------------------------------------------------------------------
// Toggle visibility
// ---------------------------------------------------------------------------

router.patch(
  '/:id/visibility',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const { isPublic } = req.body as { isPublic?: boolean }

    if (typeof isPublic !== 'boolean') {
      res.status(400).json({ error: 'isPublic must be a boolean' })
      return
    }

    const ownership = await requireTableOwnership(id, req)
    if (!ownership.exists) {
      res.status(404).json({ error: 'Table not found' })
      return
    }
    if (!ownership.allowed) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const result = await db.query(
      `
      UPDATE tables
      SET is_public = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `,
      [isPublic, id]
    )

    res.json({ table: mapTableRow(result.rows[0]) })
  })
)

// ---------------------------------------------------------------------------
// Delete table
// ---------------------------------------------------------------------------

router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const ownership = await requireTableOwnership(id, req)

    if (!ownership.exists) {
      res.status(404).json({ error: 'Table not found' })
      return
    }
    if (!ownership.allowed) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    await db.query(`DELETE FROM tables WHERE id = $1`, [id])

    tablesLogger.info('Table layout deleted', { tableId: id, userId: req.userId })

    res.json({ message: 'Table deleted successfully' })
  })
)

// ---------------------------------------------------------------------------
// Clone table
// ---------------------------------------------------------------------------

router.post(
  '/:id/clone',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const { name } = req.body as { name?: string }

    const base = await db.query(
      `
      SELECT *
      FROM tables
      WHERE id = $1
    `,
      [id]
    )

    if (base.rowCount === 0) {
      res.status(404).json({ error: 'Table not found' })
      return
    }

    const source = base.rows[0] as TableRow
    const isOwner = source.user_id && source.user_id === req.userId
    const isAdmin = req.user?.role === 'admin'

    if (!source.is_public && !isOwner && !isAdmin) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const shareCode = crypto.randomBytes(8).toString('hex').toUpperCase()
    const cloneName = name ? String(name).trim() : `${source.name} (Copy)`

    const result = await db.query(
      `
      INSERT INTO tables (
        user_id,
        name,
        description,
        width,
        depth,
        layout,
        is_public,
        share_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, false, $7)
      RETURNING *
    `,
      [
        req.userId ?? null,
        cloneName,
        source.description,
        source.width,
        source.depth,
        JSON.stringify(source.layout),
        shareCode,
      ]
    )

    await db.query(
      `UPDATE tables SET clone_count = COALESCE(clone_count, 0) + 1 WHERE id = $1`,
      [id]
    )

    tablesLogger.info('Table layout cloned', {
      sourceId: id,
      cloneId: result.rows[0].id,
      userId: req.userId,
    })

    res.status(201).json({ table: mapTableRow(result.rows[0]) })
  })
)

// ---------------------------------------------------------------------------
// Regenerate share code
// ---------------------------------------------------------------------------

router.post(
  '/:id/regenerate-share-code',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const ownership = await requireTableOwnership(id, req)

    if (!ownership.exists) {
      res.status(404).json({ error: 'Table not found' })
      return
    }
    if (!ownership.allowed) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const newCode = crypto.randomBytes(8).toString('hex').toUpperCase()

    const result = await db.query(
      `
      UPDATE tables
      SET share_code = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `,
      [newCode, id]
    )

    res.json({ table: mapTableRow(result.rows[0]) })
  })
)

// ---------------------------------------------------------------------------
// Get current user's tables
// ---------------------------------------------------------------------------

router.get(
  '/my',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { page = '1', limit = '20' } = req.query as Record<string, string>

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1)
    const limitNum = Math.min(Math.max(1, parseInt(String(limit), 10) || 20), 50)
    const offset = (pageNum - 1) * limitNum

    const totalResult = await db.query(
      `SELECT COUNT(*)::INT AS count FROM tables WHERE user_id = $1`,
      [req.userId]
    )
    const totalCount = totalResult.rows[0]?.count ?? 0

    const result = await db.query(
      `
      SELECT *,
        jsonb_array_length(COALESCE(layout->'models', '[]'::jsonb)) AS model_count
      FROM tables
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2 OFFSET $3
    `,
      [req.userId, limitNum, offset]
    )

    res.json({
      tables: result.rows.map(mapTableRow),
      totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum) || 0,
    })
  })
)

// ---------------------------------------------------------------------------
// Get tables for a user (public)
// ---------------------------------------------------------------------------

router.get(
  '/user/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params
    const { page = '1', limit = '20' } = req.query as Record<string, string>

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1)
    const limitNum = Math.min(Math.max(1, parseInt(String(limit), 10) || 20), 50)
    const offset = (pageNum - 1) * limitNum

    const totalResult = await db.query(
      `SELECT COUNT(*)::INT AS count FROM tables WHERE user_id = $1 AND is_public = true`,
      [userId]
    )
    const totalCount = totalResult.rows[0]?.count ?? 0

    const result = await db.query(
      `
      SELECT
        t.*,
        jsonb_array_length(COALESCE(t.layout->'models', '[]'::jsonb)) AS model_count
      FROM tables t
      WHERE t.user_id = $1 AND t.is_public = true
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3
    `,
      [userId, limitNum, offset]
    )

    res.json({
      tables: result.rows.map(mapTableRow),
      totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum) || 0,
    })
  })
)

// ---------------------------------------------------------------------------
// Public tables listing
// ---------------------------------------------------------------------------

router.get(
  '/public',
  asyncHandler(async (req, res) => {
    const { page = '1', limit = '20', sort = 'popular' } = req.query as Record<
      string,
      string
    >

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1)
    const limitNum = Math.min(Math.max(1, parseInt(String(limit), 10) || 20), 50)
    const offset = (pageNum - 1) * limitNum
    const orderBy = buildPublicSort(sort)

    const totalResult = await db.query(
      `SELECT COUNT(*)::INT AS count FROM tables WHERE is_public = true`
    )
    const totalCount = totalResult.rows[0]?.count ?? 0

    const result = await db.query(
      `
      SELECT
        t.*,
        COALESCE(u.artist_name, u.display_name) AS owner_name,
        jsonb_array_length(COALESCE(t.layout->'models', '[]'::jsonb)) AS model_count
      FROM tables t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.is_public = true
      ORDER BY ${orderBy}
      LIMIT $1 OFFSET $2
    `,
      [limitNum, offset]
    )

    res.json({
      tables: result.rows.map(mapTableRow),
      totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum) || 0,
    })
  })
)

// ---------------------------------------------------------------------------
// Featured tables
// ---------------------------------------------------------------------------

router.get(
  '/featured',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '6'), 10) || 6, 20)

    const result = await db.query(
      `
      SELECT
        t.*,
        COALESCE(u.artist_name, u.display_name) AS owner_name,
        jsonb_array_length(COALESCE(t.layout->'models', '[]'::jsonb)) AS model_count
      FROM tables t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.is_public = true
      ORDER BY t.view_count DESC NULLS LAST, t.clone_count DESC NULLS LAST, t.created_at DESC
      LIMIT $1
    `,
      [limit]
    )

    res.json({ tables: result.rows.map(mapTableRow) })
  })
)

// ---------------------------------------------------------------------------
// Shared table by share code
// ---------------------------------------------------------------------------

router.get(
  '/shared/:shareCode',
  asyncHandler(async (req, res) => {
    const { shareCode } = req.params

    const result = await db.query(
      `
      SELECT
        t.*,
        COALESCE(u.artist_name, u.display_name) AS owner_name,
        jsonb_array_length(COALESCE(t.layout->'models', '[]'::jsonb)) AS model_count
      FROM tables t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.share_code = $1
    `,
      [shareCode]
    )

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Table not found' })
      return
    }

    const table = result.rows[0]

    if (!table.is_public) {
      res.status(403).json({ error: 'Table is not public' })
      return
    }

    res.json({ table: mapTableRow(table) })
  })
)

// ---------------------------------------------------------------------------
// Get table by ID
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params

    if (IS_MOCK_DB) {
      const mockTable = getMockTable(id)
      if (!mockTable) {
        res.status(404).json({ error: 'Table not found' })
        return
      }

      const isOwner = mockTable.userId && req.userId === mockTable.userId
      if (!mockTable.isPublic && !isOwner) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }

      res.json({
        table: {
          id: mockTable.id,
          userId: mockTable.userId,
          name: mockTable.name,
          description: mockTable.description,
          width: mockTable.width,
          depth: mockTable.depth,
          layout: mockTable.layout,
          isPublic: mockTable.isPublic,
          shareCode: mockTable.shareCode,
          viewCount: mockTable.viewCount,
          cloneCount: mockTable.cloneCount,
          createdAt: mockTable.createdAt,
          updatedAt: mockTable.updatedAt,
          modelCount: Array.isArray(mockTable.layout?.models) ? mockTable.layout.models.length : 0,
        },
      })
      return
    }

    const result = await db.query(
      `
      SELECT
        t.*,
        COALESCE(u.artist_name, u.display_name) AS owner_name,
        jsonb_array_length(COALESCE(t.layout->'models', '[]'::jsonb)) AS model_count
      FROM tables t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.id = $1
    `,
      [id]
    )

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Table not found' })
      return
    }

    const table = result.rows[0] as TableRow & { owner_name?: string | null }
    const isOwner = table.user_id && req.userId === table.user_id
    const isAdmin = req.user?.role === 'admin'

    if (!table.is_public && !isOwner && !isAdmin) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    if (table.is_public) {
      db.query('UPDATE tables SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1', [
        id,
      ]).catch((error) => tablesLogger.error('Failed to increment table views', { error, id }))
    }

    res.json({ table: mapTableRow(table) })
  })
)

export default router
