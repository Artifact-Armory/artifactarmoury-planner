// backend/src/routes/artists.ts
import express from 'express'
import { db } from '../db'
import logger from '../utils/logger'
import { authenticate } from '../middleware/auth'

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
    const limitNum = Math.min(parseInt(limit) || 20, 50)
    const offset = (pageNum - 1) * limitNum

    let orderClause = 'model_count DESC'
    switch (sort) {
      case 'recent':
        orderClause = 'u.created_at DESC'
        break
      case 'name':
        orderClause = "COALESCE(u.artist_name, u.display_name) ASC"
        break
      case 'popular':
      default:
        orderClause = 'model_count DESC'
    }

    const countResult = await db.query(
      `SELECT COUNT(*) AS total
       FROM users
       WHERE role = 'artist' AND account_status = 'active'`
    )
    const total = parseInt(countResult.rows[0].total, 10)

    const result = await db.query(
      `SELECT 
        u.id,
        u.display_name,
        u.artist_name,
        u.artist_bio,
        u.artist_url,
        u.profile_image_url,
        u.banner_image_url,
        u.commission_rate,
        u.stripe_account_id,
        u.stripe_onboarding_complete,
        u.created_at,
        COUNT(m.id) FILTER (WHERE m.status = 'published') AS model_count,
        COALESCE(SUM(m.view_count), 0) AS total_views,
        COALESCE(SUM(m.sale_count), 0) AS total_sales
       FROM users u
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE u.role = 'artist' AND u.account_status = 'active'
       GROUP BY u.id
       ORDER BY ${orderClause}
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

    const result = await db.query(
      `SELECT 
        u.id,
        u.display_name,
        u.artist_name,
        u.artist_bio,
        u.artist_url,
        u.profile_image_url,
        u.banner_image_url,
        u.commission_rate,
        u.stripe_account_id,
        u.stripe_onboarding_complete,
        u.created_at,
        COUNT(m.id) FILTER (WHERE m.status = 'published') AS model_count,
        COALESCE(SUM(m.view_count), 0) AS total_views,
        COALESCE(SUM(m.sale_count), 0) AS total_sales
       FROM users u
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE u.id = $1 AND u.role = 'artist' AND u.account_status = 'active'
       GROUP BY u.id`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' })
    }

    artistLogger.debug('Artist profile viewed', { artistId: id })

    res.json({ artist: result.rows[0] })
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

    const artistCheck = await db.query(
      `SELECT id FROM users 
       WHERE id = $1 AND role = 'artist' AND account_status = 'active'`,
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
      `SELECT COUNT(*) AS total 
       FROM models 
       WHERE artist_id = $1 AND status = 'published'`,
      [id]
    )
    const total = parseInt(countResult.rows[0].total, 10)

    // Get models
    const result = await db.query(
      `SELECT 
        id,
        name,
        description,
        category,
        tags,
        thumbnail_path,
        base_price,
        width,
        depth,
        height,
        status,
        visibility,
        view_count,
        download_count,
        sale_count,
        created_at
       FROM models
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

    const artistCheck = await db.query(
      `SELECT id FROM users 
       WHERE id = $1 AND role = 'artist' AND account_status = 'active'`,
      [id]
    )

    if (artistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' })
    }

    const result = await db.query(
      `SELECT 
        t.id,
        t.name,
        t.description,
        t.width,
        t.depth,
        t.layout,
        t.share_code,
        t.view_count,
        t.clone_count,
        t.created_at,
        json_build_object(
          'id', u.id,
          'display_name', u.display_name,
          'artist_name', u.artist_name,
          'profile_image_url', u.profile_image_url
        ) AS artist
       FROM tables t
       JOIN users u ON t.user_id = u.id
       WHERE t.user_id = $1 AND t.is_public = true
       ORDER BY t.view_count DESC, t.created_at DESC
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
        t.*,
        json_build_object(
          'id', u.id,
          'display_name', u.display_name,
          'artist_name', u.artist_name,
          'artist_bio', u.artist_bio,
          'profile_image_url', u.profile_image_url
        ) AS artist
       FROM tables t
       JOIN users u ON t.user_id = u.id
       WHERE t.id = $1 AND t.user_id = $2 AND t.is_public = true`,
      [exampleId, artistId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Example table not found' })
    }

    db.query(
      'UPDATE tables SET view_count = view_count + 1 WHERE id = $1',
      [exampleId]
    ).catch(err => artistLogger.error('Failed to increment example view count', { error: err }))

    artistLogger.debug('Example table viewed', { artistId, exampleId })

    res.json({ example: result.rows[0] })
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
        u.id,
        u.display_name,
        u.artist_name,
        u.artist_bio,
        u.profile_image_url,
        u.banner_image_url,
        u.created_at,
        COUNT(m.id) FILTER (WHERE m.status = 'published') AS model_count,
        COALESCE(SUM(m.view_count), 0) AS total_views,
        COALESCE(SUM(m.sale_count), 0) AS total_sales
       FROM users u
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE u.role = 'artist' AND u.account_status = 'active'
       GROUP BY u.id
       HAVING COUNT(m.id) FILTER (WHERE m.status = 'published') > 0
       ORDER BY 
         (COALESCE(SUM(m.view_count), 0) * 0.3 + 
          COALESCE(SUM(m.sale_count), 0) * 0.7) DESC
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

    const wildcard = `%${q.trim()}%`
    const startsWith = `${q.trim()}%`
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50)

    const result = await db.query(
      `SELECT 
        u.id,
        u.display_name,
        u.artist_name,
        u.artist_bio,
        u.profile_image_url,
        u.created_at,
        COUNT(m.id) FILTER (WHERE m.status = 'published') AS model_count
       FROM users u
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE u.role = 'artist'
         AND u.account_status = 'active'
         AND (
           u.display_name ILIKE $1 OR
           u.artist_name ILIKE $1 OR
           u.artist_bio ILIKE $1
         )
       GROUP BY u.id
       ORDER BY 
         CASE WHEN u.artist_name ILIKE $2 OR u.display_name ILIKE $2 THEN 0 ELSE 1 END,
         model_count DESC
       LIMIT $3`,
      [wildcard, startsWith, limit]
    )

    artistLogger.debug('Artist search executed', {
      query: q.trim(),
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

router.get('/:id/analytics', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params

    // Ensure artist can only access their own analytics
    if ((req as any).userId !== id && (req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Get comprehensive analytics
    const statsResult = await db.query(
      `SELECT 
        COUNT(m.id) AS total_models,
        COUNT(m.id) FILTER (WHERE m.status = 'published') AS published_models,
        COALESCE(SUM(m.view_count), 0) AS total_views,
        COALESCE(SUM(m.sale_count), 0) AS total_sales
       FROM models m
       WHERE m.artist_id = $1`,
      [id]
    )
    const stats = statsResult.rows[0]

    const revenueResult = await db.query(
      `SELECT 
        COALESCE(SUM(p.amount), 0) AS total_revenue,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'pending'), 0) AS pending_payout
       FROM payments p
       WHERE p.artist_id = $1`,
      [id]
    )
    const revenue = revenueResult.rows[0]

    const ordersResult = await db.query(
      `SELECT DISTINCT ON (o.id)
        o.id,
        o.order_number,
        o.customer_email,
        o.payment_status,
        o.total,
        o.created_at
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE oi.artist_id = $1
       ORDER BY o.id, o.created_at DESC
       LIMIT 10`,
      [id]
    )

    const topModelsResult = await db.query(
      `SELECT 
        id,
        name,
        base_price,
        view_count,
        sale_count,
        (base_price * sale_count) AS revenue
       FROM models
       WHERE artist_id = $1 AND status = 'published'
       ORDER BY sale_count DESC, view_count DESC
       LIMIT 5`,
      [id]
    )

    const analytics = {
      total_models: parseInt(stats.total_models, 10),
      published_models: parseInt(stats.published_models, 10),
      total_views: parseInt(stats.total_views, 10),
      total_purchases: parseInt(stats.total_sales, 10),
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

router.put('/:id/profile', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params

    if ((req as any).userId !== id && (req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const {
      display_name,
      name,
      artist_name,
      bio,
      artist_bio,
      artist_url,
      profile_image_url,
      banner_image_url
    } = req.body

    const result = await db.query(
      `UPDATE users SET
        display_name = COALESCE($1, display_name),
        artist_name = COALESCE($2, artist_name),
        artist_bio = COALESCE($3, artist_bio),
        artist_url = COALESCE($4, artist_url),
        profile_image_url = COALESCE($5, profile_image_url),
        banner_image_url = COALESCE($6, banner_image_url),
        updated_at = NOW()
       WHERE id = $7 AND role = 'artist'
       RETURNING id, display_name, artist_name, artist_bio, artist_url, profile_image_url, banner_image_url, created_at`,
      [
        display_name,
        artist_name ?? name ?? null,
        artist_bio ?? bio ?? null,
        artist_url ?? null,
        profile_image_url ?? null,
        banner_image_url ?? null,
        id
      ]
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
