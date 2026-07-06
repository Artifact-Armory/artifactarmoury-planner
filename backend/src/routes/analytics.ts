// backend/src/routes/analytics.ts
// Client-emitted analytics events. Currently just planner placement — the
// purchase-intent signal (a model dropped onto a planner table) that no rival
// terrain marketplace can offer. Other events (views/searches/wishlist) are logged
// server-side at their source.

import { Router } from 'express';
import { db } from '../db';
import { optionalAuth, authenticate, requireArtist } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { logPlannerPlacement } from '../services/analytics';
import { ensureRollupsFresh } from '../services/analyticsRollup';
import { getSummary, getTimeseries, getProducts, siteSearches, getModelFunnel, type Range } from '../services/artistAnalytics';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse ?from&to (YYYY-MM-DD) with a default of the last 30 days. */
function parseRange(q: any): Range {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = typeof q.to === 'string' && DATE_RE.test(q.to) ? q.to : iso(new Date());
  const from =
    typeof q.from === 'string' && DATE_RE.test(q.from)
      ? q.from
      : iso(new Date(Date.now() - 29 * 86400_000));
  return from <= to ? { from, to } : { from: to, to: from };
}

// POST /api/analytics/placement { modelId }
// Records that a model was placed on a planner table. Resolves the owning artist
// so it lands on their dashboard. No-ops for demo/local (non-UUID) asset ids.
router.post(
  '/placement',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const modelId = req.body?.modelId;
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) {
      res.status(204).end();
      return;
    }
    const m = await db.query('SELECT artist_id FROM models WHERE id = $1', [modelId]);
    if (m.rows.length > 0) {
      logPlannerPlacement(modelId, m.rows[0].artist_id ?? null, {
        userId: (req as any).userId ?? null,
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId.slice(0, 64) : null,
      });
    }
    res.status(204).end();
  }),
);

// ============================================================================
// ARTIST ANALYTICS DASHBOARD (own data only). Refreshes recent rollups on read.
// ============================================================================

router.get('/me/summary', authenticate, requireArtist, asyncHandler(async (req, res) => {
  await ensureRollupsFresh();
  res.json(await getSummary((req as any).userId, parseRange(req.query)));
}));

router.get('/me/timeseries', authenticate, requireArtist, asyncHandler(async (req, res) => {
  await ensureRollupsFresh();
  res.json({ series: await getTimeseries((req as any).userId, parseRange(req.query)) });
}));

router.get('/me/products', authenticate, requireArtist, asyncHandler(async (req, res) => {
  await ensureRollupsFresh();
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'units';
  res.json({ products: await getProducts((req as any).userId, parseRange(req.query), sort) });
}));

router.get('/me/searches', authenticate, requireArtist, asyncHandler(async (req, res) => {
  await ensureRollupsFresh();
  res.json(await siteSearches(parseRange(req.query)));
}));

router.get('/me/model/:id', authenticate, requireArtist, asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  await ensureRollupsFresh();
  const data = await getModelFunnel(req.params.id, (req as any).userId, parseRange(req.query));
  if (!data) return res.status(404).json({ error: 'Model not found' });
  res.json(data);
}));

export default router;
