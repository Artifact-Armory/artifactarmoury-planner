// backend/src/routes/tables.ts
import express from 'express'
import crypto from 'crypto'
import { db } from '../db'
import logger from '../utils/logger'
import { validateString } from '../utils/validation'

const router = express.Router()
const tablesLogger = logger.child('TABLES')

const TABLE_SELECT_BASE = `
  SELECT 
    t.id,
    t.user_id,
    t.name,
    t.description,
    t.width,
    t.depth,
    t.layout,
    t.is_public,
    t.share_code,
    t.view_count,
    t.clone_count,
    t.created_at,
    t.updated_at,
    u.email AS user_email
  FROM tables t
  LEFT JOIN users u ON u.id = t.user_id
`

const DEFAULT_WIDTH = 1200
const DEFAULT_DEPTH = 900

type ResolveUserResult = {
  userId: string | null
  notFoundEmail?: string
}

type TableRow = {
  id: string
  user_id: string | null
  user_email: string | null
  name: string
  description: string | null
  width: number
  depth: number
  layout: any
  is_public: boolean
  share_code: string
  view_count: number
  clone_count: number
  created_at: Date
  updated_at: Date
}

const mapTable = (row: TableRow) => ({
  id: row.id,
  user_id: row.user_id,
  user_email: row.user_email ?? null,
  name: row.name,
  description: row.description,
  table_config: {
    width: Number(row.width),
    depth: Number(row.depth)
  },
  width: Number(row.width),
  depth: Number(row.depth),
  layout: row.layout,
  layout_data: row.layout,
  is_public: row.is_public,
  share_token: row.share_code,
  share_code: row.share_code,
  view_count: row.view_count,
  clone_count: row.clone_count,
  created_at: row.created_at,
  updated_at: row.updated_at
})

async function fetchTableById(id: string) {
  const result = await db.query(`${TABLE_SELECT_BASE} WHERE t.id = $1`, [id])
  return result.rows[0] ? mapTable(result.rows[0] as TableRow) : null
}

async function resolveUserReference(explicitId?: string | null, email?: string | null): Promise<ResolveUserResult> {
  if (explicitId) {
    return { userId: explicitId }
  }

  if (email) {
    const lookup = await db.query('SELECT id FROM users WHERE email = $1', [email])
    if (lookup.rows.length === 0) {
      return { userId: null, notFoundEmail: email }
    }

    return { userId: lookup.rows[0].id }
  }

  return { userId: null }
}

function extractDimensions(tableConfig: any) {
  if (!tableConfig || typeof tableConfig !== 'object') {
    return { width: DEFAULT_WIDTH, depth: DEFAULT_DEPTH }
  }

  const widthCandidate =
    tableConfig.width ??
    tableConfig.tableWidth ??
    tableConfig.dimensions?.width

  const depthCandidate =
    tableConfig.depth ??
    tableConfig.tableDepth ??
    tableConfig.dimensions?.depth

  const width = Number(widthCandidate)
  const depth = Number(depthCandidate)

  return {
    width: Number.isFinite(width) ? width : DEFAULT_WIDTH,
    depth: Number.isFinite(depth) ? depth : DEFAULT_DEPTH
  }
}

function normaliseLayout(layout: any) {
  if (!layout || typeof layout !== 'object') {
    return { models: [] }
  }

  if (!Array.isArray(layout.models)) {
    return { models: [] }
  }

  return layout
}

// ============================================================================
// SAVE TABLE LAYOUT
// ============================================================================

router.post('/', async (req, res, next) => {
  try {
    const {
      user_id,
      userId,
      user_email,
      name,
      description,
      table_config,
      layout_data,
      is_public = false
    } = req.body as any

    validateString(name, 'name', { minLength: 3, maxLength: 255 })

    if (!layout_data || typeof layout_data !== 'object') {
      return res.status(400).json({ error: 'layout_data is required' })
    }

    if (!Array.isArray(layout_data.models)) {
      return res.status(400).json({ error: 'layout_data.models must be an array' })
    }

    const resolvedUser = await resolveUserReference(user_id ?? userId ?? null, user_email)

    if (resolvedUser.notFoundEmail) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!resolvedUser.userId) {
      return res.status(400).json({ error: 'user_id or user_email is required' })
    }

    const { width, depth } = extractDimensions(table_config)
    const layout = normaliseLayout(layout_data)
    const shareCode = crypto.randomBytes(16).toString('hex').toUpperCase()

    const insertResult = await db.query(
      `INSERT INTO tables (
        user_id,
        name,
        description,
        width,
        depth,
        layout,
        is_public,
        share_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        resolvedUser.userId,
        name,
        description ?? null,
        width,
        depth,
        JSON.stringify(layout),
        is_public,
        shareCode
      ]
    )

    const table = await fetchTableById(insertResult.rows[0].id)

    tablesLogger.info('Table saved', {
      tableId: table?.id,
      userId: resolvedUser.userId,
      modelCount: layout.models.length
    })

    res.status(201).json({ table })
  } catch (error) {
    tablesLogger.error('Save table failed', { error })
    next(error)
  }
})

// ============================================================================
// UPDATE TABLE LAYOUT
// ============================================================================

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      user_id,
      userId,
      user_email,
      name,
      description,
      table_config,
      layout_data,
      is_public
    } = req.body as any

    const ownerResult = await db.query('SELECT user_id FROM tables WHERE id = $1', [id])
    if (ownerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' })
    }

    const resolvedUser = await resolveUserReference(user_id ?? userId ?? null, user_email)
    if (resolvedUser.notFoundEmail) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!resolvedUser.userId) {
      return res.status(400).json({ error: 'user_id or user_email is required' })
    }

    if (ownerResult.rows[0].user_id !== resolvedUser.userId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    if (layout_data && (!Array.isArray(layout_data.models) || typeof layout_data !== 'object')) {
      return res.status(400).json({ error: 'layout_data.models must be an array' })
    }

    const updates: string[] = []
    const values: any[] = []
    let paramIndex = 1

    if (name !== undefined) {
      validateString(name, 'name', { minLength: 3, maxLength: 255 })
      updates.push(`name = $${paramIndex++}`)
      values.push(name)
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`)
      values.push(description)
    }

    if (table_config !== undefined) {
      const { width, depth } = extractDimensions(table_config)
      updates.push(`width = $${paramIndex++}`)
      values.push(width)
      updates.push(`depth = $${paramIndex++}`)
      values.push(depth)
    }

    if (layout_data !== undefined) {
      updates.push(`layout = $${paramIndex++}`)
      values.push(JSON.stringify(normaliseLayout(layout_data)))
    }

    if (typeof is_public === 'boolean') {
      updates.push(`is_public = $${paramIndex++}`)
      values.push(is_public)
    }

    if (!updates.length) {
      const table = await fetchTableById(id)
      return res.json({ table })
    }

    updates.push(`updated_at = NOW()`)

    await db.query(
      `UPDATE tables SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      [...values, id]
    )

    const table = await fetchTableById(id)
    res.json({ table })
  } catch (error) {
    tablesLogger.error('Update table failed', { error, tableId: req.params.id })
    next(error)
  }
})

// ============================================================================
// GET TABLES FOR USER
// ============================================================================

router.get('/user/:identifier', async (req, res, next) => {
  try {
    const { identifier } = req.params
    const {
      page = '1',
      limit = '20'
    } = req.query as Record<string, string>

    const pageNum = parseInt(page) || 1
    const limitNum = Math.min(parseInt(limit) || 20, 50)
    const offset = (pageNum - 1) * limitNum

    let ownerId: string | null = null
    if (identifier.includes('@')) {
      const resolved = await resolveUserReference(null, identifier)
      if (resolved.notFoundEmail) {
        return res.status(404).json({ error: 'User not found' })
      }
      ownerId = resolved.userId
    } else {
      ownerId = identifier
    }

    if (!ownerId) {
      return res.status(400).json({ error: 'Invalid user identifier' })
    }

    const countResult = await db.query(
      'SELECT COUNT(*) AS total FROM tables WHERE user_id = $1',
      [ownerId]
    )
    const total = parseInt(countResult.rows[0].total, 10)

    const tablesResult = await db.query(
      `${TABLE_SELECT_BASE}
       WHERE t.user_id = $1
       ORDER BY t.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [ownerId, limitNum, offset]
    )

    res.json({
      tables: tablesResult.rows.map(row => mapTable(row as TableRow)),
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum)
    })
  } catch (error) {
    tablesLogger.error('Get user tables failed', { error, identifier: req.params.identifier })
    next(error)
  }
})

// ============================================================================
// GET SHARED TABLE (by share token - public)
// ============================================================================

router.get('/shared/:token', async (req, res, next) => {
  try {
    const { token } = req.params

    const result = await db.query(
      `${TABLE_SELECT_BASE} WHERE t.share_code = $1`,
      [token]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shared table not found' })
    }

    const tableRow = result.rows[0]

    if (!tableRow.is_public) {
      return res.status(403).json({ error: 'Table is not public' })
    }

    db.query('UPDATE tables SET view_count = view_count + 1 WHERE id = $1', [tableRow.id])
      .catch(err => tablesLogger.error('Failed to increment view count', { error: err }))

    res.json({ table: mapTable(tableRow as TableRow) })
  } catch (error) {
    tablesLogger.error('Get shared table failed', { error, token: req.params.token })
    next(error)
  }
})

// ============================================================================
// GET SINGLE TABLE (by ID - requires ownership unless public)
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      user_id,
      userId,
      user_email
    } = req.query as Record<string, string>

    const table = await fetchTableById(id)

    if (!table) {
      return res.status(404).json({ error: 'Table not found' })
    }

    if (!table.is_public) {
      const resolvedUser = await resolveUserReference(user_id ?? userId ?? null, user_email ?? null)
      if (resolvedUser.notFoundEmail) {
        return res.status(404).json({ error: 'User not found' })
      }

      if (!resolvedUser.userId || resolvedUser.userId !== table.user_id) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    }

    tablesLogger.debug('Table fetched', {
      tableId: id,
      isPublic: table.is_public
    })

    res.json({ table })
  } catch (error) {
    tablesLogger.error('Get table failed', { error, tableId: req.params.id })
    next(error)
  }
})

// ============================================================================
// DELETE TABLE
// ============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_id, userId, user_email } = req.body as Record<string, string>

    const resolvedUser = await resolveUserReference(user_id ?? userId ?? null, user_email ?? null)

    if (resolvedUser.notFoundEmail) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!resolvedUser.userId) {
      return res.status(400).json({ error: 'user_id or user_email is required' })
    }

    const result = await db.query(
      'DELETE FROM tables WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, resolvedUser.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found or forbidden' })
    }

    tablesLogger.info('Table deleted', {
      tableId: id,
      userId: resolvedUser.userId
    })

    res.json({ message: 'Table deleted successfully' })
  } catch (error) {
    tablesLogger.error('Delete table failed', { error, tableId: req.params.id })
    next(error)
  }
})

// ============================================================================
// TOGGLE TABLE VISIBILITY
// ============================================================================

router.patch('/:id/visibility', async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_id, userId, user_email, is_public } = req.body as any

    if (typeof is_public !== 'boolean') {
      return res.status(400).json({ error: 'is_public must be a boolean' })
    }

    const resolvedUser = await resolveUserReference(user_id ?? userId ?? null, user_email ?? null)

    if (resolvedUser.notFoundEmail) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!resolvedUser.userId) {
      return res.status(400).json({ error: 'user_id or user_email is required' })
    }

    const result = await db.query(
      `UPDATE tables 
       SET is_public = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id`,
      [is_public, id, resolvedUser.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found or forbidden' })
    }

    const table = await fetchTableById(id)

    tablesLogger.info('Table visibility toggled', {
      tableId: id,
      isPublic: is_public
    })

    res.json({ table })
  } catch (error) {
    tablesLogger.error('Toggle visibility failed', { error, tableId: req.params.id })
    next(error)
  }
})

// ============================================================================
// DUPLICATE TABLE
// ============================================================================

router.post('/:id/duplicate', async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_id, userId, user_email } = req.body as Record<string, string>

    const resolvedUser = await resolveUserReference(user_id ?? userId ?? null, user_email ?? null)

    if (resolvedUser.notFoundEmail) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!resolvedUser.userId) {
      return res.status(400).json({ error: 'user_id or user_email is required' })
    }

    const originalResult = await db.query(
      `${TABLE_SELECT_BASE} WHERE t.id = $1`,
      [id]
    )

    if (originalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' })
    }

    const original = originalResult.rows[0] as TableRow

    if (!original.is_public && original.user_id !== resolvedUser.userId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const shareCode = crypto.randomBytes(16).toString('hex').toUpperCase()

    const insertResult = await db.query(
      `INSERT INTO tables (
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
      RETURNING id`,
      [
        resolvedUser.userId,
        `${original.name} (Copy)`,
        original.description,
        original.width,
        original.depth,
        JSON.stringify(original.layout),
        shareCode
      ]
    )

    await db
      .query('UPDATE tables SET clone_count = clone_count + 1 WHERE id = $1', [id])
      .catch(err => tablesLogger.error('Failed to increment clone count', { error: err }))

    const table = await fetchTableById(insertResult.rows[0].id)

    tablesLogger.info('Table duplicated', {
      originalId: id,
      newId: table?.id,
      userId: resolvedUser.userId
    })

    res.status(201).json({ table })
  } catch (error) {
    tablesLogger.error('Duplicate table failed', { error, tableId: req.params.id })
    next(error)
  }
})

// ============================================================================
// GET PUBLIC TABLES (browse/discover)
// ============================================================================

router.get('/public/list', async (req, res, next) => {
  try {
    const {
      page = '1',
      limit = '20',
      sort = 'recent'
    } = req.query as Record<string, string>

    const pageNum = parseInt(page) || 1
    const limitNum = Math.min(parseInt(limit) || 20, 50)
    const offset = (pageNum - 1) * limitNum

    let orderBy = 't.created_at DESC'
    switch (sort) {
      case 'updated':
        orderBy = 't.updated_at DESC'
        break
      case 'recent':
      default:
        orderBy = 't.created_at DESC'
        break
    }

    const countResult = await db.query(
      'SELECT COUNT(*) AS total FROM tables WHERE is_public = true'
    )
    const total = parseInt(countResult.rows[0].total, 10)

    const result = await db.query(
      `${TABLE_SELECT_BASE}
       WHERE t.is_public = true
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limitNum, offset]
    )

    res.json({
      tables: result.rows.map(row => mapTable(row as TableRow)),
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum)
    })
  } catch (error) {
    tablesLogger.error('Get public tables failed', { error })
    next(error)
  }
})

// ============================================================================
// REGENERATE SHARE TOKEN
// ============================================================================

router.post('/:id/regenerate-token', async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_id, userId, user_email } = req.body as Record<string, string>

    const resolvedUser = await resolveUserReference(user_id ?? userId ?? null, user_email ?? null)

    if (resolvedUser.notFoundEmail) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!resolvedUser.userId) {
      return res.status(400).json({ error: 'user_id or user_email is required' })
    }

    const newShareCode = crypto.randomBytes(16).toString('hex').toUpperCase()
    const result = await db.query(
      `UPDATE tables 
       SET share_code = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id`,
      [newShareCode, id, resolvedUser.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found or forbidden' })
    }

    const table = await fetchTableById(id)

    tablesLogger.info('Share token regenerated', {
      tableId: id,
      userId: resolvedUser.userId
    })

    res.json({ table })
  } catch (error) {
    tablesLogger.error('Regenerate token failed', { error, tableId: req.params.id })
    next(error)
  }
})

export default router
