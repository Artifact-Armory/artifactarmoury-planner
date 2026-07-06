// backend/src/routes/releases.ts
// Scheduled releases ("drops"): an artist groups their models/bundles/tables under
// a named release with one go-live time; the scheduler (services/releases.ts)
// publishes them all together when it arrives.

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { authenticate, requireArtist, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ValidationError, NotFoundError, AuthorizationError } from '../middleware/error';
import { releaseBlockers, publishRelease, type ReleaseItemType } from '../services/releases';

const router = Router();
const ITEM_TYPES: ReleaseItemType[] = ['model', 'bundle', 'table'];

// Fetch a release the caller owns, or throw 404/403.
async function ownedRelease(req: AuthRequest, id: string) {
  const r = (await db.query(`SELECT * FROM releases WHERE id = $1`, [id])).rows[0];
  if (!r) throw new NotFoundError('Release');
  if (r.artist_id !== (req as any).userId) throw new AuthorizationError('You do not own this release');
  return r;
}

// Attach a human label + current status to each polymorphic item for the UI.
async function enrichItems(releaseId: string) {
  const items = (await db.query(
    `SELECT id, item_type, item_id, published, publish_error
     FROM release_items WHERE release_id = $1 ORDER BY created_at ASC`,
    [releaseId],
  )).rows;

  const byType = (t: string) => items.filter((i: any) => i.item_type === t).map((i: any) => i.item_id);
  const [models, bundles, tables] = await Promise.all([
    byType('model').length
      ? db.query(`SELECT id, name, status FROM models WHERE id = ANY($1::uuid[])`, [byType('model')])
      : Promise.resolve({ rows: [] as any[] }),
    byType('bundle').length
      ? db.query(`SELECT id, name, status FROM bundles WHERE id = ANY($1::uuid[])`, [byType('bundle')])
      : Promise.resolve({ rows: [] as any[] }),
    byType('table').length
      ? db.query(`SELECT id, name, is_public FROM user_tables WHERE id = ANY($1::uuid[])`, [byType('table')])
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  const label = new Map<string, { name: string; status: string }>();
  for (const m of models.rows) label.set(m.id, { name: m.name, status: m.status });
  for (const b of bundles.rows) label.set(b.id, { name: b.name, status: b.status });
  for (const t of tables.rows) label.set(t.id, { name: t.name, status: t.is_public ? 'published' : 'draft' });

  return items.map((i: any) => ({
    id: i.id,
    itemType: i.item_type,
    itemId: i.item_id,
    published: i.published,
    publishError: i.publish_error,
    name: label.get(i.item_id)?.name ?? '(deleted)',
    itemStatus: label.get(i.item_id)?.status ?? 'missing',
  }));
}

// ============================================================================
// LIST MY RELEASES
// ============================================================================
router.get('/my',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const releases = (await db.query(
      `SELECT r.*, COUNT(ri.id)::int AS item_count
       FROM releases r LEFT JOIN release_items ri ON ri.release_id = r.id
       WHERE r.artist_id = $1
       GROUP BY r.id
       ORDER BY r.created_at DESC`,
      [(req as any).userId],
    )).rows;
    res.json({ releases });
  }),
);

// ============================================================================
// GET ONE (with items)
// ============================================================================
router.get('/:id',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const release = await ownedRelease(req as AuthRequest, req.params.id);
    res.json({ release: { ...release, items: await enrichItems(release.id) } });
  }),
);

// ============================================================================
// CREATE
// ============================================================================
router.post('/',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const { name, scheduledAt } = req.body ?? {};
    if (!name || !String(name).trim()) throw new ValidationError('Give your release a name');
    let when: Date | null = null;
    if (scheduledAt) {
      when = new Date(scheduledAt);
      if (isNaN(when.getTime())) throw new ValidationError('Invalid release date');
    }
    const r = (await db.query(
      `INSERT INTO releases (artist_id, name, scheduled_at, status)
       VALUES ($1, $2, $3, 'draft') RETURNING *`,
      [(req as any).userId, String(name).trim(), when],
    )).rows[0];
    logger.info('Release created', { artistId: (req as any).userId, releaseId: r.id });
    res.status(201).json({ release: r });
  }),
);

// ============================================================================
// UPDATE (name / date) — only while not yet published
// ============================================================================
router.patch('/:id',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const release = await ownedRelease(req as AuthRequest, req.params.id);
    if (release.status === 'published') throw new ValidationError('This release has already gone live');

    const { name, scheduledAt } = req.body ?? {};
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (name !== undefined) {
      if (!String(name).trim()) throw new ValidationError('Give your release a name');
      fields.push(`name = $${i++}`); values.push(String(name).trim());
    }
    if (scheduledAt !== undefined) {
      let when: Date | null = null;
      if (scheduledAt) {
        when = new Date(scheduledAt);
        if (isNaN(when.getTime())) throw new ValidationError('Invalid release date');
      }
      fields.push(`scheduled_at = $${i++}`); values.push(when);
    }
    if (fields.length === 0) throw new ValidationError('Nothing to update');
    values.push(release.id);
    const r = (await db.query(
      `UPDATE releases SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values,
    )).rows[0];
    res.json({ release: r });
  }),
);

// ============================================================================
// ADD ITEM
// ============================================================================
router.post('/:id/items',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const release = await ownedRelease(req as AuthRequest, req.params.id);
    if (release.status === 'published') throw new ValidationError('This release has already gone live');

    const { itemType, itemId } = req.body ?? {};
    if (!ITEM_TYPES.includes(itemType)) throw new ValidationError('itemType must be model, bundle, or table');
    if (!itemId || typeof itemId !== 'string') throw new ValidationError('itemId is required');

    const userId = (req as any).userId;
    const userEmail = (req as AuthRequest).user!.email;
    // Ownership check per type.
    let owned = false;
    if (itemType === 'model') {
      owned = (await db.query(`SELECT 1 FROM models WHERE id = $1 AND artist_id = $2`, [itemId, userId])).rows.length > 0;
    } else if (itemType === 'bundle') {
      owned = (await db.query(`SELECT 1 FROM bundles WHERE id = $1 AND artist_id = $2`, [itemId, userId])).rows.length > 0;
    } else {
      owned = (await db.query(`SELECT 1 FROM user_tables WHERE id = $1 AND user_email = $2`, [itemId, userEmail])).rows.length > 0;
    }
    if (!owned) throw new ValidationError(`That ${itemType} isn't one of yours`);

    await db.query(
      `INSERT INTO release_items (release_id, item_type, item_id)
       VALUES ($1, $2, $3) ON CONFLICT (release_id, item_type, item_id) DO NOTHING`,
      [release.id, itemType, itemId],
    );
    res.status(201).json({ items: await enrichItems(release.id) });
  }),
);

// ============================================================================
// REMOVE ITEM (by release_items.id)
// ============================================================================
router.delete('/:id/items/:itemId',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const release = await ownedRelease(req as AuthRequest, req.params.id);
    await db.query(`DELETE FROM release_items WHERE id = $1 AND release_id = $2`, [req.params.itemId, release.id]);
    res.json({ items: await enrichItems(release.id) });
  }),
);

// ============================================================================
// SCHEDULE — validate items are publishable + set a future go-live time
// ============================================================================
router.post('/:id/schedule',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const release = await ownedRelease(req as AuthRequest, req.params.id);
    const { scheduledAt } = req.body ?? {};
    const raw = scheduledAt ?? release.scheduled_at;
    if (!raw) throw new ValidationError('Pick a date and time to release');
    const when = new Date(raw);
    if (isNaN(when.getTime())) throw new ValidationError('Invalid release date');
    if (when.getTime() <= Date.now()) throw new ValidationError('Pick a time in the future (or use “Publish now”)');

    const blockers = await releaseBlockers(release.id, (req as any).userId);
    if (blockers.length) {
      throw new ValidationError(`Fix these before scheduling: ${blockers.join('; ')}`);
    }

    const r = (await db.query(
      `UPDATE releases SET status = 'scheduled', scheduled_at = $1, publish_error = NULL, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [when, release.id],
    )).rows[0];
    logger.info('Release scheduled', { releaseId: release.id, scheduledAt: when.toISOString() });
    res.json({ release: r });
  }),
);

// ============================================================================
// UNSCHEDULE — back to draft
// ============================================================================
router.post('/:id/unschedule',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const release = await ownedRelease(req as AuthRequest, req.params.id);
    if (release.status === 'published') throw new ValidationError('This release has already gone live');
    const r = (await db.query(
      `UPDATE releases SET status = 'draft', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [release.id],
    )).rows[0];
    res.json({ release: r });
  }),
);

// ============================================================================
// PUBLISH NOW
// ============================================================================
router.post('/:id/publish-now',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const release = await ownedRelease(req as AuthRequest, req.params.id);
    if (release.status === 'published') throw new ValidationError('This release has already gone live');
    const blockers = await releaseBlockers(release.id, (req as any).userId);
    if (blockers.length) {
      throw new ValidationError(`Fix these before publishing: ${blockers.join('; ')}`);
    }
    await publishRelease(release.id);
    const r = (await db.query(`SELECT * FROM releases WHERE id = $1`, [release.id])).rows[0];
    res.json({ release: { ...r, items: await enrichItems(release.id) } });
  }),
);

// ============================================================================
// DELETE (the grouping only — items keep their own status)
// ============================================================================
router.delete('/:id',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const release = await ownedRelease(req as AuthRequest, req.params.id);
    await db.query(`DELETE FROM releases WHERE id = $1`, [release.id]); // release_items cascade
    res.json({ success: true });
  }),
);

export default router;
