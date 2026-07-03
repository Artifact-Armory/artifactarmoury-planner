// backend/src/routes/bundles.ts
// Bundles: an artist groups several of their own models under one name + one
// price. Buying a bundle grants download access to every model in it (the order
// flow expands a bundle into one order_items row per constituent model).

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { authenticate, requireArtist, optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ValidationError, NotFoundError, AuthorizationError } from '../middleware/error';

const router = Router();

// Load a bundle's constituent models (public projection).
async function loadBundleModels(bundleId: string) {
  const result = await db.query(
    `SELECT m.id, m.name, m.thumbnail_path, m.base_price, m.status, m.processing_status
     FROM bundle_items bi
     JOIN models m ON bi.model_id = m.id
     WHERE bi.bundle_id = $1
     ORDER BY bi.display_order ASC`,
    [bundleId]
  );
  return result.rows;
}

// Validate that every id is a model owned by this artist and ready to sell.
async function assertOwnedReadyModels(artistId: string, modelIds: string[]) {
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    throw new ValidationError('A bundle needs at least one model');
  }
  const uniq = [...new Set(modelIds.map((m) => String(m)))];
  const found = await db.query(
    `SELECT id FROM models
     WHERE id = ANY($1::uuid[]) AND artist_id = $2
       AND (processing_status IS NULL OR processing_status = 'ready')`,
    [uniq, artistId]
  );
  if (found.rows.length !== uniq.length) {
    throw new ValidationError('Every model in a bundle must be one of your own, fully-processed models');
  }
  return uniq;
}

// ============================================================================
// CREATE BUNDLE (artist)
// ============================================================================
router.post('/',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const { name, description, price, modelIds, thumbnailKey } = req.body ?? {};

    if (!name || !String(name).trim()) throw new ValidationError('Give your bundle a name');
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) throw new ValidationError('Enter a valid bundle price');
    if (thumbnailKey != null && (typeof thumbnailKey !== 'string' || !thumbnailKey.startsWith('thumbnails/'))) {
      throw new ValidationError('thumbnailKey must be an uploaded thumbnails/ object');
    }
    const ids = await assertOwnedReadyModels(artistId, modelIds);

    const inserted = await db.query(
      `INSERT INTO bundles (artist_id, name, description, price, thumbnail_path, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING id, name, created_at`,
      [artistId, String(name).trim(), description || null, priceNum, thumbnailKey || null]
    );
    const bundle = inserted.rows[0];

    for (let i = 0; i < ids.length; i++) {
      await db.query(
        `INSERT INTO bundle_items (bundle_id, model_id, display_order) VALUES ($1, $2, $3)`,
        [bundle.id, ids[i], i]
      );
    }

    logger.info('Bundle created', { artistId, bundleId: bundle.id });
    res.status(201).json({ bundle: { id: bundle.id, name: bundle.name, status: 'draft', createdAt: bundle.created_at } });
  })
);

// ============================================================================
// MY BUNDLES (artist — all statuses)
// ============================================================================
router.get('/my-bundles',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const bundles = await db.query(
      `SELECT b.*, COUNT(bi.model_id) AS model_count
       FROM bundles b
       LEFT JOIN bundle_items bi ON bi.bundle_id = b.id
       WHERE b.artist_id = $1
       GROUP BY b.id
       ORDER BY b.created_at DESC`,
      [artistId]
    );
    // Attach the model list to each bundle so the dashboard can preview them.
    const withModels = await Promise.all(
      bundles.rows.map(async (b: any) => ({ ...b, models: await loadBundleModels(b.id) }))
    );
    res.json({ bundles: withModels });
  })
);

// ============================================================================
// PUBLIC LIST (published bundles)
// ============================================================================
router.get('/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 24 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const bundles = await db.query(
      `SELECT b.*, u.artist_name, COUNT(bi.model_id) AS model_count
       FROM bundles b
       JOIN users u ON b.artist_id = u.id
       LEFT JOIN bundle_items bi ON bi.bundle_id = b.id
       WHERE b.status = 'published' AND b.visibility = 'public'
       GROUP BY b.id, u.artist_name
       ORDER BY b.published_at DESC NULLS LAST, b.created_at DESC
       LIMIT $1 OFFSET $2`,
      [Number(limit), offset]
    );
    // Attach members so the planner palette can expand a bundle into its models.
    const withModels = await Promise.all(
      bundles.rows.map(async (b: any) => ({ ...b, models: await loadBundleModels(b.id) }))
    );
    res.json({ bundles: withModels });
  })
);

// ============================================================================
// GET ONE (public if published, else owner)
// ============================================================================
router.get('/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await db.query(
      `SELECT b.*, u.artist_name FROM bundles b
       JOIN users u ON b.artist_id = u.id
       WHERE b.id = $1`,
      [id]
    );
    if (result.rows.length === 0) throw new NotFoundError('Bundle');
    const bundle = result.rows[0];

    const userId = (req as any).userId;
    const isOwner = userId && bundle.artist_id === userId;
    if (bundle.status !== 'published' && !isOwner) throw new NotFoundError('Bundle');

    res.json({ bundle: { ...bundle, models: await loadBundleModels(id) } });
  })
);

// ============================================================================
// UPDATE (owner)
// ============================================================================
router.patch('/:id',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const { id } = req.params;

    const owned = await db.query(`SELECT id FROM bundles WHERE id = $1 AND artist_id = $2`, [id, artistId]);
    if (owned.rows.length === 0) throw new AuthorizationError('You do not own this bundle');

    const { name, description, price, modelIds, thumbnailKey } = req.body ?? {};
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (name !== undefined) {
      if (!String(name).trim()) throw new ValidationError('Give your bundle a name');
      fields.push(`name = $${i++}`); values.push(String(name).trim());
    }
    if (description !== undefined) { fields.push(`description = $${i++}`); values.push(description || null); }
    if (price !== undefined) {
      const p = parseFloat(price);
      if (isNaN(p) || p < 0) throw new ValidationError('Enter a valid bundle price');
      fields.push(`price = $${i++}`); values.push(p);
    }
    if (thumbnailKey !== undefined) {
      if (thumbnailKey != null && (typeof thumbnailKey !== 'string' || !thumbnailKey.startsWith('thumbnails/'))) {
        throw new ValidationError('thumbnailKey must be an uploaded thumbnails/ object');
      }
      fields.push(`thumbnail_path = $${i++}`); values.push(thumbnailKey || null);
    }

    if (fields.length > 0) {
      values.push(id);
      await db.query(`UPDATE bundles SET ${fields.join(', ')} WHERE id = $${i}`, values);
    }

    // Replace the model set if provided.
    if (modelIds !== undefined) {
      const ids = await assertOwnedReadyModels(artistId, modelIds);
      await db.query(`DELETE FROM bundle_items WHERE bundle_id = $1`, [id]);
      for (let k = 0; k < ids.length; k++) {
        await db.query(`INSERT INTO bundle_items (bundle_id, model_id, display_order) VALUES ($1, $2, $3)`, [id, ids[k], k]);
      }
    }

    logger.info('Bundle updated', { artistId, bundleId: id });
    res.json({ bundle: { id } });
  })
);

// ============================================================================
// PUBLISH / UNPUBLISH (owner)
// ============================================================================
router.post('/:id/publish',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const { id } = req.params;

    const result = await db.query(
      `SELECT b.name, b.description, b.price, b.thumbnail_path, COUNT(bi.model_id) AS model_count
       FROM bundles b LEFT JOIN bundle_items bi ON bi.bundle_id = b.id
       WHERE b.id = $1 AND b.artist_id = $2
       GROUP BY b.id`,
      [id, artistId]
    );
    if (result.rows.length === 0) throw new NotFoundError('Bundle');
    const b = result.rows[0];

    if (!b.thumbnail_path) throw new ValidationError('Add a bundle thumbnail before publishing');
    if (!b.description || b.description.length < 20) throw new ValidationError('Add a description (minimum 20 characters)');
    if (parseFloat(b.price) <= 0) throw new ValidationError('Set a price greater than 0');
    if (Number(b.model_count) < 2) throw new ValidationError('A bundle needs at least 2 models');

    await db.query(
      `UPDATE bundles SET status = 'published', visibility = 'public', published_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
    logger.info('Bundle published', { artistId, bundleId: id });
    res.json({ bundleId: id });
  })
);

router.post('/:id/unpublish',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const { id } = req.params;
    const owned = await db.query(`SELECT id FROM bundles WHERE id = $1 AND artist_id = $2`, [id, artistId]);
    if (owned.rows.length === 0) throw new AuthorizationError('You do not own this bundle');
    await db.query(`UPDATE bundles SET status = 'draft', visibility = 'private' WHERE id = $1`, [id]);
    res.json({ bundleId: id });
  })
);

// ============================================================================
// DELETE (owner)
// ============================================================================
router.delete('/:id',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const { id } = req.params;
    const owned = await db.query(`SELECT id FROM bundles WHERE id = $1 AND artist_id = $2`, [id, artistId]);
    if (owned.rows.length === 0) throw new AuthorizationError('You do not own this bundle');
    await db.query(`DELETE FROM bundles WHERE id = $1`, [id]); // bundle_items cascade
    logger.info('Bundle deleted', { artistId, bundleId: id });
    res.json({ success: true });
  })
);

export default router;
