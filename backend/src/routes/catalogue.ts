// backend/src/routes/catalogue.ts
// Bulk catalogue edit by CSV (artist feedback, 3 Nov 2026).
//   GET  /api/catalogue/export.csv   → every listing of the signed-in artist
//   POST /api/catalogue/import/preview { csv } → what would change (no writes)
//   POST /api/catalogue/import/apply   { csv } → same check again, then saves
// Only the artist's own non-deleted listings are ever read or written.

import { Router } from 'express';
import { db, transaction } from '../db';
import logger from '../utils/logger';
import { authenticate, requireArtist } from '../middleware/auth';
import { asyncHandler, ValidationError } from '../middleware/error';
import { recordPrice } from '../services/sales';
import { buildCatalogueCsv, planImport, CatalogueRow, ImportPlan } from '../services/catalogueCsv';

const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
// ~5,000 rows with long descriptions; express.json already caps bodies at 10 MB.
const MAX_CSV_CHARS = 8 * 1024 * 1024;

async function loadCatalogue(artistId: string): Promise<CatalogueRow[]> {
  const result = await db.query(
    `SELECT id, name, base_price, description, license, printer_type, show_in_planner, status, category
       FROM models
      WHERE artist_id = $1 AND deleted_at IS NULL AND status <> 'deleted'
      ORDER BY created_at DESC`,
    [artistId],
  );
  return result.rows;
}

function csvFromBody(body: any): string {
  const csv = body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) throw new ValidationError('Choose a CSV file to upload');
  if (csv.length > MAX_CSV_CHARS) throw new ValidationError('That file is too big. Split it into smaller files.');
  return csv;
}

// What the browser needs to show the preview (the raw `update` objects stay server-side).
function previewShape(plan: ImportPlan) {
  return {
    rowsRead: plan.rowsRead,
    unchanged: plan.unchanged,
    ignoredColumns: plan.ignoredColumns,
    errors: plan.errors,
    warnings: plan.warnings,
    changed: plan.changed.map(({ id, line, name, changes }) => ({ id, line, name, changes })),
  };
}

router.get('/export.csv',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    const rows = await loadCatalogue(userId);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="artifact-armoury-catalogue-${date}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildCatalogueCsv(rows, FRONTEND_URL));
  }),
);

router.post('/import/preview',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    const plan = planImport(csvFromBody(req.body), await loadCatalogue(userId));
    res.json(previewShape(plan));
  }),
);

router.post('/import/apply',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    // Re-check against the listings as they are now, not as they were at preview.
    const plan = planImport(csvFromBody(req.body), await loadCatalogue(userId));
    if (plan.errors.length) {
      res.status(400).json({ message: 'Fix the errors in the file first. Nothing was changed.', ...previewShape(plan) });
      return;
    }
    if (plan.changed.length === 0) {
      res.json({ updated: 0, message: 'Nothing to change.' });
      return;
    }

    await transaction(async (client) => {
      for (const row of plan.changed) {
        const sets: string[] = [];
        const values: any[] = [];
        for (const [col, val] of Object.entries(row.update)) {
          values.push(val);
          sets.push(`${col} = $${values.length}`);
        }
        values.push(row.id, userId);
        // artist_id in the WHERE as well: a second guard that only own rows change.
        await client.query(
          `UPDATE models SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${values.length - 1} AND artist_id = $${values.length} AND deleted_at IS NULL`,
          values,
        );
      }
    });

    // Price history feeds the sale anti-inflation guard (same as PATCH /models/:id).
    for (const row of plan.changed) {
      if (row.update.base_price !== undefined) await recordPrice('model', row.id, row.update.base_price);
    }

    logger.info('Catalogue CSV import applied', { userId, updated: plan.changed.length });
    res.json({ updated: plan.changed.length, message: `Updated ${plan.changed.length} listing${plan.changed.length === 1 ? '' : 's'}.` });
  }),
);

export default router;
