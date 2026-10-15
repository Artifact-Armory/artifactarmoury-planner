// backend/src/services/pieceRenderBackfill.ts
//
// Renders a picture of each placeable piece of a multi-part listing that has no
// photo of its own (services/pieceRender.ts), one piece per idle worker cycle —
// lowest priority, only when the ingest/bake/full-GLB queues are empty, the same
// slot as fingerprintUpgrade.ts. Covers the existing catalogue and every new
// upload alike, so no script is needed.
//
// A piece that can't be rendered (GLB missing from R2, undecodable) gets
// render_failed_at and is skipped from then on; clear it to retry.

import crypto from 'crypto'
import { db } from '../db'
import logger from '../utils/logger'
import { downloadObject, uploadObject } from './r2'
import { renderPieceThumbnail } from './pieceRender'

export const isPieceRenderEnabled = () => process.env.PIECE_RENDER_ENABLED !== 'false'

/** Pieces that want a render. Mirrored (inlined) in worker/proxyBakeWorker.ts — keep in step. */
export const PART_NEEDS_RENDER_SQL = `render_thumbnail_path IS NULL AND render_failed_at IS NULL
  AND thumbnail_path IS NULL AND preview_skipped = false
  AND processing_status = 'ready' AND glb_file_path IS NOT NULL`
export const MODEL_NEEDS_RENDER_SQL = `render_thumbnail_path IS NULL AND render_failed_at IS NULL
  AND primary_thumbnail_path IS NULL AND part_count > 1 AND deleted_at IS NULL
  AND processing_status = 'ready' AND glb_file_path IS NOT NULL`

type Table = 'models' | 'model_parts'

async function pickRow(): Promise<{ table: Table; id: string; key: string } | null> {
  for (const [table, where] of [['models', MODEL_NEEDS_RENDER_SQL], ['model_parts', PART_NEEDS_RENDER_SQL]] as const) {
    // random() spreads replicas across different rows instead of all racing for one.
    const { rows } = await db.query(`SELECT id, glb_file_path FROM ${table} WHERE ${where} ORDER BY random() LIMIT 1`)
    if (rows[0]) return { table, id: rows[0].id, key: rows[0].glb_file_path }
  }
  return null
}

/** Render one piece. Returns false when there was nothing to do. */
export async function renderOneMissingPiece(): Promise<boolean> {
  const row = await pickRow()
  if (!row) return false
  const where = row.table === 'models' ? MODEL_NEEDS_RENDER_SQL : PART_NEEDS_RENDER_SQL
  const t0 = Date.now()
  try {
    const image = await renderPieceThumbnail(await downloadObject(row.key))
    const key = `thumbnails/render-${crypto.randomBytes(16).toString('hex')}.webp`
    await uploadObject(key, image, 'image/webp')
    await db.query(`UPDATE ${row.table} SET render_thumbnail_path = $1 WHERE id = $2 AND ${where}`, [key, row.id])
    logger.info('Piece render stored', { table: row.table, id: row.id, bytes: image.length, ms: Date.now() - t0 })
  } catch (err: any) {
    logger.warn('Piece render failed — marked, will not retry', { table: row.table, id: row.id, error: err?.message || String(err) })
    await db
      .query(`UPDATE ${row.table} SET render_failed_at = NOW() WHERE id = $1`, [row.id])
      .catch((e) => logger.error('Could not mark failed piece render', { id: row.id, error: e }))
  }
  return true
}
