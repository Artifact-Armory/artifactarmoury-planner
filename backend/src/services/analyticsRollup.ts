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
 * Serialise every rollup writer behind a Postgres advisory lock.
 *
 * rollupRange is DELETE-then-INSERT over the same primary keys, so two
 * overlapping runs (a dashboard read racing the scheduler, or two app
 * instances) can deadlock on those rows. try-lock + skip is the right
 * behaviour for both callers: whoever holds the lock is already recomputing
 * the same days, so the loser has nothing useful to add.
 *
 * Returns false if the lock was busy and `fn` was skipped.
 */
const ROLLUP_LOCK_KEY = 48201163;

async function withRollupLock(fn: () => Promise<void>): Promise<boolean> {
  const client = await db.getClient();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [ROLLUP_LOCK_KEY]);
    if (!rows[0]?.ok) return false;
    try {
      await fn();
      return true;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ROLLUP_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const isoDaysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

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
  try {
    await withRollupLock(() => rollupRange(isoDaysAgo(1), isoDaysAgo(0)));
  } catch {
    lastFresh = 0; // let the next call retry after a failure
    /* already logged */
  }
}

// ============================================================================
// SCHEDULED BACKFILL
// ============================================================================
//
// Why this exists: ensureRollupsFresh only ever recomputes today + yesterday,
// and it only runs when an artist opens a dashboard. So any day on which nobody
// loaded a dashboard (and which was not covered by the next day's load) never
// gets rolled up at all — its events sit in analytics_events forever while the
// charts, which read only the rollup tables, silently report zero for it.
//
// This sweep closes those gaps: it recomputes a trailing window on boot and on
// a timer, and it detects an existing gap by looking at the newest rolled-up
// day so a long outage self-heals instead of leaving a permanent hole.

const ROLLUP_DAYS = Math.max(2, Number(process.env.ANALYTICS_ROLLUP_DAYS) || 7);
const ROLLUP_INTERVAL_HOURS = Math.max(1, Number(process.env.ANALYTICS_ROLLUP_INTERVAL_HOURS) || 6);
/** Ceiling on a self-healing backfill, so one bad gap can't scan all history. */
const MAX_BACKFILL_DAYS = Math.max(ROLLUP_DAYS, Number(process.env.ANALYTICS_ROLLUP_MAX_DAYS) || 60);

/**
 * First day the next sweep should recompute: normally `ROLLUP_DAYS` back, but
 * reaching further if the newest rolled-up day is older than that (i.e. a gap),
 * clamped to MAX_BACKFILL_DAYS.
 */
async function backfillFrom(): Promise<string> {
  const windowStart = isoDaysAgo(ROLLUP_DAYS);
  const capStart = isoDaysAgo(MAX_BACKFILL_DAYS);
  let lastDay: string | null = null;
  try {
    const { rows } = await db.query('SELECT max(day)::text AS last_day FROM daily_model_stats');
    lastDay = rows[0]?.last_day ?? null;
  } catch (err) {
    log.error('Could not read last rolled-up day; using the default window', { error: err });
    return windowStart;
  }
  // Nothing rolled up yet — this is a first run or a fresh DB, so reach back the
  // full cap once and establish a baseline.
  if (!lastDay) return capStart;
  const from = lastDay < windowStart ? lastDay : windowStart;
  return from < capStart ? capStart : from;
}

let schedulerStarted = false;

/**
 * Periodically recompute recent analytics rollups so the artist dashboards stay
 * correct without anyone running `npm run rollup:analytics` by hand.
 *
 * In-process on the API service, matching startReleaseScheduler /
 * startPayoutScheduler. The advisory lock keeps it safe if the service is ever
 * scaled past one instance.
 */
export function startAnalyticsRollupScheduler(): void {
  if (schedulerStarted) return;
  if (process.env.DB_MOCK === 'true') return; // no DB in mock/dev
  if (process.env.ANALYTICS_ROLLUP_ENABLED === 'false') {
    log.info('Analytics rollup scheduler disabled by ANALYTICS_ROLLUP_ENABLED=false');
    return;
  }
  schedulerStarted = true;

  const tick = async () => {
    try {
      const from = await backfillFrom();
      const to = isoDaysAgo(0);
      const ran = await withRollupLock(async () => {
        const startedAt = Date.now();
        await rollupRange(from, to);
        log.info('Scheduled analytics rollup complete', { from, to, ms: Date.now() - startedAt });
      });
      if (!ran) log.info('Scheduled analytics rollup skipped — another run holds the lock');
    } catch (err) {
      log.error('Analytics rollup tick failed', { error: err });
    }
  };

  // Boot sweep is delayed so it doesn't compete with startup traffic.
  setTimeout(tick, 20_000).unref?.();
  setInterval(tick, ROLLUP_INTERVAL_HOURS * 3_600_000).unref?.();
  log.info('Analytics rollup scheduler started', {
    windowDays: ROLLUP_DAYS,
    everyHours: ROLLUP_INTERVAL_HOURS,
    maxBackfillDays: MAX_BACKFILL_DAYS,
  });
}
