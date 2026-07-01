// backend/src/routes/table-library.ts
// Table-scoped asset library operations

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { asyncHandler, ValidationError } from '../middleware/error';
import { AuthRequest, optionalAuth } from '../middleware/auth';
import { findMockModel } from '../mock/mockModels';

const tableLibraryLogger = logger.child('TABLE_LIBRARY');
const router = Router({ mergeParams: true });
const IS_MOCK_DB = process.env.DB_MOCK === 'true';

router.use(optionalAuth);

interface TableRecord {
  id: string;
  user_id: string | null;
  session_id: string | null;
  is_public: boolean;
}

async function loadTable(tableId: string): Promise<TableRecord | null> {
  const result = await db.query(
    `
      SELECT id, user_id, session_id, is_public
      FROM tables
      WHERE id = $1
    `,
    [tableId],
  );
  return result.rows[0] ?? null;
}

function canModifyTable(req: AuthRequest, table: TableRecord): boolean {
  if (req.user?.role === 'admin') return true;
  if (table.user_id && req.userId && table.user_id === req.userId) return true;
  if (!table.user_id && table.session_id && req.session?.isAnonymous && req.session.id === table.session_id) {
    return true;
  }
  return false;
}

function canViewTable(req: AuthRequest, table: TableRecord): boolean {
  if (table.is_public) return true;
  return canModifyTable(req, table);
}

function normaliseQuantity(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.min(parsed, 99);
}

router.get(
  '/:tableId/library/assets',
  asyncHandler(async (req: AuthRequest, res) => {
    const { tableId } = req.params;

    if (IS_MOCK_DB) {
      res.json({ assets: [] });
      return;
    }

    const table = await loadTable(tableId);
    if (!table) {
      res.status(404).json({ error: 'Table not found' });
      return;
    }

    if (!canViewTable(req, table)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const result = await db.query(
      `
        SELECT
          ta.asset_id,
          ta.quantity,
          ta.last_used,
          a.name,
          a.description,
          a.category,
          a.tags,
          a.preview_url,
          a.thumbnail_path,
          a.base_price,
          a.glb_file_path,
          m.id AS model_id,
          u.artist_name,
          u.display_name AS artist_display_name
        FROM table_assets ta
        JOIN assets a ON a.id = ta.asset_id
        LEFT JOIN models m ON m.stl_file_path = a.file_ref
        LEFT JOIN users u ON u.id = m.artist_id
        WHERE ta.table_id = $1
        ORDER BY ta.last_used DESC, a.name ASC
      `,
      [tableId],
    );

    res.json({ assets: result.rows });
  }),
);

router.post(
  '/:tableId/library/assets',
  asyncHandler(async (req: AuthRequest, res) => {
    const { tableId } = req.params;
    const { assetId, asset_id, quantity } = req.body as {
      assetId?: string;
      asset_id?: string;
      quantity?: number;
    };

    const resolvedAssetId = assetId ?? asset_id;
    if (!resolvedAssetId) {
      throw new ValidationError('assetId is required');
    }

    if (IS_MOCK_DB) {
      const mockModelId = resolvedAssetId.startsWith('mock-asset-')
        ? resolvedAssetId.replace('mock-asset-', '')
        : resolvedAssetId;
      const mockModel = findMockModel(mockModelId);
      if (!mockModel) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      res.status(201).json({
        success: true,
        asset: {
          asset_id: resolvedAssetId,
          quantity: normaliseQuantity(quantity),
        },
      });
      return;
    }

    const table = await loadTable(tableId);
    if (!table) {
      res.status(404).json({ error: 'Table not found' });
      return;
    }

    if (!canModifyTable(req, table)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const assetResult = await db.query(
      `
        SELECT id
        FROM assets
        WHERE id = $1 AND status = 'published' AND visibility = 'public'
      `,
      [resolvedAssetId],
    );

    if (assetResult.rows.length === 0) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    const qty = normaliseQuantity(quantity);

    await db.query(
      `
        INSERT INTO table_assets (table_id, asset_id, quantity, added_by, last_used)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (table_id, asset_id)
        DO UPDATE SET
          quantity = EXCLUDED.quantity,
          last_used = CURRENT_TIMESTAMP
      `,
      [tableId, resolvedAssetId, qty, req.userId ?? null],
    );

    await db.query(
      `
        UPDATE assets
        SET add_count = add_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [resolvedAssetId],
    );

    tableLibraryLogger.info('Asset added to table', {
      tableId,
      assetId: resolvedAssetId,
      userId: req.userId ?? null,
    });

    res.status(201).json({ success: true });
  }),
);

router.delete(
  '/:tableId/library/assets/:assetId',
  asyncHandler(async (req: AuthRequest, res) => {
    const { tableId, assetId } = req.params;

    if (IS_MOCK_DB) {
      res.json({ success: true });
      return;
    }

    const table = await loadTable(tableId);
    if (!table) {
      res.status(404).json({ error: 'Table not found' });
      return;
    }

    if (!canModifyTable(req, table)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    await db.query(
      `
        DELETE FROM table_assets
        WHERE table_id = $1 AND asset_id = $2
      `,
      [tableId, assetId],
    );

    res.json({ success: true });
  }),
);

export default router;
