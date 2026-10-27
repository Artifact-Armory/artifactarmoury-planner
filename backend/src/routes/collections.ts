// backend/src/routes/collections.ts
// Collections: named groups inside an artist's store ("WW2 buildings") so buyers
// can browse one range of an artist's catalogue. Browsing only — nothing is sold
// as a collection (bundles do that). A listing can be in several collections.
// Public pages only ever show published, public listings; the artist can add
// drafts too, and they appear once published.

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { authenticate, requireArtist } from '../middleware/auth';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/error';
import { annotateModelsWithSales } from '../services/sales';
import { artistIdParam } from '../services/artistSlug';

const router = Router();

// Public routes take the artist's slug or user id.
router.param('artistId', artistIdParam('artistId'));

const MAX_COLLECTIONS = 50;
const MAX_MODELS_PER_COLLECTION = 500;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only these listings count on public pages.
const PUBLIC_MODEL = `m.status = 'published' AND m.visibility = 'public' AND m.deleted_at IS NULL`;

// Same card shape as /api/artists/:id/models (what `mapModelRecord` expects).
const MODEL_CARD_FIELDS = `
  m.id, m.name, m.description, m.category, m.tags,
  m.thumbnail_path, (m.glb_file_path IS NOT NULL) AS has_glb, m.base_price, m.fulfillment_type,
  m.width, m.height, m.depth, m.part_count,
  m.view_count, m.sale_count, m.published_at,
  u.id AS artist_id, u.artist_name, u.artist_url, u.sales_disabled`;

function cleanName(value: unknown): string {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ValidationError('Give your collection a name');
  if (name.length > NAME_MAX) throw new ValidationError(`Keep the name under ${NAME_MAX} characters`);
  return name;
}

function cleanDescription(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (text.length > DESCRIPTION_MAX) throw new ValidationError(`Keep the description under ${DESCRIPTION_MAX} characters`);
  return text || null;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'collection';
}

// First free slug for this artist ("ww2-buildings", then "ww2-buildings-2"…).
async function uniqueSlug(artistId: string, name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  const taken = await db.query(
    `SELECT slug FROM artist_collections
     WHERE artist_id = $1 AND (slug = $2 OR slug LIKE $2 || '-%') AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [artistId, base, excludeId ?? null]
  );
  const used = new Set(taken.rows.map((r: any) => r.slug));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

async function loadOwned(artistId: string, id: string) {
  if (!UUID_RE.test(id)) throw new NotFoundError('Collection');
  const result = await db.query(
    `SELECT id FROM artist_collections WHERE id = $1 AND artist_id = $2`,
    [id, artistId]
  );
  if (result.rows.length === 0) throw new NotFoundError('Collection');
  return result.rows[0];
}

// ============================================================================
// MY COLLECTIONS (artist) — every collection with its ordered model ids
// ============================================================================
router.get('/mine',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const result = await db.query(
      `SELECT c.id, c.name, c.slug, c.description, c.position, c.created_at, c.updated_at,
              COALESCE(
                (SELECT array_agg(cm.model_id ORDER BY cm.position, cm.created_at)
                 FROM artist_collection_models cm
                 JOIN models m ON m.id = cm.model_id AND m.deleted_at IS NULL
                 WHERE cm.collection_id = c.id),
                '{}'
              ) AS model_ids
       FROM artist_collections c
       WHERE c.artist_id = $1
       ORDER BY c.position ASC, c.created_at ASC`,
      [artistId]
    );
    res.json({ collections: result.rows });
  })
);

// ============================================================================
// CREATE (artist)
// ============================================================================
router.post('/',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const name = cleanName(req.body?.name);
    const description = cleanDescription(req.body?.description);

    const count = await db.query(
      `SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM artist_collections WHERE artist_id = $1`,
      [artistId]
    );
    if (Number(count.rows[0]?.n ?? 0) >= MAX_COLLECTIONS) {
      throw new ValidationError(`You can have up to ${MAX_COLLECTIONS} collections`);
    }

    const slug = await uniqueSlug(artistId, name);
    const inserted = await db.query(
      `INSERT INTO artist_collections (artist_id, name, slug, description, position)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, slug, description, position, created_at, updated_at`,
      [artistId, name, slug, description, Number(count.rows[0]?.last ?? -1) + 1]
    );
    logger.info('Collection created', { artistId, collectionId: inserted.rows[0]?.id });
    res.status(201).json({ collection: { ...inserted.rows[0], model_ids: [] } });
  })
);

// ============================================================================
// REORDER (artist) — body: { collectionIds: string[] } in display order
// ============================================================================
router.put('/order',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const ids: unknown = req.body?.collectionIds;
    if (!Array.isArray(ids)) throw new ValidationError('collectionIds must be an array');
    const clean = [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))];

    // Only the artist's own rows are touched; anything else is ignored.
    for (let i = 0; i < clean.length; i++) {
      await db.query(
        `UPDATE artist_collections SET position = $1 WHERE id = $2 AND artist_id = $3`,
        [i, clean[i], artistId]
      );
    }
    res.json({ success: true });
  })
);

// ============================================================================
// RENAME / DESCRIBE (artist) — renaming also updates the URL slug
// ============================================================================
router.patch('/:id',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const { id } = req.params;
    await loadOwned(artistId, id);

    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (req.body?.name !== undefined) {
      const name = cleanName(req.body.name);
      fields.push(`name = $${i++}`); values.push(name);
      fields.push(`slug = $${i++}`); values.push(await uniqueSlug(artistId, name, id));
    }
    if (req.body?.description !== undefined) {
      fields.push(`description = $${i++}`); values.push(cleanDescription(req.body.description));
    }
    if (fields.length === 0) throw new ValidationError('Nothing to update');

    values.push(id);
    const updated = await db.query(
      `UPDATE artist_collections SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${i}
       RETURNING id, name, slug, description, position, created_at, updated_at`,
      values
    );
    res.json({ collection: updated.rows[0] });
  })
);

// ============================================================================
// SET LISTINGS (artist) — body: { modelIds: string[] } in display order
// ============================================================================
router.put('/:id/models',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const { id } = req.params;
    await loadOwned(artistId, id);

    const ids: unknown = req.body?.modelIds;
    if (!Array.isArray(ids)) throw new ValidationError('modelIds must be an array');
    const requested = [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))];
    if (requested.length > MAX_MODELS_PER_COLLECTION) {
      throw new ValidationError(`A collection can hold up to ${MAX_MODELS_PER_COLLECTION} listings`);
    }

    // Keep only the artist's own listings, in the requested order.
    let valid: string[] = [];
    if (requested.length) {
      const owned = await db.query(
        `SELECT id FROM models WHERE id = ANY($1::uuid[]) AND artist_id = $2 AND deleted_at IS NULL`,
        [requested, artistId]
      );
      const ownedSet = new Set(owned.rows.map((r: any) => r.id));
      valid = requested.filter((mid) => ownedSet.has(mid));
    }

    await db.query(`DELETE FROM artist_collection_models WHERE collection_id = $1`, [id]);
    if (valid.length) {
      await db.query(
        `INSERT INTO artist_collection_models (collection_id, model_id, position)
         SELECT $1::uuid, t.model_id, t.ord - 1
         FROM unnest($2::uuid[]) WITH ORDINALITY AS t(model_id, ord)`,
        [id, valid]
      );
    }
    await db.query(`UPDATE artist_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    logger.info('Collection listings updated', { artistId, collectionId: id, count: valid.length });
    res.json({ modelIds: valid });
  })
);

// ============================================================================
// DELETE (artist) — the listings themselves are untouched
// ============================================================================
router.delete('/:id',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const artistId = (req as any).userId;
    const { id } = req.params;
    await loadOwned(artistId, id);
    await db.query(`DELETE FROM artist_collections WHERE id = $1`, [id]); // links cascade
    logger.info('Collection deleted', { artistId, collectionId: id });
    res.json({ success: true });
  })
);

// ============================================================================
// PUBLIC: an artist's collections (only ones with at least one live listing)
// ============================================================================
router.get('/artist/:artistId',
  asyncHandler(async (req, res) => {
    const { artistId } = req.params;
    if (!UUID_RE.test(artistId)) return res.json({ collections: [] });

    const result = await db.query(
      `SELECT c.id, c.name, c.slug, c.description,
              COUNT(m.id) AS model_count,
              (array_agg(m.thumbnail_path ORDER BY cm.position, cm.created_at)
                 FILTER (WHERE m.thumbnail_path IS NOT NULL))[1:4] AS thumbnails
       FROM artist_collections c
       JOIN users u ON u.id = c.artist_id AND u.account_status = 'active'
       JOIN artist_collection_models cm ON cm.collection_id = c.id
       JOIN models m ON m.id = cm.model_id AND ${PUBLIC_MODEL}
       WHERE c.artist_id = $1
       GROUP BY c.id
       ORDER BY c.position ASC, c.created_at ASC`,
      [artistId]
    );
    res.json({ collections: result.rows });
  })
);

// ============================================================================
// PUBLIC: one collection and its live listings (paged, artist's order)
// ============================================================================
router.get('/artist/:artistId/:slug',
  asyncHandler(async (req, res) => {
    const { artistId, slug } = req.params;
    if (!UUID_RE.test(artistId)) throw new NotFoundError('Collection');

    const pageNum = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(String(req.query.limit ?? '24')) || 24), 100);
    const offset = (pageNum - 1) * limitNum;

    // Slug normally; the id also works so a link survives a rename.
    const found = await db.query(
      `SELECT c.id, c.name, c.slug, c.description, c.artist_id, u.artist_slug,
              COALESCE(NULLIF(u.artist_name, ''), u.display_name) AS artist_name
       FROM artist_collections c
       JOIN users u ON u.id = c.artist_id AND u.role = 'artist' AND u.account_status = 'active'
       WHERE c.artist_id = $1 AND (c.slug = $2 OR c.id::text = $2)`,
      [artistId, slug]
    );
    if (found.rows.length === 0) throw new NotFoundError('Collection');
    const collection = found.rows[0];

    const countResult = await db.query(
      `SELECT COUNT(*) AS total
       FROM artist_collection_models cm
       JOIN models m ON m.id = cm.model_id AND ${PUBLIC_MODEL}
       WHERE cm.collection_id = $1`,
      [collection.id]
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10) || 0;

    const models = await db.query(
      `SELECT ${MODEL_CARD_FIELDS}
       FROM artist_collection_models cm
       JOIN models m ON m.id = cm.model_id AND ${PUBLIC_MODEL}
       JOIN users u ON u.id = m.artist_id
       WHERE cm.collection_id = $1
       ORDER BY cm.position ASC, cm.created_at ASC
       LIMIT $2 OFFSET $3`,
      [collection.id, limitNum, offset]
    );
    await annotateModelsWithSales(models.rows);

    res.json({
      collection,
      models: models.rows,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
    });
  })
);

export default router;
