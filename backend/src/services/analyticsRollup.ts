// backend/src/services/analyticsRollup.ts
// Recompute the daily rollup tables (migration 015) from raw analytics_events +
// order_items. Idempotent per day (DELETE+INSERT in a txn), so re-running is safe
// and picks up late-arriving events.

import { db } from '../db';
import logger from '../utils/logger';

const log = logger.child('ROLLUP');

/**
 * Recompute rollups for [fromDate, toDate] (inclusive, 'YYYY-MM-DD').
 * artist_id is resolved authoritatively from models (not the denormalised event
 * copy) so a model's rows never split across artists.
 */
export async function rollupRange(fromDate: string, toDate: string): Promise<void> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM daily_model_stats WHERE day BETWEEN $1 AND $2', [fromDate, toDate]);
    await client.query(
      `INSERT INTO daily_model_stats
         (day, model_id, artist_id, views, placements, wishlist_adds, units_sold, gross, net)
       SELECT u.day, u.model_id, m.artist_id,
              SUM(u.views), SUM(u.placements), SUM(u.wishlist),
              SUM(u.units), SUM(u.gross), SUM(u.net)
       FROM (
         SELECT date(created_at) AS day, model_id,
                COUNT(*) FILTER (WHERE type = 'product_view')      AS views,
                COUNT(*) FILTER (WHERE type = 'planner_placement') AS placements,
                COUNT(*) FILTER (WHERE type = 'wishlist_add')      AS wishlist,
                0 AS units, 0::numeric AS gross, 0::numeric AS net
         FROM analytics_events
         WHERE model_id IS NOT NULL AND date(created_at) BETWEEN $1 AND $2
         GROUP BY 1, 2
         UNION ALL
         SELECT date(o.created_at) AS day, oi.model_id,
                0, 0, 0,
                COUNT(*) AS units,
                COALESCE(SUM(oi.total_price), 0) AS gross,
                COALESCE(SUM(oi.total_price - oi.artist_commission_amount), 0) AS net
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.payment_status = 'succeeded' AND oi.model_id IS NOT NULL
           AND date(o.created_at) BETWEEN $1 AND $2
         GROUP BY 1, 2
       ) u
       LEFT JOIN models m ON m.id = u.model_id
       GROUP BY u.day, u.model_id, m.artist_id`,
      [fromDate, toDate],
    );

    await client.query('DELETE FROM daily_search_terms WHERE day BETWEEN $1 AND $2', [fromDate, toDate]);
    await client.query(
      `INSERT INTO daily_search_terms (day, query, searches, zero_result_searches)
       SELECT date(created_at), lower(btrim(query)),
              COUNT(*),
              COUNT(*) FILTER (WHERE result_count = 0)
       FROM analytics_events
       WHERE type = 'search_query' AND query IS NOT NULL AND btrim(query) <> ''
         AND date(created_at) BETWEEN $1 AND $2
       GROUP BY 1, 2`,
      [fromDate, toDate],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    log.error('rollupRange failed', { error: err, fromDate, toDate });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cheaply keep the dashboard fresh: recompute today + yesterday (catches
 * late/timezone-straddling events) before a dashboard reads the rollups. Swallows
 * errors — a stale tile is better than a failed dashboard.
 */
let lastFresh = 0;
export async function ensureRollupsFresh(): Promise<void> {
  // Throttle: a dashboard page fans out to several endpoints at once — recompute
  // the recent window at most once a minute across them.
  const now = Date.now();
  if (now - lastFresh < 60_000) return;
  lastFresh = now;
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  try {
    await rollupRange(iso(yesterday), iso(today));
  } catch {
    lastFresh = 0; // let the next call retry after a failure
    /* already logged */
  }
}
