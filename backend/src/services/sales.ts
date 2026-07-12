// backend/src/services/sales.ts
// Temporary artist discounts (migration 034). Centralises: resolving the active
// discount for a model/bundle, annotating result rows with sale pricing, the
// front-page "on sale" carousel, price-history recording, and the guard rails
// that stop the sale system being gamed.

import { db } from '../db'
import logger from '../utils/logger'

export const SALE_MAX_DAYS = 14
// After a sale on a target ends, that target (or the portfolio) can't go on sale
// again for this long — so nobody keeps a permanent presence on the carousel.
export const SALE_COOLDOWN_DAYS = 21
export const SALE_MIN_PERCENT = 5
export const SALE_MAX_PERCENT = 90
// A sale's "was" price must be genuine: you can't discount a price you raised
// within this window. Reference price = the lowest list price over these days.
export const PRICE_REFERENCE_DAYS = 30

type EntityType = 'model' | 'bundle'
interface Queryable {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ============================================================================
// PRICE HISTORY (backs the anti-inflation guard)
// ============================================================================

/** Record a model/bundle list price. Best-effort — never breaks the caller. */
export async function recordPrice(entityType: EntityType, entityId: string, price: number): Promise<void> {
  try {
    await db.query(
      `INSERT INTO price_history (entity_type, entity_id, price) VALUES ($1, $2, $3)`,
      [entityType, entityId, price],
    )
  } catch (err) {
    logger.error('recordPrice failed', { error: err, entityType, entityId })
  }
}

/**
 * The lowest list price this entity has held over the reference window (defaults
 * to the current price when there's no history). This is the honest "was" price.
 */
export async function referenceLowPrice(
  entityType: EntityType,
  entityId: string,
  currentPrice: number,
): Promise<number> {
  const { rows } = await db.query(
    `SELECT MIN(price) AS low FROM price_history
     WHERE entity_type = $1 AND entity_id = $2
       AND recorded_at >= NOW() - ($3 || ' days')::interval`,
    [entityType, entityId, String(PRICE_REFERENCE_DAYS)],
  )
  const low = rows[0]?.low != null ? Number(rows[0].low) : null
  if (low == null) return currentPrice
  return Math.min(low, currentPrice)
}

/**
 * True if the current price is higher than the reference low — i.e. the price was
 * raised inside the reference window, so a sale would be dishonest.
 */
export async function hasRecentPriceHike(
  entityType: EntityType,
  entityId: string,
  currentPrice: number,
): Promise<boolean> {
  const low = await referenceLowPrice(entityType, entityId, currentPrice)
  return currentPrice > low + 0.001
}

// ============================================================================
// DISCOUNT RESOLUTION
// ============================================================================

/** Best active discount percent for one model (model-scoped or portfolio). */
export async function activeDiscountForModel(
  q: Queryable,
  modelId: string,
  artistId: string,
): Promise<{ percent: number; endsAt: Date | null }> {
  const { rows } = await q.query(
    `SELECT discount_percent, ends_at FROM sales
     WHERE artist_id = $1 AND canceled_at IS NULL
       AND NOW() >= starts_at AND NOW() < ends_at
       AND (scope = 'portfolio' OR (scope = 'model' AND target_id = $2))
     ORDER BY discount_percent DESC
     LIMIT 1`,
    [artistId, modelId],
  )
  if (!rows.length) return { percent: 0, endsAt: null }
  return { percent: Number(rows[0].discount_percent), endsAt: rows[0].ends_at }
}

/** Best active discount percent for one bundle (bundle-scoped or portfolio). */
export async function activeDiscountForBundle(
  q: Queryable,
  bundleId: string,
  artistId: string,
): Promise<{ percent: number; endsAt: Date | null }> {
  const { rows } = await q.query(
    `SELECT discount_percent, ends_at FROM sales
     WHERE artist_id = $1 AND canceled_at IS NULL
       AND NOW() >= starts_at AND NOW() < ends_at
       AND (scope = 'portfolio' OR (scope = 'bundle' AND target_id = $2))
     ORDER BY discount_percent DESC
     LIMIT 1`,
    [artistId, bundleId],
  )
  if (!rows.length) return { percent: 0, endsAt: null }
  return { percent: Number(rows[0].discount_percent), endsAt: rows[0].ends_at }
}

// ============================================================================
// ROW ANNOTATION (adds sale_* fields to model/bundle result rows in one query)
// ============================================================================

function applySale(row: any, base: number, percent: number, endsAt: any) {
  if (percent > 0 && base > 0) {
    row.on_sale = true
    row.sale_percent = percent
    row.original_price = base
    row.sale_price = round2(base * (100 - percent) / 100)
    row.sale_ends_at = endsAt
  } else {
    row.on_sale = false
  }
}

/**
 * Annotate model rows (needing `id`, `artist_id`, `base_price`) with sale pricing
 * using a single query across the involved artists. Mutates the rows in place.
 */
export async function annotateModelsWithSales(models: any[]): Promise<void> {
  if (!models?.length) return
  const artistIds = [...new Set(models.map((m) => m.artist_id).filter(Boolean))]
  if (!artistIds.length) return

  const { rows: sales } = await db.query(
    `SELECT scope, target_id, artist_id, discount_percent, ends_at FROM sales
     WHERE canceled_at IS NULL AND NOW() >= starts_at AND NOW() < ends_at
       AND artist_id = ANY($1::uuid[])`,
    [artistIds],
  )

  for (const m of models) {
    let best = 0
    let endsAt: any = null
    for (const s of sales) {
      if (s.artist_id !== m.artist_id) continue
      const applies = s.scope === 'portfolio' || (s.scope === 'model' && s.target_id === m.id)
      if (applies && Number(s.discount_percent) > best) {
        best = Number(s.discount_percent)
        endsAt = s.ends_at
      }
    }
    applySale(m, Number(m.base_price), best, endsAt)
  }
}

/** Annotate bundle rows (needing `id`, `artist_id`, `price`) with sale pricing. */
export async function annotateBundlesWithSales(bundles: any[]): Promise<void> {
  if (!bundles?.length) return
  const artistIds = [...new Set(bundles.map((b) => b.artist_id).filter(Boolean))]
  if (!artistIds.length) return

  const { rows: sales } = await db.query(
    `SELECT scope, target_id, artist_id, discount_percent, ends_at FROM sales
     WHERE canceled_at IS NULL AND NOW() >= starts_at AND NOW() < ends_at
       AND artist_id = ANY($1::uuid[])`,
    [artistIds],
  )

  for (const b of bundles) {
    let best = 0
    let endsAt: any = null
    for (const s of sales) {
      if (s.artist_id !== b.artist_id) continue
      const applies = s.scope === 'portfolio' || (s.scope === 'bundle' && s.target_id === b.id)
      if (applies && Number(s.discount_percent) > best) {
        best = Number(s.discount_percent)
        endsAt = s.ends_at
      }
    }
    applySale(b, Number(b.price), best, endsAt)
  }
}

// ============================================================================
// FRONT-PAGE CAROUSEL
// ============================================================================

/**
 * Items currently on sale for the front-page carousel. Fair by design: at most
 * `perArtist` items per artist so a big portfolio can't dominate. Portfolio sales
 * are expanded to that artist's best-selling published models.
 */
export async function getFeaturedSaleItems(perArtist = 2, limit = 24): Promise<any[]> {
  // Model-scoped + portfolio-expanded models on sale.
  const { rows } = await db.query(
    `WITH active AS (
       SELECT scope, target_id, artist_id, discount_percent, ends_at
       FROM sales
       WHERE canceled_at IS NULL AND NOW() >= starts_at AND NOW() < ends_at
     )
     SELECT m.id, m.name, m.artist_id, m.thumbnail_path, m.base_price,
            u.artist_name, a.discount_percent, a.ends_at, m.sale_count
     FROM active a
     JOIN models m
       ON (a.scope = 'model' AND m.id = a.target_id)
       OR (a.scope = 'portfolio' AND m.artist_id = a.artist_id)
     JOIN users u ON m.artist_id = u.id
     WHERE m.status = 'published' AND m.visibility = 'public'
     ORDER BY a.ends_at ASC, m.sale_count DESC`,
  )

  // Dedupe (a model could match its own model-sale and a portfolio sale — keep the
  // higher discount) and cap per artist.
  const bestById = new Map<string, any>()
  for (const r of rows) {
    const prev = bestById.get(r.id)
    if (!prev || Number(r.discount_percent) > Number(prev.discount_percent)) bestById.set(r.id, r)
  }

  const perArtistCount = new Map<string, number>()
  const out: any[] = []
  for (const r of bestById.values()) {
    const n = perArtistCount.get(r.artist_id) ?? 0
    if (n >= perArtist) continue
    perArtistCount.set(r.artist_id, n + 1)
    const base = Number(r.base_price)
    const pct = Number(r.discount_percent)
    out.push({
      id: r.id,
      name: r.name,
      artistId: r.artist_id,
      artistName: r.artist_name,
      thumbnailPath: r.thumbnail_path,
      originalPrice: base,
      salePrice: round2(base * (100 - pct) / 100),
      salePercent: pct,
      saleEndsAt: r.ends_at,
    })
    if (out.length >= limit) break
  }
  return out
}
