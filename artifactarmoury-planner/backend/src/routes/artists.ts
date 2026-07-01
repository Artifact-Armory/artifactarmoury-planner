// backend/src/routes/artists.ts
// Artist directory and analytics aligned with users/models schema

import express from 'express'
import { db } from '../db'
import logger from '../utils/logger'
import { authenticate, AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/error'

const router = express.Router()
const artistLogger = logger.child('ARTISTS')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTIVE_ARTIST_CONDITION = `u.role = 'artist' AND u.account_status = 'active'`

function mapArtistSummary(row: any) {
  return {
    id: row.id,
    name: row.name ?? row.display_name ?? null,
    bio: row.bio ?? null,
    profileImageUrl: row.profile_image_url ?? null,
    bannerImageUrl: row.banner_image_url ?? null,
    artistUrl: row.artist_url ?? null,
    totalModels: Number(row.model_count ?? 0),
    totalViews: Number(row.total_views ?? 0),
    totalPurchases: Number(row.total_purchases ?? 0),
    averageRating:
      row.average_rating !== null && row.average_rating !== undefined
        ? Number(row.average_rating)
        : null,
    createdAt: row.created_at,
    creatorVerified: Boolean(row.creator_verified),
    verificationBadge: row.verification_badge ?? null,
  }
}

function mapArtistDetail(row: any) {
  return {
    ...mapArtistSummary(row),
    email: row.email,
    commissionRate: row.commission_rate !== undefined ? Number(row.commission_rate) : null,
    stripeAccountId: row.stripe_account_id ?? null,
    stripeOnboardingComplete: Boolean(row.stripe_onboarding_complete),
  }
}

function buildArtistSort(sort: string | undefined): string {
  switch (sort) {
    case 'name':
      return 'name ASC'
    case 'recent':
      return 'created_at DESC'
    case 'popular':
    default:
      return 'total_purchases DESC, total_views DESC, created_at DESC'
  }
}

function buildModelSort(sort: string | undefined): string {
  switch (sort) {
    case 'price_asc':
      return 'm.base_price ASC'
    case 'price_desc':
      return 'm.base_price DESC'
    case 'popular':
      return 'm.sale_count DESC, m.view_count DESC'
    case 'recent':
    default:
      return 'm.created_at DESC'
  }
}

function mapModel(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    thumbnail_path: row.thumbnail_path,
    base_price: row.base_price !== undefined ? Number(row.base_price) : null,
    width: row.width !== undefined ? Number(row.width) : null,
    depth: row.depth !== undefined ? Number(row.depth) : null,
    height: row.height !== undefined ? Number(row.height) : null,
    status: row.status,
    visibility: row.visibility,
    license: row.license,
    view_count: Number(row.view_count ?? 0),
    sale_count: Number(row.sale_count ?? 0),
    review_count: Number(row.review_count ?? 0),
    average_rating:
      row.average_rating !== null && row.average_rating !== undefined
        ? Number(row.average_rating)
        : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    published_at: row.published_at,
  }
}

function mapTable(row: any) {
  const layout =
    typeof row.layout === 'string'
      ? JSON.parse(row.layout)
      : row.layout ?? { models: [] }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    width: row.width !== undefined ? Number(row.width) : null,
    depth: row.depth !== undefined ? Number(row.depth) : null,
    is_public: row.is_public,
    share_code: row.share_code,
    view_count: Number(row.view_count ?? 0),
    clone_count: Number(row.clone_count ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    model_count:
      row.model_count !== undefined
        ? Number(row.model_count)
        : Array.isArray(layout?.models)
          ? layout.models.length
          : 0,
    layout,
  }
}

// ---------------------------------------------------------------------------
// GET /api/artists - list artists
// ---------------------------------------------------------------------------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page = '1', limit = '20', sort = 'popular' } = req.query as Record<string, string>

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1)
    const limitNum = Math.min(Math.max(1, parseInt(String(limit), 10) || 20), 50)
    const offset = (pageNum - 1) * limitNum

    const totalResult = await db.query(
      `SELECT COUNT(*)::INT AS count
       FROM users u
       WHERE ${ACTIVE_ARTIST_CONDITION}`
    )
    const total = totalResult.rows[0]?.count ?? 0

    const orderBy = buildArtistSort(sort)

    const result = await db.query(
      `
      SELECT
        u.id,
        u.email,
        COALESCE(u.artist_name, u.display_name) AS name,
        u.artist_bio AS bio,
        u.artist_url,
        u.created_at,
        u.commission_rate,
        u.stripe_account_id,
        u.stripe_onboarding_complete,
        u.creator_verified,
        u.verification_badge,
        COALESCE(COUNT(m.id) FILTER (WHERE m.status = 'published'), 0) AS model_count,
        COALESCE(SUM(m.view_count), 0) AS total_views,
        COALESCE(SUM(m.sale_count), 0) AS total_purchases,
        COALESCE(AVG(r.rating), 0) AS average_rating
      FROM users u
      LEFT JOIN models m ON m.artist_id = u.id
      LEFT JOIN reviews r ON r.model_id = m.id AND r.is_visible = true
      WHERE ${ACTIVE_ARTIST_CONDITION}
      GROUP BY u.id
      ORDER BY ${orderBy}
      LIMIT $1 OFFSET $2
    `,
      [limitNum, offset]
    )

    artistLogger.debug('Artists list fetched', {
      page: pageNum,
      limit: limitNum,
      count: result.rowCount,
    })

    res.json({
      artists: result.rows.map(mapArtistSummary),
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum) || 0,
    })
  })
)

// ---------------------------------------------------------------------------
// GET /api/artists/featured/list - featured artists
// ---------------------------------------------------------------------------

router.get(
  '/featured/list',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '10'), 10) || 10, 20)

    const result = await db.query(
      `
      SELECT
        u.id,
        COALESCE(u.artist_name, u.display_name) AS name,
        u.artist_bio AS bio,
        u.artist_url,
        u.created_at,
        COALESCE(COUNT(m.id) FILTER (WHERE m.status = 'published'), 0) AS model_count,
        COALESCE(SUM(m.view_count), 0) AS total_views,
        COALESCE(SUM(m.sale_count), 0) AS total_purchases,
        COALESCE(AVG(r.rating), 0) AS average_rating,
        u.creator_verified,
        u.verification_badge
      FROM users u
      LEFT JOIN models m ON m.artist_id = u.id
      LEFT JOIN reviews r ON r.model_id = m.id AND r.is_visible = true
      WHERE ${ACTIVE_ARTIST_CONDITION}
      GROUP BY u.id
      HAVING COUNT(m.id) FILTER (WHERE m.status = 'published') > 0
      ORDER BY total_purchases DESC, total_views DESC
      LIMIT $1
    `,
      [limit]
    )

    artistLogger.debug('Featured artists fetched', { count: result.rowCount })

    res.json({ artists: result.rows.map(mapArtistSummary) })
  })
)

// ---------------------------------------------------------------------------
// GET /api/artists/search/query?q=...
// ---------------------------------------------------------------------------

router.get(
  '/search/query',
  asyncHandler(async (req, res) => {
    const { q } = req.query as { q?: string }
    const query = q?.trim()

    if (!query || query.length < 2) {
      res.json({ artists: [] })
      return
    }

    const limit = Math.min(parseInt(String(req.query.limit ?? '12'), 10) || 12, 50)

    const result = await db.query(
      `
      SELECT
        u.id,
        COALESCE(u.artist_name, u.display_name) AS name,
        u.artist_bio AS bio,
        u.artist_url,
        u.created_at,
        COALESCE(COUNT(m.id) FILTER (WHERE m.status = 'published'), 0) AS model_count,
        COALESCE(SUM(m.view_count), 0) AS total_views,
        COALESCE(SUM(m.sale_count), 0) AS total_purchases,
        COALESCE(AVG(r.rating), 0) AS average_rating,
        u.creator_verified,
        u.verification_badge
      FROM users u
      LEFT JOIN models m ON m.artist_id = u.id
      LEFT JOIN reviews r ON r.model_id = m.id AND r.is_visible = true
      WHERE ${ACTIVE_ARTIST_CONDITION}
        AND (
          COALESCE(u.artist_name, u.display_name) ILIKE $1
          OR u.artist_bio ILIKE $1
        )
      GROUP BY u.id
      ORDER BY
        CASE WHEN COALESCE(u.artist_name, u.display_name) ILIKE $2 THEN 0 ELSE 1 END,
        total_purchases DESC
      LIMIT $3
    `,
      [`%${query}%`, `${query}%`, limit]
    )

    artistLogger.debug('Artist search executed', { query, count: result.rowCount })

    res.json({ artists: result.rows.map(mapArtistSummary) })
  })
)

// ---------------------------------------------------------------------------
// GET /api/artists/:id - artist profile
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params

    const result = await db.query(
      `
      SELECT
        u.id,
        u.email,
        COALESCE(u.artist_name, u.display_name) AS name,
        u.artist_bio AS bio,
        u.artist_url,
        u.created_at,
        u.commission_rate,
        u.stripe_account_id,
        u.stripe_onboarding_complete,
        u.creator_verified,
        u.verification_badge,
        COALESCE(COUNT(m.id) FILTER (WHERE m.status = 'published'), 0) AS model_count,
        COALESCE(SUM(m.view_count), 0) AS total_views,
        COALESCE(SUM(m.sale_count), 0) AS total_purchases,
        COALESCE(AVG(r.rating), 0) AS average_rating
      FROM users u
      LEFT JOIN models m ON m.artist_id = u.id
      LEFT JOIN reviews r ON r.model_id = m.id AND r.is_visible = true
      WHERE ${ACTIVE_ARTIST_CONDITION} AND u.id = $1
      GROUP BY u.id
    `,
      [id]
    )

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Artist not found' })
      return
    }

    artistLogger.debug('Artist profile fetched', { artistId: id })

    res.json({ artist: mapArtistDetail(result.rows[0]) })
  })
)

// ---------------------------------------------------------------------------
// GET /api/artists/:id/models - artist models
// ---------------------------------------------------------------------------

router.get(
  '/:id/models',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const { page = '1', limit = '24', sort = 'recent', status } = req.query as Record<
      string,
      string
    >

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1)
    const limitNum = Math.min(Math.max(1, parseInt(String(limit), 10) || 24), 100)
    const offset = (pageNum - 1) * limitNum
    const orderBy = buildModelSort(sort)

    const statusFilter =
      status && status !== 'all'
        ? `AND m.status = $2`
        : `AND m.status = 'published'`

    const params: any[] = [id]
    if (status && status !== 'all') {
      params.push(status)
    }
    params.push(limitNum, offset)

    const countResult = await db.query(
      `
      SELECT COUNT(*)::INT AS count
      FROM models m
      WHERE m.artist_id = $1 ${status && status !== 'all' ? 'AND m.status = $2' : "AND m.status = 'published'"}
    `,
      status && status !== 'all' ? [id, status] : [id]
    )
    const total = countResult.rows[0]?.count ?? 0

    const result = await db.query(
      `
      SELECT
        m.id,
        m.name,
        m.description,
        m.category,
        m.tags,
        m.thumbnail_path,
        m.base_price,
        m.license,
        m.width,
        m.depth,
        m.height,
        m.status,
        m.visibility,
        m.view_count,
        m.sale_count,
        m.created_at,
        m.updated_at,
        m.published_at,
        COUNT(r.id) FILTER (WHERE r.is_visible) AS review_count,
        AVG(r.rating) FILTER (WHERE r.is_visible) AS average_rating
      FROM models m
      LEFT JOIN reviews r ON r.model_id = m.id AND r.is_visible = true
      WHERE m.artist_id = $1 ${statusFilter}
      GROUP BY m.id, m.license
      ORDER BY ${orderBy}
      LIMIT $${status && status !== 'all' ? 3 : 2} OFFSET $${status && status !== 'all' ? 4 : 3}
    `,
      params
    )

    res.json({
      models: result.rows.map(mapModel),
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum) || 0,
    })
  })
)

// ---------------------------------------------------------------------------
// GET /api/artists/:id/examples - public tables created by artist
// ---------------------------------------------------------------------------

router.get(
  '/:id/examples',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const limit = Math.min(parseInt(String(req.query.limit ?? '12'), 10) || 12, 50)

    const result = await db.query(
      `
      SELECT
        t.id,
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
        jsonb_array_length(COALESCE(t.layout->'models', '[]'::jsonb)) AS model_count
      FROM tables t
      WHERE t.user_id = $1 AND t.is_public = true
      ORDER BY t.view_count DESC, t.created_at DESC
      LIMIT $2
    `,
      [id, limit]
    )

    res.json({ examples: result.rows.map(mapTable) })
  })
)

// ---------------------------------------------------------------------------
// GET /api/artists/:artistId/examples/:exampleId - single example table
// ---------------------------------------------------------------------------

router.get(
  '/:artistId/examples/:exampleId',
  asyncHandler(async (req, res) => {
    const { artistId, exampleId } = req.params

    const result = await db.query(
      `
      SELECT
        t.*,
        jsonb_array_length(COALESCE(t.layout->'models', '[]'::jsonb)) AS model_count
      FROM tables t
      WHERE t.id = $1 AND t.user_id = $2 AND t.is_public = true
    `,
      [exampleId, artistId]
    )

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Example table not found' })
      return
    }

    const table = result.rows[0]

    // increment view count asynchronously
    db.query('UPDATE tables SET view_count = view_count + 1 WHERE id = $1', [exampleId]).catch(
      (error) => artistLogger.error('Failed to increment table view count', { error, exampleId })
    )

    res.json({ example: mapTable(table) })
  })
)

// ---------------------------------------------------------------------------
// GET /api/artists/:id/analytics - protected analytics
// ---------------------------------------------------------------------------

router.get(
  '/:id/analytics',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params

    if (req.userId !== id && req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const [modelStats, revenueStats, recentOrders, topModels] = await Promise.all([
      db.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE status <> 'archived') AS total_models,
          COUNT(*) FILTER (WHERE status = 'published') AS published_models,
          COALESCE(SUM(view_count), 0) AS total_views,
          COALESCE(SUM(sale_count), 0) AS total_purchases
        FROM models
        WHERE artist_id = $1
      `,
        [id]
      ),
      db.query(
        `
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) AS total_revenue,
          COALESCE(SUM(amount) FILTER (WHERE status <> 'completed'), 0) AS pending_payout
        FROM payments
        WHERE artist_id = $1
      `,
        [id]
      ),
      db.query(
        `
        SELECT DISTINCT ON (o.id)
          o.id,
          o.order_number,
          o.customer_email,
          o.total,
          o.payment_status,
          o.fulfillment_status,
          o.created_at
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE oi.artist_id = $1
        ORDER BY o.id, o.created_at DESC
        LIMIT 10
      `,
        [id]
      ),
      db.query(
        `
        SELECT
          m.id,
          m.name,
          m.base_price,
          m.view_count,
          m.sale_count,
          COALESCE(SUM(oi.total_price), 0) AS revenue
        FROM models m
        LEFT JOIN order_items oi ON oi.model_id = m.id
        WHERE m.artist_id = $1 AND m.status = 'published'
        GROUP BY m.id
        ORDER BY revenue DESC, m.sale_count DESC
        LIMIT 5
      `,
        [id]
      ),
    ])

    const statsRow = modelStats.rows[0] ?? {}
    const revenueRow = revenueStats.rows[0] ?? {}

    const analytics = {
      total_models: Number(statsRow.total_models ?? 0),
      published_models: Number(statsRow.published_models ?? 0),
      total_views: Number(statsRow.total_views ?? 0),
      total_purchases: Number(statsRow.total_purchases ?? 0),
      total_revenue: Number(revenueRow.total_revenue ?? 0),
      pending_payout: Number(revenueRow.pending_payout ?? 0),
      recent_orders: recentOrders.rows.map((row) => ({
        id: row.id,
        order_number: row.order_number,
        customer_email: row.customer_email,
        total: Number(row.total ?? 0),
        payment_status: row.payment_status,
        fulfillment_status: row.fulfillment_status,
        created_at: row.created_at,
      })),
      top_models: topModels.rows.map((row) => ({
        id: row.id,
        name: row.name,
        base_price: Number(row.base_price ?? 0),
        view_count: Number(row.view_count ?? 0),
        sale_count: Number(row.sale_count ?? 0),
        revenue: Number(row.revenue ?? 0),
      })),
    }

    res.json({ analytics })
  })
)

// ---------------------------------------------------------------------------
// PUT /api/artists/:id/profile - update profile
// ---------------------------------------------------------------------------

router.put(
  '/:id/profile',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const { name, bio, artist_url, profileImageUrl, bannerImageUrl } = req.body

    if (req.userId !== id && req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const updates: string[] = []
    const params: any[] = []

    if (name !== undefined) {
      updates.push(`artist_name = $${updates.length + 1}`)
      params.push(name)
    }

    if (bio !== undefined) {
      updates.push(`artist_bio = $${updates.length + 1}`)
      params.push(bio)
    }

    if (artist_url !== undefined) {
      updates.push(`artist_url = $${updates.length + 1}`)
      params.push(artist_url)
    }

    // We do not have dedicated profile/banner image columns in schema;
    // accept the values but ignore them to avoid runtime errors.
    if (updates.length === 0) {
      artistLogger.debug('No profile fields provided for update', { artistId: id })
      const current = await db.query(
        `SELECT id, COALESCE(artist_name, display_name) AS name, artist_bio AS bio, artist_url, created_at
         FROM users WHERE id = $1`,
        [id]
      )
      if (current.rowCount === 0) {
        res.status(404).json({ error: 'Artist not found' })
        return
      }
      res.json({ artist: mapArtistDetail(current.rows[0]) })
      return
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`)
    params.push(id)

    const result = await db.query(
      `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${params.length}
      RETURNING id,
        email,
        COALESCE(artist_name, display_name) AS name,
        artist_bio AS bio,
        artist_url,
        commission_rate,
        stripe_account_id,
        stripe_onboarding_complete,
        created_at
    `,
      params
    )

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Artist not found' })
      return
    }

    artistLogger.info('Artist profile updated', {
      artistId: id,
      profileImageIgnored: profileImageUrl !== undefined,
      bannerImageIgnored: bannerImageUrl !== undefined,
    })

    res.json({ artist: mapArtistDetail(result.rows[0]) })
  })
)

export default router
