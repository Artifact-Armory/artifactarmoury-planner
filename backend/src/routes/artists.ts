// backend/src/routes/artists.ts
import express from 'express'
import { db } from '../db/index.js'
import logger from '../utils/logger.js'
import { authMiddleware } from '../middleware/auth.js'

const router = express.Router()
const artistLogger = logger.child('ARTISTS')

// ============================================================================
// GET ALL ARTISTS (public listing)
// ============================================================================

router.get('/', async (req, res, next) => {
  try {
    const {
      page = '1',
      limit = '20',
      sort = 'popular'
    } = req.query as Record<string, string>

    const pageNum = parseInt(page) || 1
    const limitNum = Math.min(parseInt(limit) || 20, 50) // Max 50 per page
    const offset = (pageNum - 1) * limitNum

    // Build sort clause
    let orderBy = 'created_at DESC'
    switch (sort) {
      case 'popular':
        orderBy = `(
          SELECT COUNT(*) FROM assets 
          WHERE artist_id = artists.id AND status = 'published'
        ) DESC`
        break
      case 'recent':
        orderBy = 'created_at DESC'
        break
      case 'name':
        orderBy = 'name ASC'
        break
      default:
        orderBy = 'created_at DESC'
    }

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as total 
       FROM artists 
       WHERE status = 'active'`
    )
    const total = parseInt(countResult.rows[0].total)

    // Get artists with model counts
    const result = await db.query(
      `SELECT 
        a.id,
        a.name,
        a.bio,
        a.profile_image_url,
        a.banner_image_url,
        a.created_at,
        COUNT(ast.id) FILTER (WHERE ast.status = 'published') as model_count
       FROM artists a
       LEFT JOIN assets ast ON a.id = ast.artist_id
       WHERE a.status = 'active'
       GROUP BY a.id
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limitNum, offset]
    )

    artistLogger.debug('Artists list fetched', {
      page: pageNum,
      limit: limitNum,
      count: result.rows.length,
      total
    })

    res.json({
      artists: result.rows,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum)
    })
  } catch (error) {
    artistLogger.error('Get artists failed', { error })
    next(error)
  }
})

// ============================================================================
// GET ARTIST PROFILE (public)
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params

    // Get artist with stats
    const result = await db.query(
      `SELECT 
        a.id,
        a.name,
        a.bio,
        a.profile_image_url,
        a.banner_image_url,
        a.created_at,
        COUNT(ast.id) FILTER (WHERE ast.status = 'published') as model_count,
        COALESCE(SUM(ast.view_count), 0) as total_views,
        COALESCE(SUM(ast.purchase_count), 0) as total_purchases
       FROM artists a
       LEFT JOIN assets ast ON a.id = ast.artist_id
       WHERE a.id = $1 AND a.status = 'active'
       GROUP BY a.id`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' })
    }

    const artist = result.rows[0]

    artistLogger.debug('Artist profile viewed', { artistId: id })

    res.json({ artist })
  } catch (error) {
    artistLogger.error('Get artist profile failed', { error, artistId: req.params.id })
    next(error)
  }
})

// ============================================================================
// GET ARTIST'S PUBLISHED MODELS
// ============================================================================

router.get('/:id/models', async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      page = '1',
      limit = '24',
      sort = 'recent'
    } = req.query as Record<string, string>

    const pageNum = parseInt(page) || 1
    const limitNum = Math.min(parseInt(limit) || 24, 100)
    const offset = (pageNum - 1) * limitNum

    // Verify artist exists and is active
    const artistCheck = await db.query(
      'SELECT id FROM artists WHERE id = $1 AND status = $\'active\'',
      [id]
    )

    if (artistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' })
    }

    // Build sort clause
    let orderBy = 'created_at DESC'
    switch (sort) {
      case 'recent':
        orderBy = 'created_at DESC'
        break
      case 'popular':
        orderBy = 'view_count DESC, purchase_count DESC'
        break
      case 'price_asc':
        orderBy = 'base_price ASC'
        break
      case 'price_desc':
        orderBy = 'base_price DESC'
        break
      default:
        orderBy = 'created_at DESC'
    }

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as total 
       FROM assets 
       WHERE artist_id = $1 AND status = 'published'`,
      [id]
    )
    const total = parseInt(countResult.rows[0].total)

    // Get models
    const result = await db.query(
      `SELECT * FROM assets
       WHERE artist_id = $1 AND status = 'published'
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [id, limitNum, offset]
    )

    artistLogger.debug('Artist models fetched', {
      artistId: id,
      count: result.rows.length,
      total
    })

    res.json({
      assets: result.rows,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum)
    })
  } catch (error) {
    artistLogger.error('Get artist models failed', { error, artistId: req.params.id })
    next(error)
  }
})

// ============================================================================
// GET ARTIST'S EXAMPLE TABLES
// ============================================================================

router.get('/:id/examples', async (req, res, next) => {
  try {
    const { id } = req.params
    const limit = Math.min(parseInt(req.query.limit as string) || 12, 50)

    // Verify artist exists
    const artistCheck = await db.query(
      'SELECT id FROM artists WHERE id = $1 AND status = $\'active\'',
      [id]
    )

    if (artistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' })
    }

    // Get example tables
    const result = await db.query(
      `SELECT 
        et.*,
        json_build_object(
          'id', a.id,
          'name', a.name,
          'profile_image_url', a.profile_image_url
        ) as artist
       FROM example_tables et
       JOIN artists a ON et.artist_id = a.id
       WHERE et.artist_id = $1
       ORDER BY et.is_featured DESC, et.view_count DESC, et.created_at DESC
       LIMIT $2`,
      [id, limit]
    )

    artistLogger.debug('Artist example tables fetched', {
      artistId: id,
      count: result.rows.length
    })

    res.json({ examples: result.rows })
  } catch (error) {
    artistLogger.error('Get artist examples failed', { error, artistId: req.params.id })
    next(error)
  }
})

// ============================================================================
// GET SINGLE EXAMPLE TABLE (public)
// ============================================================================

router.get('/:artistId/examples/:exampleId', async (req, res, next) => {
  try {
    const { artistId, exampleId } = req.params

    const result = await db.query(
      `SELECT 
        et.*,
        json_build_object(
          'id', a.id,
          'name', a.name,
          'bio', a.bio,
          'profile_image_url', a.profile_image_url
        ) as artist
       FROM example_tables et
       JOIN artists a ON et.artist_id = a.id
       WHERE et.id = $1 AND et.artist_id = $2`,
      [exampleId, artistId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Example table not found' })
    }

    const example = result.rows[0]

    // Increment view count (fire and forget)
    db.query(
      'UPDATE example_tables SET view_count = view_count + 1 WHERE id = $1',
      [exampleId]
    ).catch(err => artistLogger.error('Failed to increment example view count', { error: err }))

    artistLogger.debug('Example table viewed', { artistId, exampleId })

    res.json({ example })
  } catch (error) {
    artistLogger.error('Get example table failed', { error, params: req.params })
    next(error)
  }
})

// ============================================================================
// GET TOP ARTISTS (by model count or popularity)
// ============================================================================

router.get('/featured/list', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 20)

    const result = await db.query(
      `SELECT 
        a.id,
        a.name,
        a.bio,
        a.profile_image_url,
        a.banner_image_url,
        a.created_at,
        COUNT(ast.id) FILTER (WHERE ast.status = 'published') as model_count,
        COALESCE(SUM(ast.view_count), 0) as total_views,
        COALESCE(SUM(ast.purchase_count), 0) as total_purchases
       FROM artists a
       LEFT JOIN assets ast ON a.id = ast.artist_id
       WHERE a.status = 'active'
       GROUP BY a.id
       HAVING COUNT(ast.id) FILTER (WHERE ast.status = 'published') > 0
       ORDER BY 
         (COALESCE(SUM(ast.view_count), 0) * 0.3 + 
          COALESCE(SUM(ast.purchase_count), 0) * 0.7) DESC
       LIMIT $1`,
      [limit]
    )

    artistLogger.debug('Featured artists fetched', { count: result.rows.length })

    res.json({ artists: result.rows })
  } catch (error) {
    artistLogger.error('Get featured artists failed', { error })
    next(error)
  }
})

// ============================================================================
// SEARCH ARTISTS
// ============================================================================

router.get('/search/query', async (req, res, next) => {
  try {
    const { q } = req.query as { q: string }

    if (!q || q.trim().length < 2) {
      return res.json({ artists: [] })
    }

    const searchTerm = q.trim()
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50)

    const result = await db.query(
      `SELECT 
        a.id,
        a.name,
        a.bio,
        a.profile_image_url,
        a.created_at,
        COUNT(ast.id) FILTER (WHERE ast.status = 'published') as model_count
       FROM artists a
       LEFT JOIN assets ast ON a.id = ast.artist_id
       WHERE a.status = 'active' 
         AND (
           a.name ILIKE $1 OR
           a.bio ILIKE $1
         )
       GROUP BY a.id
       ORDER BY 
         CASE WHEN a.name ILIKE $2 THEN 0 ELSE 1 END,
         model_count DESC
       LIMIT $3`,
      [`%${searchTerm}%`, `${searchTerm}%`, limit]
    )

    artistLogger.debug('Artist search executed', {
      query: searchTerm,
      count: result.rows.length
    })

    res.json({ artists: result.rows })
  } catch (error) {
    artistLogger.error('Artist search failed', { error })
    next(error)
  }
})

// ============================================================================
// GET ARTIST ANALYTICS (protected - own data only)
// ============================================================================

router.get('/:id/analytics', authMiddleware(), async (req, res, next) => {
  try {
    const { id } = req.params

    // Ensure artist can only access their own analytics
    if (req.artistId !== id && req.artistRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Get comprehensive analytics
    const statsResult = await db.query(
      `SELECT 
        COUNT(ast.id) as total_models,
        COUNT(ast.id) FILTER (WHERE ast.status = 'published') as published_models,
        COALESCE(SUM(ast.view_count), 0) as total_views,
        COALESCE(SUM(ast.purchase_count), 0) as total_purchases
       FROM assets ast
       WHERE ast.artist_id = $1`,
      [id]
    )

    const stats = statsResult.rows[0]

    // Get revenue data
    const revenueResult = await db.query(
      `SELECT 
        COALESCE(SUM(st.amount), 0) as total_revenue,
        COALESCE(SUM(st.amount) FILTER (WHERE st.status = 'pending'), 0) as pending_payout
       FROM stripe_transfers st
       WHERE st.artist_id = $1`,
      [id]
    )

    const revenue = revenueResult.rows[0]

    // Get recent orders
    const ordersResult = await db.query(
      `SELECT DISTINCT ON (o.id)
        o.id,
        o.order_number,
        o.user_email,
        o.status,
        o.pricing,
        o.created_at
       FROM orders o
       CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item
       JOIN assets ast ON (item->>'asset_id')::uuid = ast.id
       WHERE ast.artist_id = $1
       ORDER BY o.id, o.created_at DESC
       LIMIT 10`,
      [id]
    )

    // Get top models
    const topModelsResult = await db.query(
      `SELECT 
        id,
        name,
        base_price,
        view_count,
        purchase_count,
        (base_price * purchase_count) as revenue
       FROM assets
       WHERE artist_id = $1 AND status = 'published'
       ORDER BY purchase_count DESC, view_count DESC
       LIMIT 5`,
      [id]
    )

    const analytics = {
      total_models: parseInt(stats.total_models),
      published_models: parseInt(stats.published_models),
      total_views: parseInt(stats.total_views),
      total_purchases: parseInt(stats.total_purchases),
      total_revenue: parseFloat(revenue.total_revenue),
      pending_payout: parseFloat(revenue.pending_payout),
      recent_orders: ordersResult.rows,
      top_models: topModelsResult.rows
    }

    artistLogger.debug('Artist analytics fetched', { artistId: id })

    res.json({ analytics })
  } catch (error) {
    artistLogger.error('Get artist analytics failed', { error, artistId: req.params.id })
    next(error)
  }
})

// ============================================================================
// UPDATE ARTIST PROFILE (protected)
// ============================================================================

router.put('/:id/profile', authMiddleware(), async (req, res, next) => {
  try {
    const { id } = req.params

    // Ensure artist can only update their own profile
    if (req.artistId !== id && req.artistRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const { name, bio, profile_image_url, banner_image_url } = req.body

    const result = await db.query(
      `UPDATE artists SET
        name = COALESCE($1, name),
        bio = COALESCE($2, bio),
        profile_image_url = COALESCE($3, profile_image_url),
        banner_image_url = COALESCE($4, banner_image_url),
        updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, bio, profile_image_url, banner_image_url, created_at`,
      [name, bio, profile_image_url, banner_image_url, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' })
    }

    artistLogger.info('Artist profile updated', { artistId: id })

    res.json({ artist: result.rows[0] })
  } catch (error) {
    artistLogger.error('Update artist profile failed', { error, artistId: req.params.id })
    next(error)
  }
})

export default router