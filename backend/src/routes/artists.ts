// backend/src/routes/artists.ts
import express from 'express'
import { db } from '../db'
import logger from '../utils/logger'
import { authenticate, optionalAuth, requireArtist } from '../middleware/auth'
import { notifyNewFollower } from '../services/notifications'
import { annotateModelsWithSales, effectiveModelPriceSql } from '../services/sales'
import { validateArtistName } from '../services/artistOnboarding'
import { ValidationError } from '../middleware/error'

const router = express.Router()
const artistLogger = logger.child('ARTISTS')

// Artists are users with role='artist'. Display name falls back to display_name.
const ARTIST_NAME = `COALESCE(NULLIF(u.artist_name, ''), u.display_name)`

// Shared SELECT of an artist row (aliased `u`) + rollup stats, matching the shape
// the frontend transformer expects (name / bio / profile_image_url / …).
const ARTIST_FIELDS = `
  u.id,
  ${ARTIST_NAME} AS name,
  u.artist_bio AS bio,
  u.artist_url,
  u.artist_avatar_url AS profile_image_url,
  u.artist_banner_url AS banner_image_url,
  u.artist_background_url AS background_image_url,
  u.artist_accent_color AS accent_color,
  u.created_at,
  COUNT(m.id) FILTER (WHERE m.status = 'published' AND m.visibility = 'public') AS model_count,
  COALESCE(SUM(m.view_count) FILTER (WHERE m.status = 'published'), 0) AS total_views,
  COALESCE(SUM(m.sale_count) FILTER (WHERE m.status = 'published'), 0) AS total_purchases,
  (SELECT COUNT(*) FROM follows f WHERE f.artist_id = u.id) AS follower_count
`

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

    // Build sort clause (aliases from ARTIST_FIELDS)
    let orderBy = 'total_purchases DESC, follower_count DESC'
    switch (sort) {
      case 'popular':
        orderBy = 'total_purchases DESC, follower_count DESC, model_count DESC'
        break
      case 'recent':
        orderBy = 'u.created_at DESC'
        break
      case 'name':
        orderBy = 'name ASC'
        break
      default:
        orderBy = 'u.created_at DESC'
    }

    // Only list artists who have at least one published model (real brands).
    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM (
         SELECT u.id FROM users u
         JOIN models m ON m.artist_id = u.id AND m.status = 'published' AND m.visibility = 'public'
         WHERE u.role = 'artist' AND u.account_status = 'active'
         GROUP BY u.id
       ) t`
    )
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10) || 0

    const result = await db.query(
      `SELECT ${ARTIST_FIELDS}
       FROM users u
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE u.role = 'artist' AND u.account_status = 'active'
       GROUP BY u.id
       HAVING COUNT(m.id) FILTER (WHERE m.status = 'published' AND m.visibility = 'public') > 0
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

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    const viewerId = (req as any).userId || null

    const result = await db.query(
      `SELECT ${ARTIST_FIELDS},
        EXISTS (SELECT 1 FROM follows f WHERE f.artist_id = u.id AND f.follower_id = $2) AS is_following
       FROM users u
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE u.id = $1 AND u.role = 'artist' AND u.account_status = 'active'
       GROUP BY u.id`,
      [id, viewerId]
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

    // Optional full-catalogue text search over name / category / tags.
    const q = ((req.query.q as string) || '').trim()
    const pattern = q ? `%${q}%` : null

    // Build sort clause
    let orderBy = 'm.published_at DESC, m.created_at DESC'
    switch (sort) {
      case 'recent':
        orderBy = 'm.published_at DESC, m.created_at DESC'
        break
      case 'popular':
        orderBy = 'm.view_count DESC, m.sale_count DESC'
        break
      case 'price_asc':
        orderBy = `${effectiveModelPriceSql('m')} ASC, m.created_at DESC`
        break
      case 'price_desc':
        orderBy = `${effectiveModelPriceSql('m')} DESC, m.created_at DESC`
        break
      default:
        orderBy = 'm.published_at DESC, m.created_at DESC'
    }

    // Get total count of the artist's published models (respecting the search).
    const countSearch = pattern
      ? ` AND (name ILIKE $2 OR category ILIKE $2 OR array_to_string(tags, ' ') ILIKE $2)`
      : ''
    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM models
       WHERE artist_id = $1 AND status = 'published' AND visibility = 'public'${countSearch}`,
      pattern ? [id, pattern] : [id]
    )
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10) || 0

    const mainSearch = pattern
      ? ` AND (m.name ILIKE $4 OR m.category ILIKE $4 OR array_to_string(m.tags, ' ') ILIKE $4)`
      : ''
    const result = await db.query(
      `SELECT
        m.id, m.name, m.description, m.category, m.tags,
        m.thumbnail_path, (m.glb_file_path IS NOT NULL) AS has_glb, m.base_price, m.fulfillment_type,
        m.width, m.height, m.depth, m.part_count,
        m.view_count, m.sale_count, m.published_at, m.artist_id,
        u.artist_name, u.artist_url, u.sales_disabled
       FROM models m
       JOIN users u ON u.id = m.artist_id
       WHERE m.artist_id = $1 AND m.status = 'published' AND m.visibility = 'public'${mainSearch}
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      pattern ? [id, limitNum, offset, pattern] : [id, limitNum, offset]
    )
    await annotateModelsWithSales(result.rows)

    artistLogger.debug('Artist models fetched', { artistId: id, count: result.rows.length, total })

    res.json({
      models: result.rows,
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

// Columns selected for a marketplace model card (matches the /:id/models shape
// that the frontend `mapModelRecord` transformer expects).
const MODEL_CARD_FIELDS = `
  m.id, m.name, m.description, m.category, m.tags,
  m.thumbnail_path, (m.glb_file_path IS NOT NULL) AS has_glb, m.base_price, m.fulfillment_type,
  m.width, m.height, m.depth, m.part_count,
  m.view_count, m.sale_count, m.published_at,
  u.id AS artist_id, u.artist_name, u.artist_url, u.sales_disabled`

// ============================================================================
// FEATURED MODELS CAROUSEL
// ============================================================================

// Public: the artist's hand-picked featured models, in their chosen order.
router.get('/:id/featured', async (req, res, next) => {
  try {
    const { id } = req.params
    const result = await db.query(
      `SELECT ${MODEL_CARD_FIELDS}
       FROM artist_featured_models f
       JOIN models m ON m.id = f.model_id
       JOIN users u ON u.id = m.artist_id
       WHERE f.artist_id = $1
         AND m.status = 'published' AND m.visibility = 'public'
       ORDER BY f.position ASC, f.created_at ASC`,
      [id],
    )
    res.json({ models: result.rows })
  } catch (error) {
    artistLogger.error('Get featured models failed', { error, artistId: req.params.id })
    next(error)
  }
})

// Owner: replace the featured set with an ordered list of the artist's own
// published models. Body: { modelIds: string[] } (order = carousel order).
router.put('/me/featured', authenticate, requireArtist, async (req, res, next) => {
  try {
    const artistId = (req as any).userId
    const ids: unknown = req.body?.modelIds
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'modelIds must be an array' })
    }
    // De-dupe, keep only strings, cap the carousel size.
    const modelIds = [...new Set(ids.filter((x): x is string => typeof x === 'string'))].slice(0, 12)

    // Keep only models the artist actually owns and has published (silently drops
    // anything else so a stale client can't feature someone else's model).
    let valid: string[] = []
    if (modelIds.length) {
      const owned = await db.query(
        `SELECT id FROM models
         WHERE id = ANY($1::uuid[]) AND artist_id = $2
           AND status = 'published' AND visibility = 'public'`,
        [modelIds, artistId],
      )
      const ownedSet = new Set(owned.rows.map((r) => r.id))
      valid = modelIds.filter((mid) => ownedSet.has(mid)) // preserve requested order
    }

    await db.query('DELETE FROM artist_featured_models WHERE artist_id = $1', [artistId])
    for (let i = 0; i < valid.length; i++) {
      await db.query(
        `INSERT INTO artist_featured_models (artist_id, model_id, position) VALUES ($1, $2, $3)`,
        [artistId, valid[i], i],
      )
    }

    artistLogger.debug('Featured models updated', { artistId, count: valid.length })
    res.json({ modelIds: valid })
  } catch (error) {
    artistLogger.error('Update featured models failed', { error })
    next(error)
  }
})

// ============================================================================
// GET ARTIST'S PUBLISHED SHOWCASE TABLES (public planner displays)
// ============================================================================

// Public: the artist's published planner "showcase" tables. user_tables is
// email-keyed, so we resolve the artist's email from their user id first, then
// pull a few piece thumbnails per table so the cards are visual (never exposes
// the raw email).
router.get('/:id/showcases', async (req, res, next) => {
  try {
    const { id } = req.params
    const limit = Math.min(parseInt(req.query.limit as string) || 12, 30)

    const result = await db.query(
      `SELECT
        t.id,
        t.name,
        t.description,
        t.share_token,
        t.view_count,
        t.thumbnail_path,
        t.updated_at,
        CASE WHEN jsonb_typeof(t.layout_data->'models') = 'array'
             THEN jsonb_array_length(t.layout_data->'models') ELSE 0 END AS piece_count,
        thumbs.thumbnails
       FROM users u
       JOIN user_tables t ON t.user_email = u.email AND t.is_public = true AND t.is_listed = true
       LEFT JOIN LATERAL (
         SELECT array_agg(m.thumbnail_path ORDER BY m.thumbnail_path) AS thumbnails
         FROM (
           SELECT DISTINCT COALESCE(elem->>'modelId', elem->>'assetId') AS mid
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(t.layout_data->'models') = 'array'
                  THEN t.layout_data->'models' ELSE '[]'::jsonb END
           ) AS elem
         ) ids
         JOIN models m ON m.id::text = ids.mid
          AND m.status = 'published'
          AND m.thumbnail_path IS NOT NULL
       ) thumbs ON true
       WHERE u.id = $1
       ORDER BY t.updated_at DESC
       LIMIT $2`,
      [id, limit],
    )

    for (const row of result.rows) {
      row.model_count = row.piece_count
      row.thumbnails = Array.isArray(row.thumbnails) ? row.thumbnails.slice(0, 4) : []
    }

    res.json({ showcases: result.rows })
  } catch (error) {
    artistLogger.error('Get artist showcases failed', { error, artistId: req.params.id })
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
      `SELECT ${ARTIST_FIELDS}
       FROM users u
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE u.role = 'artist' AND u.account_status = 'active'
       GROUP BY u.id
       HAVING COUNT(m.id) FILTER (WHERE m.status = 'published' AND m.visibility = 'public') > 0
       ORDER BY
         (COALESCE(SUM(m.view_count) FILTER (WHERE m.status = 'published'), 0) * 0.3 +
          COALESCE(SUM(m.sale_count) FILTER (WHERE m.status = 'published'), 0) * 0.7 +
          (SELECT COUNT(*) FROM follows f WHERE f.artist_id = u.id) * 2) DESC
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
      `SELECT ${ARTIST_FIELDS}
       FROM users u
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE u.role = 'artist' AND u.account_status = 'active'
         AND (${ARTIST_NAME} ILIKE $1 OR u.artist_bio ILIKE $1)
       GROUP BY u.id
       ORDER BY
         CASE WHEN ${ARTIST_NAME} ILIKE $2 THEN 0 ELSE 1 END,
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
// FOLLOW / UNFOLLOW AN ARTIST
// ============================================================================

async function followerCount(artistId: string): Promise<number> {
  const r = await db.query('SELECT COUNT(*) AS c FROM follows WHERE artist_id = $1', [artistId])
  return parseInt(r.rows[0]?.c ?? '0', 10) || 0
}

router.post('/:id/follow', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params
    const followerId = (req as any).userId
    if (id === followerId) {
      return res.status(400).json({ error: "You can't follow yourself" })
    }
    const artist = await db.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'artist' AND account_status = 'active'`,
      [id],
    )
    if (artist.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' })
    }
    const inserted = await db.query(
      `INSERT INTO follows (follower_id, artist_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING follower_id`,
      [followerId, id],
    )
    if ((inserted.rowCount ?? 0) > 0) {
      notifyNewFollower(id, followerId)
    }
    res.json({ following: true, followerCount: await followerCount(id) })
  } catch (error) {
    artistLogger.error('Follow failed', { error, artistId: req.params.id })
    next(error)
  }
})

router.delete('/:id/follow', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params
    const followerId = (req as any).userId
    await db.query('DELETE FROM follows WHERE follower_id = $1 AND artist_id = $2', [followerId, id])
    res.json({ following: false, followerCount: await followerCount(id) })
  } catch (error) {
    artistLogger.error('Unfollow failed', { error, artistId: req.params.id })
    next(error)
  }
})

// ============================================================================
// MY FOLLOWED ARTISTS + RELEASE FEED
// ============================================================================

router.get('/me/following', authenticate, async (req, res, next) => {
  try {
    const userId = (req as any).userId
    const result = await db.query(
      `SELECT ${ARTIST_FIELDS}, true AS is_following
       FROM follows fo
       JOIN users u ON u.id = fo.artist_id
       LEFT JOIN models m ON m.artist_id = u.id
       WHERE fo.follower_id = $1 AND u.account_status = 'active'
       GROUP BY u.id, fo.created_at
       ORDER BY fo.created_at DESC`,
      [userId],
    )
    res.json({ artists: result.rows })
  } catch (error) {
    artistLogger.error('Get following failed', { error })
    next(error)
  }
})

// Recent published models from the artists the signed-in user follows.
router.get('/me/feed', authenticate, async (req, res, next) => {
  try {
    const userId = (req as any).userId
    const limit = Math.min(parseInt(req.query.limit as string) || 24, 60)
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0)
    const result = await db.query(
      `SELECT
        m.id, m.name, m.description, m.category, m.tags,
        m.thumbnail_path, (m.glb_file_path IS NOT NULL) AS has_glb, m.base_price, m.fulfillment_type,
        m.width, m.height, m.depth, m.part_count,
        m.view_count, m.sale_count, m.published_at,
        u.id AS artist_id, u.artist_name, u.artist_url, u.sales_disabled
       FROM follows fo
       JOIN models m ON m.artist_id = fo.artist_id
       JOIN users u ON u.id = m.artist_id
       WHERE fo.follower_id = $1 AND m.status = 'published' AND m.visibility = 'public'
       ORDER BY m.published_at DESC NULLS LAST, m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    )
    res.json({ models: result.rows, limit, offset })
  } catch (error) {
    artistLogger.error('Get feed failed', { error })
    next(error)
  }
})

// ============================================================================
// ARTIST DASHBOARD — sales analytics for the signed-in artist (own data)
// ============================================================================

router.get('/me/stats', authenticate, requireArtist, async (req, res, next) => {
  try {
    const artistId = (req as any).userId

    // Earnings from succeeded, un-refunded order lines. artist_commission_amount
    // IS the artist's own share (schema.sql: commission_rate is "Artist's SHARE
    // percent... platform keeps the remainder" — confirmed against the actual
    // money movement in services/payouts.ts, which transfers exactly this figure
    // to the artist's Stripe Connect account). This previously subtracted it from
    // total_price instead, which computed the PLATFORM's ~15% cut and displayed
    // that to the artist as their own earnings — fixed 2026-09-01, found while
    // adding per-item refunds.
    const earnings = await db.query(
      `SELECT
         COALESCE(SUM(oi.total_price), 0) AS gross_revenue,
         COALESCE(SUM(oi.artist_commission_amount), 0) AS net_earnings,
         COUNT(oi.id) AS total_sales
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.artist_id = $1 AND o.payment_status = 'succeeded' AND oi.refunded_at IS NULL`,
      [artistId],
    )

    const models = await db.query(
      `SELECT
         COUNT(*) AS total_models,
         COUNT(*) FILTER (WHERE status = 'published' AND visibility = 'public') AS active_models,
         COUNT(*) FILTER (WHERE status = 'draft') AS draft_models,
         COALESCE(SUM(view_count), 0) AS total_views,
         COALESCE(SUM(download_count), 0) AS total_downloads
       FROM models WHERE artist_id = $1`,
      [artistId],
    )

    const followers = await db.query('SELECT COUNT(*) AS c FROM follows WHERE artist_id = $1', [artistId])

    const e = earnings.rows[0]
    const m = models.rows[0]
    res.json({
      stats: {
        grossRevenue: Number(e.gross_revenue) || 0,
        netEarnings: Number(e.net_earnings) || 0,
        totalSales: parseInt(e.total_sales, 10) || 0,
        totalModels: parseInt(m.total_models, 10) || 0,
        activeModels: parseInt(m.active_models, 10) || 0,
        draftModels: parseInt(m.draft_models, 10) || 0,
        totalViews: parseInt(m.total_views, 10) || 0,
        totalDownloads: parseInt(m.total_downloads, 10) || 0,
        followers: parseInt(followers.rows[0].c, 10) || 0,
      },
    })
  } catch (error) {
    artistLogger.error('Get artist stats failed', { error })
    next(error)
  }
})

// Recent sales (line items) for the signed-in artist.
router.get('/me/sales', authenticate, requireArtist, async (req, res, next) => {
  try {
    const artistId = (req as any).userId
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0)

    const countResult = await db.query(
      `SELECT COUNT(*) AS total
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.artist_id = $1 AND o.payment_status = 'succeeded' AND oi.refunded_at IS NULL`,
      [artistId],
    )
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10) || 0

    // `earnings` = artist_commission_amount directly — see the note on /me/stats
    // above; this is what the artist actually keeps, and what "You earned" on
    // the dashboard renders.
    const result = await db.query(
      `SELECT oi.id, oi.model_id, oi.model_name, oi.bundle_name,
              oi.total_price, oi.artist_commission_amount,
              oi.artist_commission_amount AS earnings,
              o.order_number, o.customer_email, o.created_at
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.artist_id = $1 AND o.payment_status = 'succeeded' AND oi.refunded_at IS NULL
       ORDER BY o.created_at DESC
       LIMIT $2 OFFSET $3`,
      [artistId, limit, offset],
    )

    res.json({ sales: result.rows, total, limit, offset })
  } catch (error) {
    artistLogger.error('Get artist sales failed', { error })
    next(error)
  }
})

const PROFILE_BIO_MAX = 2000

/** '' clears the link; anything else must be a plain http(s) URL. */
function cleanProfileUrl(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('Website must be a link')
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed.length > 500) throw new ValidationError('Website link is too long')
  let parsed: URL
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    throw new ValidationError('Website must be a full link, like https://example.com')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError('Website must be an http(s) link')
  }
  return parsed.toString()
}

/** An uploaded image key (images/... from /api/uploads/presign), '' to clear, or null to keep. */
function cleanImageRef(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new ValidationError(`${field} must be an uploaded image`)
  if (value === '') return ''
  if (!/^(images|thumbnails)\/[A-Za-z0-9._-]+$/.test(value)) {
    throw new ValidationError(`${field} must be an uploaded image`)
  }
  return value
}

// Update the signed-in artist's own brand (name / bio / link / avatar / banner).
router.put('/me', authenticate, requireArtist, async (req, res, next) => {
  try {
    const artistId = (req as any).userId
    const { name: rawName, bio: rawBio, url: rawUrl, avatar: rawAvatar, banner: rawBanner, background: rawBackground, accentColor } = req.body ?? {}
    // Everything here is shown on the public artist page, so it is validated rather
    // than stored as sent. The website link matters most: it is rendered as a link,
    // and a `javascript:` URL there ran script in the browser of anyone who clicked
    // it, with their saved session in reach.
    const name = rawName === undefined || rawName === null ? null : validateArtistName(rawName)
    let bio: string | null = null
    if (rawBio !== undefined && rawBio !== null) {
      if (typeof rawBio !== 'string') throw new ValidationError('Bio must be text')
      if (rawBio.length > PROFILE_BIO_MAX) throw new ValidationError(`Bio can be at most ${PROFILE_BIO_MAX} characters`)
      bio = rawBio
    }
    const url = rawUrl === undefined || rawUrl === null ? null : cleanProfileUrl(rawUrl)
    const avatar = cleanImageRef(rawAvatar, 'Avatar')
    const banner = cleanImageRef(rawBanner, 'Banner')
    const background = cleanImageRef(rawBackground, 'Background')
    // Accent is a hex colour like '#4f46e5'. An explicit '' clears it back to the
    // default theme; a valid hex sets it; anything else (or undefined) leaves it
    // unchanged. clearAccent forces NULL past the COALESCE.
    let accentHex: string | null = null
    let clearAccent = false
    if (typeof accentColor === 'string') {
      const trimmed = accentColor.trim()
      if (trimmed === '') clearAccent = true
      else if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) accentHex = trimmed.toLowerCase()
    }
    const result = await db.query(
      `UPDATE users SET
         artist_name = COALESCE($2, artist_name),
         artist_bio = COALESCE($3, artist_bio),
         artist_url = COALESCE($4, artist_url),
         artist_avatar_url = COALESCE($5, artist_avatar_url),
         artist_banner_url = COALESCE($6, artist_banner_url),
         artist_background_url = COALESCE($7, artist_background_url),
         artist_accent_color = CASE WHEN $9 THEN NULL ELSE COALESCE($8, artist_accent_color) END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id,
         COALESCE(NULLIF(artist_name, ''), display_name) AS name,
         artist_bio AS bio, artist_url,
         artist_avatar_url AS profile_image_url,
         artist_banner_url AS banner_image_url,
         artist_background_url AS background_image_url,
         artist_accent_color AS accent_color`,
      [artistId, name ?? null, bio ?? null, url ?? null, avatar ?? null, banner ?? null,
       background ?? null, accentHex, clearAccent],
    )
    res.json({ artist: result.rows[0] })
  } catch (error) {
    artistLogger.error('Update own artist profile failed', { error })
    next(error)
  }
})

export default router
