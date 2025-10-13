// backend/src/routes/tables.ts
import express from 'express'
import crypto from 'crypto'
import { db } from '../db/index.js'
import logger from '../utils/logger.js'
import { validateString } from '../utils/validation.js'
import type { SaveTableRequest, UserTable } from '../../../shared/types.js'

const router = express.Router()
const tablesLogger = logger.child('TABLES')

// ============================================================================
// SAVE TABLE LAYOUT
// ============================================================================

router.post('/', async (req, res, next) => {
  try {
    const {
      user_email,
      name,
      table_config,
      layout_data,
      is_public = false
    } = req.body as SaveTableRequest & { user_email: string }

    // Validate required fields
    validateString(user_email, 'user_email', { maxLength: 255 })
    validateString(name, 'name', { minLength: 3, maxLength: 255 })

    if (!table_config || typeof table_config !== 'object') {
      return res.status(400).json({ error: 'table_config is required' })
    }

    if (!layout_data || typeof layout_data !== 'object') {
      return res.status(400).json({ error: 'layout_data is required' })
    }

    if (!Array.isArray(layout_data.models)) {
      return res.status(400).json({ error: 'layout_data.models must be an array' })
    }

    // Generate unique share token
    const shareToken = crypto.randomBytes(16).toString('hex')

    // Save table
    const result = await db.query(
      `INSERT INTO user_tables (
        user_email, 
        name, 
        table_config, 
        layout_data, 
        share_token, 
        is_public
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        user_email,
        name,
        JSON.stringify(table_config),
        JSON.stringify(layout_data),
        shareToken,
        is_public
      ]
    )

    const savedTable = result.rows[0]

    tablesLogger.info('Table saved', {
      tableId: savedTable.id,
      userEmail: user_email,
      modelCount: layout_data.models.length
    })

    res.status(201).json({ table: savedTable })
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
      user_email,
      name,
      table_config,
      layout_data,
      is_public
    } = req.body

    // Validate user owns this table
    const checkResult = await db.query(
      'SELECT user_email FROM user_tables WHERE id = $1',
      [id]
    )

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' })
    }

    if (checkResult.rows[0].user_email !== user_email) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Update table
    const result = await db.query(
      `UPDATE user_tables SET
        name = COALESCE($1, name),
        table_config = COALESCE($2, table_config),
        layout_data = COALESCE($3, layout_data),
        is_public = COALESCE($4, is_public),
        updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        name,
        table_config ? JSON.stringify(table_config) : null,
        layout_data ? JSON.stringify(layout_data) : null,
        is_public,
        id
      ]
    )

    tablesLogger.info('Table updated', {
      tableId: id,
      userEmail: user_email
    })

    res.json({ table: result.rows[0] })
  } catch (error) {
    tablesLogger.error('Update table failed', { error, tableId: req.params.id })
    next(error)
  }
})

// ============================================================================
// GET USER'S TABLES
// ============================================================================

router.get('/user/:email', async (req, res, next) => {
  try {
    const { email } = req.params
    const {
      page = '1',
      limit = '20'
    } = req.query as Record<string, string>

    const pageNum = parseInt(page) || 1
    const limitNum = Math.min(parseInt(limit) || 20, 100)
    const offset = (pageNum - 1) * limitNum

    // Get total count
    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM user_tables WHERE user_email = $1',
      [email]
    )
    const total = parseInt(countResult.rows[0].total)

    // Get tables
    const result = await db.query(
      `SELECT 
        id,
        name,
        table_config,
        share_token,
        is_public,
        created_at,
        updated_at,
        jsonb_array_length(layout_data->'models') as model_count
       FROM user_tables
       WHERE user_email = $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [email, limitNum, offset]
    )

    tablesLogger.debug('User tables fetched', {
      userEmail: email,
      count: result.rows.length,
      total
    })

    res.json({
      tables: result.rows,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum)
    })
  } catch (error) {
    tablesLogger.error('Get user tables failed', { error, email: req.params.email })
    next(error)
  }
})

// ============================================================================
// GET SINGLE TABLE (by ID - requires ownership)
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_email } = req.query as { user_email?: string }

    const result = await db.query(
      'SELECT * FROM user_tables WHERE id = $1',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' })
    }

    const table = result.rows[0]

    // Check access permissions
    if (!table.is_public && table.user_email !== user_email) {
      return res.status(403).json({ error: 'Forbidden' })
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
// GET SHARED TABLE (by share token - public)
// ============================================================================

router.get('/shared/:token', async (req, res, next) => {
  try {
    const { token } = req.params

    const result = await db.query(
      'SELECT * FROM user_tables WHERE share_token = $1',
      [token]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shared table not found' })
    }

    const table = result.rows[0]

    // Verify table is public
    if (!table.is_public) {
      return res.status(403).json({ error: 'Table is not public' })
    }

    tablesLogger.debug('Shared table viewed', {
      tableId: table.id,
      shareToken: token
    })

    res.json({ table })
  } catch (error) {
    tablesLogger.error('Get shared table failed', { error, token: req.params.token })
    next(error)
  }
})

// ============================================================================
// DELETE TABLE
// ============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_email } = req.body

    if (!user_email) {
      return res.status(400).json({ error: 'user_email is required' })
    }

    // Verify ownership
    const result = await db.query(
      'DELETE FROM user_tables WHERE id = $1 AND user_email = $2 RETURNING id',
      [id, user_email]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found or forbidden' })
    }

    tablesLogger.info('Table deleted', {
      tableId: id,
      userEmail: user_email
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
    const { user_email, is_public } = req.body

    if (!user_email) {
      return res.status(400).json({ error: 'user_email is required' })
    }

    if (typeof is_public !== 'boolean') {
      return res.status(400).json({ error: 'is_public must be a boolean' })
    }

    // Verify ownership and update
    const result = await db.query(
      `UPDATE user_tables 
       SET is_public = $1, updated_at = NOW()
       WHERE id = $2 AND user_email = $3
       RETURNING *`,
      [is_public, id, user_email]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found or forbidden' })
    }

    tablesLogger.info('Table visibility toggled', {
      tableId: id,
      isPublic: is_public
    })

    res.json({ table: result.rows[0] })
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
    const { user_email } = req.body

    if (!user_email) {
      return res.status(400).json({ error: 'user_email is required' })
    }

    // Get original table
    const originalResult = await db.query(
      'SELECT * FROM user_tables WHERE id = $1',
      [id]
    )

    if (originalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' })
    }

    const original = originalResult.rows[0]

    // Check if user can access this table
    if (!original.is_public && original.user_email !== user_email) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Generate new share token
    const newShareToken = crypto.randomBytes(16).toString('hex')

    // Create duplicate
    const result = await db.query(
      `INSERT INTO user_tables (
        user_email,
        name,
        table_config,
        layout_data,
        share_token,
        is_public
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        user_email,
        `${original.name} (Copy)`,
        original.table_config,
        original.layout_data,
        newShareToken,
        false // Duplicates are private by default
      ]
    )

    tablesLogger.info('Table duplicated', {
      originalId: id,
      newId: result.rows[0].id,
      userEmail: user_email
    })

    res.status(201).json({ table: result.rows[0] })
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

    // Build sort clause
    let orderBy = 'created_at DESC'
    switch (sort) {
      case 'recent':
        orderBy = 'created_at DESC'
        break
      case 'updated':
        orderBy = 'updated_at DESC'
        break
      default:
        orderBy = 'created_at DESC'
    }

    // Get total count
    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM user_tables WHERE is_public = true'
    )
    const total = parseInt(countResult.rows[0].total)

    // Get public tables
    const result = await db.query(
      `SELECT 
        id,
        user_email,
        name,
        table_config,
        share_token,
        created_at,
        updated_at,
        jsonb_array_length(layout_data->'models') as model_count
       FROM user_tables
       WHERE is_public = true
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limitNum, offset]
    )

    tablesLogger.debug('Public tables fetched', {
      count: result.rows.length,
      total
    })

    res.json({
      tables: result.rows,
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
    const { user_email } = req.body

    if (!user_email) {
      return res.status(400).json({ error: 'user_email is required' })
    }

    // Generate new token
    const newShareToken = crypto.randomBytes(16).toString('hex')

    // Verify ownership and update
    const result = await db.query(
      `UPDATE user_tables 
       SET share_token = $1, updated_at = NOW()
       WHERE id = $2 AND user_email = $3
       RETURNING *`,
      [newShareToken, id, user_email]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found or forbidden' })
    }

    tablesLogger.info('Share token regenerated', {
      tableId: id,
      userEmail: user_email
    })

    res.json({ table: result.rows[0] })
  } catch (error) {
    tablesLogger.error('Regenerate token failed', { error, tableId: req.params.id })
    next(error)
  }
})

export default router