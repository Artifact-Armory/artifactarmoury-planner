// backend/src/routes/library.ts
// Asset library API (catalogue, recommendations, ownership)

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { asyncHandler, ValidationError } from '../middleware/error';
import { AuthRequest, optionalAuth, authenticate } from '../middleware/auth';
import { listMockModels, findMockModel, MockModel } from '../mock/mockModels';

const router = Router();
const libraryLogger = logger.child('LIBRARY');
const IS_MOCK_DB = process.env.DB_MOCK === 'true';

function normaliseLimit(value: unknown, fallback = 20, max = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

router.get(
  '/assets',
  asyncHandler(async (req, res) => {
    const { search, category } = req.query as Record<string, string>;
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = normaliseLimit(req.query.limit, 24);
    const offset = (page - 1) * limit;

    if (IS_MOCK_DB) {
      const allModels = listMockModels().filter((model) => model.inLibrary);

      const matchesSearch = (model: MockModel) => {
        if (!search) return true;
        const needle = search.trim().toLowerCase();
        return (
          model.name.toLowerCase().includes(needle) ||
          model.description?.toLowerCase().includes(needle) ||
          model.tags.some((tag) => tag.toLowerCase().includes(needle))
        );
      };

      const matchesCategory = (model: MockModel) => {
        if (!category) return true;
        return model.category === category;
      };

      const filtered = allModels.filter((model) => matchesSearch(model) && matchesCategory(model));
      const paged = filtered.slice(offset, offset + limit);

      const assets = paged.map((model) => ({
        id: `mock-asset-${model.id}`,
        name: model.name,
        description: model.description,
        category: model.category,
        tags: model.tags,
        preview_url: model.glbFilePath,
        thumbnail_path: model.thumbnailPath,
        base_price: model.price,
        view_count: 0,
        add_count: 0,
        use_count: 0,
        created_at: model.createdAt,
        updated_at: model.createdAt,
        file_ref: model.stlFilePath,
        glb_file_path: model.glbFilePath,
        model_id: model.id,
        width: null,
        depth: null,
        height: null,
        status: 'published',
        visibility: model.visibility,
        artist_name: 'Mock Artist',
        artist_display_name: 'Mock Artist',
      }));

      res.json({
        assets,
        pagination: {
          page,
          limit,
          total: filtered.length,
          totalPages: Math.ceil(filtered.length / limit),
        },
      });
      return;
    }

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(
        `(a.name ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex} OR EXISTS (SELECT 1 FROM unnest(a.tags) tag WHERE tag ILIKE $${paramIndex}))`,
      );
      params.push(`%${search.trim()}%`);
      paramIndex += 1;
    }

    if (category) {
      conditions.push(`a.category = $${paramIndex}`);
      params.push(category);
      paramIndex += 1;
    }

    conditions.push(`a.visibility = 'public'`);
    conditions.push(`a.status = 'published'`);

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalResult = await db.query(
      `SELECT COUNT(*)::INT AS count FROM assets a ${whereClause}`,
      params,
    );
    const total = totalResult.rows[0]?.count ?? 0;

    const result = await db.query(
      `
        SELECT
          a.id,
          a.name,
          a.description,
          a.category,
          a.tags,
          a.preview_url,
          a.thumbnail_path,
          a.base_price,
          a.view_count,
          a.add_count,
          a.use_count,
          a.created_at,
          a.updated_at,
          a.file_ref,
          a.glb_file_path,
          a.width,
          a.depth,
          a.height,
          m.id AS model_id,
          m.width AS model_width,
          m.depth AS model_depth,
          m.height AS model_height,
          u.artist_name,
          u.display_name AS artist_display_name
        FROM assets a
        LEFT JOIN models m ON m.stl_file_path = a.file_ref
        LEFT JOIN users u ON u.id = m.artist_id
        ${whereClause}
        ORDER BY a.use_count DESC, a.view_count DESC, a.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limit, offset],
    );

    const assets = result.rows.map((row) => ({
      ...row,
      width: row.width ?? row.model_width ?? null,
      depth: row.depth ?? row.model_depth ?? null,
      height: row.height ?? row.model_height ?? null,
    }));

    res.json({
      assets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }),
);

router.get(
  '/assets/:assetId',
  asyncHandler(async (req, res) => {
    const { assetId } = req.params;

    if (IS_MOCK_DB) {
      const modelId = assetId.startsWith('mock-asset-') ? assetId.replace('mock-asset-', '') : assetId;
      const lookup = findMockModel(modelId);
      if (!lookup || !lookup.model.inLibrary) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }

      const model = lookup.model;
      res.json({
        asset: {
          id: `mock-asset-${model.id}`,
          name: model.name,
          description: model.description,
          category: model.category,
          tags: model.tags,
          file_ref: model.stlFilePath,
          glb_file_path: model.glbFilePath,
          preview_url: model.glbFilePath,
          thumbnail_path: model.thumbnailPath,
          base_price: model.price,
          status: 'published',
          visibility: model.visibility,
          view_count: 0,
          add_count: 0,
          use_count: 0,
          created_at: model.createdAt,
          updated_at: model.createdAt,
          published_at: model.createdAt,
        },
      });
      return;
    }

    const result = await db.query(
      `
        SELECT 
          a.id,
          a.name,
          a.description,
          a.category,
          a.tags,
          a.file_ref,
          a.glb_file_path,
          a.preview_url,
          a.thumbnail_path,
          a.base_price,
          a.status,
          a.visibility,
          a.view_count,
          a.add_count,
          a.use_count,
          a.created_at,
          a.updated_at,
          a.published_at
        FROM assets a
        WHERE a.id = $1
      `,
      [assetId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    res.json({ asset: result.rows[0] });
  }),
);

router.get(
  '/assets/:assetId/recent',
  asyncHandler(async (req, res) => {
    const { assetId } = req.params;

    if (IS_MOCK_DB) {
      res.json({ usage: [] });
      return;
    }

    const result = await db.query(
      `
        SELECT 
          rau.table_id,
          t.name AS table_name,
          rau.used_at
        FROM recent_asset_usage rau
        JOIN tables t ON t.id = rau.table_id
        WHERE rau.asset_id = $1
        ORDER BY rau.used_at DESC
        LIMIT 20
      `,
      [assetId],
    );

    res.json({ usage: result.rows });
  }),
);

router.post(
  '/assets/:assetId/usage',
  asyncHandler(async (req: AuthRequest, res) => {
    const { assetId } = req.params;
    const { tableId } = req.body as { tableId?: string };

    if (!tableId) {
      throw new ValidationError('tableId is required');
    }

    if (IS_MOCK_DB) {
      res.status(201).json({ success: true });
      return;
    }

    await db.query(
      `
        INSERT INTO recent_asset_usage (table_id, asset_id, used_by)
        VALUES ($1, $2, $3)
      `,
      [tableId, assetId, req.userId ?? null],
    );

    await db.query(
      `
        UPDATE assets
        SET use_count = use_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [assetId],
    );

    libraryLogger.debug('Asset usage tracked', {
      assetId,
      tableId,
      userId: req.userId ?? null,
    });

    res.status(201).json({ success: true });
  }),
);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    if (IS_MOCK_DB) {
      const models = listMockModels().filter((model) => model.inLibrary);
      const counts = new Map<string, number>();
      for (const model of models) {
        counts.set(model.category, (counts.get(model.category) ?? 0) + 1);
      }

      const categories = Array.from(counts.entries()).map(([value, count]) => ({
        category: value,
        asset_count: count,
      }));

      res.json({ categories });
      return;
    }

    const result = await db.query(
      `
        SELECT category, COUNT(*)::INT AS asset_count
        FROM assets
        WHERE visibility = 'public' AND status = 'published'
        GROUP BY category
        ORDER BY asset_count DESC, category ASC
      `,
    );

    res.json({ categories: result.rows });
  }),
);

router.get(
  '/models/:modelId/asset',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { modelId } = req.params;

    if (IS_MOCK_DB) {
      const lookup = findMockModel(modelId);
      if (!lookup || lookup.model.status !== 'published' || lookup.model.visibility !== 'public') {
        res.status(404).json({ error: 'Model not found or not publicly available' });
        return;
      }

      const model = lookup.model;
      if (!model.glbFilePath) {
        res.status(409).json({ error: 'Model is missing GLB preview file' });
        return;
      }

      res.json({
        asset: {
          id: `mock-asset-${model.id}`,
          name: model.name,
          description: model.description,
          category: model.category,
          tags: model.tags,
          file_ref: model.stlFilePath,
          glb_file_path: model.glbFilePath,
          preview_url: model.glbFilePath,
          thumbnail_path: model.thumbnailPath,
          base_price: model.price,
          status: 'published',
          visibility: model.visibility,
          view_count: 0,
          add_count: 0,
          use_count: 0,
          created_at: model.createdAt,
          updated_at: model.createdAt,
        },
      });
      return;
    }

    const modelResult = await db.query(
      `
        SELECT
          m.id,
          m.artist_id,
          m.name,
          m.description,
          m.category,
          m.tags,
          m.stl_file_path,
          m.glb_file_path,
          m.thumbnail_path,
          m.base_price,
          m.status,
          m.visibility,
          m.width,
          m.depth,
          m.height
        FROM models m
        WHERE m.id = $1
          AND m.status = 'published'
          AND m.visibility = 'public'
      `,
      [modelId],
    );

    if (modelResult.rows.length === 0) {
      res.status(404).json({ error: 'Model not found or not publicly available' });
      return;
    }

    const model = modelResult.rows[0];

    if (!model.glb_file_path) {
      res.status(409).json({ error: 'Model is missing GLB preview file' });
      return;
    }

    const existingAssetResult = await db.query(
      `
        SELECT
          id,
          name,
          description,
          category,
          tags,
          preview_url,
          thumbnail_path,
          base_price,
          view_count,
          add_count,
          use_count,
          created_at,
          updated_at,
          file_ref,
          glb_file_path,
          status,
          visibility,
          width,
          depth,
          height
        FROM assets
        WHERE file_ref = $1
      `,
      [model.stl_file_path],
    );

    let asset = existingAssetResult.rows[0] ?? null;

    if (!asset) {
      const insertResult = await db.query(
        `
          INSERT INTO assets (
            artist_id,
            name,
            description,
            category,
            tags,
            file_ref,
            glb_file_path,
            preview_url,
            thumbnail_path,
            base_price,
            status,
            visibility,
            width,
            depth,
            height
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'published', 'public', $11, $12, $13)
          RETURNING
            id,
            name,
            description,
            category,
            tags,
            preview_url,
            thumbnail_path,
            base_price,
            view_count,
            add_count,
            use_count,
            created_at,
            updated_at,
            file_ref,
            glb_file_path,
            status,
            visibility,
            width,
            depth,
            height
        `,
        [
          model.artist_id,
          model.name,
          model.description,
          model.category,
          model.tags,
          model.stl_file_path,
          model.glb_file_path,
          model.glb_file_path,
          model.thumbnail_path,
          model.base_price,
          model.width,
          model.depth,
          model.height,
        ],
      );
      asset = insertResult.rows[0];
      libraryLogger.info('Asset auto-created from model', {
        modelId,
        assetId: asset.id,
      });
    }

    const assetInfoResult = await db.query(
      `
        SELECT
          a.id,
          a.name,
          a.description,
          a.category,
          a.tags,
          a.preview_url,
          a.thumbnail_path,
          a.base_price,
          a.view_count,
          a.add_count,
          a.use_count,
          a.created_at,
          a.updated_at,
          a.file_ref,
          a.glb_file_path,
          a.status,
          a.visibility,
          a.width,
          a.depth,
          a.height,
          m.id AS model_id,
          u.artist_name,
          u.display_name AS artist_display_name
        FROM assets a
        LEFT JOIN models m ON m.stl_file_path = a.file_ref
        LEFT JOIN users u ON u.id = m.artist_id
        WHERE a.id = $1
      `,
      [asset.id],
    );

    res.json({ asset: assetInfoResult.rows[0] ?? asset });
  }),
);

router.get(
  '/owned',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const result = await db.query(
      `
        SELECT DISTINCT ON (m.id)
          COALESCE(a.id, m.id) AS id,
          a.id AS asset_id,
          a.name AS asset_name,
          COALESCE(a.description, m.description) AS description,
          COALESCE(a.category, m.category) AS category,
          COALESCE(a.tags, m.tags) AS tags,
          a.preview_url,
          a.thumbnail_path,
          COALESCE(a.base_price, m.base_price) AS base_price,
          a.view_count,
          a.add_count,
          a.use_count,
          a.created_at,
          a.updated_at,
          a.file_ref,
          a.glb_file_path,
          m.id AS model_id,
          u.artist_name,
          u.display_name AS artist_display_name
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN models m ON m.id = oi.model_id
        LEFT JOIN assets a ON a.file_ref = m.stl_file_path
        LEFT JOIN users u ON u.id = m.artist_id
        WHERE o.user_id = $1
          AND o.payment_status = 'succeeded'
        ORDER BY m.id, o.created_at DESC
      `,
      [req.userId],
    );

    const assets = result.rows.map((row) => ({
      ...row,
      id: row.asset_id ?? row.id,
    }));

    res.json({ assets });
  }),
);

router.delete(
  '/owned/:assetId',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { assetId } = req.params;

    const ownedResult = await db.query(
      `
        SELECT DISTINCT
          oi.model_id,
          COALESCE(a.file_ref, m.stl_file_path) AS file_ref,
          COALESCE(a.id, $2::UUID) AS asset_id
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN models m ON m.id = oi.model_id
        LEFT JOIN assets a ON a.file_ref = m.stl_file_path
        WHERE o.user_id = $1
          AND o.payment_status = 'succeeded'
          AND (a.id = $2 OR oi.model_id = $2)
        LIMIT 1
      `,
      [req.userId, assetId],
    );

    if (ownedResult.rowCount === 0) {
      res.status(404).json({ error: 'Owned asset not found' });
      return;
    }

    const row = ownedResult.rows[0];
    const modelId = row.model_id;
    const fileRef = row.file_ref;
    const resolvedAssetId = row.asset_id || assetId;

    const deleteResult = await db.query(
      `
        DELETE FROM table_assets
        WHERE (asset_id = $1 OR asset_id = $4)
          AND table_id IN (
            SELECT id FROM tables
            WHERE user_id = $2
              OR (session_id = $3 AND $3 IS NOT NULL)
          )
        RETURNING table_id
      `,
      [assetId, req.userId ?? null, req.session?.isAnonymous ? req.session.id : null, resolvedAssetId],
    );

    if (!fileRef) {
      libraryLogger.warn('Owned asset removal skipped: missing file ref', {
        userId: req.userId,
        assetId,
      });
    }

    res.json({
      success: true,
      removedCount: deleteResult.rowCount,
      affectedTables: deleteResult.rows.map((table) => table.table_id),
      modelId,
    });
  }),
);

router.get(
  '/sets',
  optionalAuth,
  asyncHandler(async (_req, res) => {
    if (IS_MOCK_DB) {
      res.json({ sets: [] });
      return;
    }

    const result = await db.query(
      `
        SELECT
          s.id,
          s.name,
          s.description,
          s.is_public,
          s.created_at,
          s.updated_at,
          u.display_name AS owner_name,
          json_agg(
            json_build_object(
              'id', a.id,
              'name', a.name,
              'description', a.description,
              'category', a.category,
              'tags', a.tags,
              'preview_url', a.preview_url,
              'thumbnail_path', a.thumbnail_path,
              'base_price', a.base_price,
              'view_count', a.view_count,
              'add_count', a.add_count,
              'use_count', a.use_count,
              'created_at', a.created_at,
              'updated_at', a.updated_at,
              'file_ref', a.file_ref,
              'glb_file_path', a.glb_file_path,
              'model_id', m.id,
              'artist_name', au.artist_name,
              'artist_display_name', au.display_name
            )
          ) FILTER (WHERE a.id IS NOT NULL) AS assets
        FROM asset_sets s
        LEFT JOIN users u ON u.id = s.owner_id
        LEFT JOIN asset_set_items asi ON asi.set_id = s.id
        LEFT JOIN assets a ON a.id = asi.asset_id
        LEFT JOIN models m ON m.stl_file_path = a.file_ref
        LEFT JOIN users au ON au.id = m.artist_id
        WHERE s.is_public = TRUE
        GROUP BY s.id, u.display_name
        ORDER BY s.updated_at DESC
      `,
    );

    const sets = result.rows.map((row) => ({
      ...row,
      assets: Array.isArray(row.assets) ? row.assets : [],
    }));

    res.json({ sets });
  }),
);

export default router;
