// backend/src/routes/files.ts
// Artist file library ("My files", artist feedback 3 Nov 2026).
//   GET  /api/files            → the signed-in artist's library
//   POST /api/files            { key, fileName, folder? } → register an uploaded library/ object
//   POST /api/files/delete     { ids } → remove files from the library (and R2)
//   POST /api/files/:id/use    → copy one library file to a fresh raw/ key for a listing upload
// The browser uploads bytes straight to R2 (presign/multipart with prefix "library"),
// exactly like listing uploads, then registers the key here.

import { Router } from 'express';
import crypto from 'crypto';
import path from 'path';
import { db } from '../db';
import logger from '../utils/logger';
import { authenticate, requireArtist, requireVerifiedEmail, requireTwoFactor } from '../middleware/auth';
import { presignRateLimit } from '../middleware/security';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/error';
import { isR2Enabled, objectSize, copyObject, deleteObject } from '../services/r2';
import { MAX_MODEL_FILE_BYTES, MAX_MODEL_FILE_MB } from '../services/meshConvert';

const router = Router();

const MAX_FILES = Number(process.env.ARTIST_FILE_LIBRARY_MAX_FILES) || 5000;
const MAX_GB = Number(process.env.ARTIST_FILE_LIBRARY_MAX_GB) || 50;
const MAX_BYTES = MAX_GB * 1024 * 1024 * 1024;
const LIBRARY_KEY_RE = /^library\/[0-9a-f]{32}\.(stl|obj|3mf)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanFileName(v: unknown): string {
  const base = String(v ?? '').split(/[\\/]/).pop()?.trim() ?? '';
  if (!base) throw new ValidationError('fileName is required');
  if (!/\.(stl|obj|3mf)$/i.test(base)) throw new ValidationError('Only .stl, .obj and .3mf files can go in your library');
  return base.slice(0, 255);
}

// "Tanks/Shermans/" → "Tanks/Shermans" ; empty → null (top level).
function cleanFolder(v: unknown): string | null {
  if (v == null) return null;
  const parts = String(v).split(/[\\/]+/).map((p) => p.trim()).filter((p) => p && p !== '.' && p !== '..');
  const folder = parts.join('/').slice(0, 500);
  return folder || null;
}

router.use(authenticate, requireArtist);

router.get('/',
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    const result = await db.query(
      `SELECT id, file_name, folder, size_bytes, use_count, last_used_at, created_at
         FROM artist_files WHERE artist_id = $1
        ORDER BY folder NULLS FIRST, file_name`,
      [userId],
    );
    const files = result.rows.map((r: any) => ({
      id: r.id,
      fileName: r.file_name,
      folder: r.folder,
      size: Number(r.size_bytes),
      useCount: Number(r.use_count),
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    }));
    const totalBytes = files.reduce((n: number, f: any) => n + f.size, 0);
    res.json({ files, totalBytes, maxFiles: MAX_FILES, maxBytes: MAX_BYTES });
  }),
);

router.post('/',
  requireVerifiedEmail,
  requireTwoFactor,
  asyncHandler(async (req, res) => {
    if (!isR2Enabled()) throw new ValidationError('Direct uploads are not configured (R2 is disabled)');
    const userId = (req as any).userId;
    const { key } = req.body ?? {};
    if (typeof key !== 'string' || !LIBRARY_KEY_RE.test(key)) {
      throw new ValidationError('key must be an uploaded library/ object');
    }
    const fileName = cleanFileName(req.body?.fileName);
    const folder = cleanFolder(req.body?.folder);
    if (path.extname(fileName).toLowerCase() !== path.extname(key)) {
      throw new ValidationError('File type does not match the upload');
    }

    const size = await objectSize(key);
    if (size == null) throw new ValidationError('File not found in storage. Upload it again.');
    if (size > MAX_MODEL_FILE_BYTES) {
      await deleteObject(key).catch(() => {});
      throw new ValidationError(`"${fileName}" is over the ${MAX_MODEL_FILE_MB}MB limit per file.`);
    }

    const usage = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(size_bytes), 0)::bigint AS bytes FROM artist_files WHERE artist_id = $1`,
      [userId],
    );
    const n = Number(usage.rows[0]?.n ?? 0);
    const bytes = Number(usage.rows[0]?.bytes ?? 0);
    if (n >= MAX_FILES || bytes + size > MAX_BYTES) {
      await deleteObject(key).catch(() => {});
      throw new ValidationError(
        n >= MAX_FILES
          ? `Your library is full (${MAX_FILES} files). Delete files you no longer need.`
          : `Your library is full (${MAX_GB} GB). Delete files you no longer need.`,
      );
    }

    const result = await db.query(
      `INSERT INTO artist_files (artist_id, r2_key, file_name, folder, size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (r2_key) DO NOTHING
       RETURNING id, file_name, folder, size_bytes, use_count, created_at`,
      [userId, key, fileName, folder, size],
    );
    if (!result.rows.length) throw new ValidationError('This file is already in a library');
    const r = result.rows[0];
    res.status(201).json({
      file: { id: r.id, fileName: r.file_name, folder: r.folder, size: Number(r.size_bytes), useCount: 0, createdAt: r.created_at },
    });
  }),
);

router.post('/delete',
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError('Choose files to delete');
    if (ids.length > 1000) throw new ValidationError('Delete at most 1000 files at a time');
    if (!ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) throw new ValidationError('Invalid file id');

    // artist_id in the WHERE: only the artist's own files are ever deleted.
    const result = await db.query(
      `DELETE FROM artist_files WHERE artist_id = $1 AND id = ANY($2::uuid[]) RETURNING r2_key`,
      [userId, ids],
    );
    // Listings never point at library/ objects (picking copies the file), so
    // removing the object can't break a listing.
    for (const row of result.rows) {
      try { await deleteObject(row.r2_key); } catch (err) {
        logger.warn('Failed to delete library object', { error: err, key: row.r2_key });
      }
    }
    res.json({ deleted: result.rows.length });
  }),
);

router.post('/:id/use',
  requireVerifiedEmail,
  requireTwoFactor,
  presignRateLimit,
  asyncHandler(async (req, res) => {
    if (!isR2Enabled()) throw new ValidationError('Direct uploads are not configured (R2 is disabled)');
    const userId = (req as any).userId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) throw new NotFoundError('File not found');
    const result = await db.query(
      `SELECT r2_key, file_name FROM artist_files WHERE id = $1 AND artist_id = $2`,
      [id, userId],
    );
    if (!result.rows.length) throw new NotFoundError('File not found in your library');
    const { r2_key, file_name } = result.rows[0];

    // Fresh quarantine key, same shape as /api/uploads/presign gives, so the
    // listing flow (from-upload, add parts, new version) treats it as a new upload.
    const ext = path.extname(r2_key).toLowerCase();
    const rawKey = `raw/${crypto.randomBytes(16).toString('hex')}${ext}`;
    await copyObject(r2_key, rawKey);

    await db.query(
      `UPDATE artist_files SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );
    res.json({ key: rawKey, fileName: file_name });
  }),
);

export default router;
