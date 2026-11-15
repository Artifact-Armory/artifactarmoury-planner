// backend/src/services/turntableBackfill.ts
//
// Draws the product page's spin-around view (pieceRender.ts renderTurntable) for
// every model and placeable part, one per idle worker cycle. Lowest priority of
// all: it runs only when the ingest, bake and full-GLB queues are empty and no
// fingerprint upgrade or palette picture is waiting. Covers the existing
// catalogue and every new upload alike, so no script is needed.
//
// Drawn from the OWNER GLB (migration 041): full detail and no embossed logo,
// which is the point. The public 3D preview has to be the protected proxy because
// its geometry reaches the browser; here only pictures are published, so the
// buyer can be shown the real thing. full_glb_path stays secret as always.
//
// turntable_key records what a sheet was drawn from. When the owner GLB is
// rebuilt (new file version) or the artist changes the default tilt, the key no
// longer matches and the sheet is redrawn. A failure is stored against the same
// key, so it is retried only when the inputs change (or clear turntable_key).

import crypto from 'crypto'
import { db } from '../db'
import logger from '../utils/logger'
import { deleteObject, downloadObject, uploadObject } from './r2'
import { renderTurntable } from './pieceRender'

export const isTurntableEnabled = () => process.env.TURNTABLE_ENABLED !== 'false'

/**
 * What a sheet is drawn from. `x` is the row itself, `m` the listing (the same
 * row for a model). Mirrored (inlined) in worker/proxyBakeWorker.ts: keep in step.
 */
const KEY_SQL = `md5(x.full_glb_path || ':' || m.default_pitch_deg || ':' || m.default_roll_deg)`
const NEEDS_SQL = `x.processing_status = 'ready' AND x.full_glb_status = 'ready' AND x.full_glb_path IS NOT NULL
  AND m.deleted_at IS NULL AND x.turntable_key IS DISTINCT FROM ${KEY_SQL}`
export const MODEL_NEEDS_TURNTABLE_SQL = `SELECT x.id FROM models x JOIN models m ON m.id = x.id WHERE ${NEEDS_SQL}`
export const PART_NEEDS_TURNTABLE_SQL = `SELECT x.id FROM model_parts x JOIN models m ON m.id = x.model_id
  WHERE ${NEEDS_SQL} AND x.preview_skipped = false`

type Table = 'models' | 'model_parts'
interface Row { table: Table; id: string; glbKey: string; key: string; pitch: number; roll: number; old: string | null }

async function pickRow(): Promise<Row | null> {
  // Listings first (published before drafts), then the pieces inside sets.
  const sources: Array<[Table, string, string]> = [
    ['models', MODEL_NEEDS_TURNTABLE_SQL, `(m.status = 'published') DESC, random()`],
    ['model_parts', PART_NEEDS_TURNTABLE_SQL, `(m.status = 'published') DESC, random()`],
  ]
  for (const [table, sql, order] of sources) {
    const { rows } = await db.query(
      sql.replace('SELECT x.id', `SELECT x.id, x.full_glb_path, x.turntable_path, ${KEY_SQL} AS key,
        m.default_pitch_deg, m.default_roll_deg`) + ` ORDER BY ${order} LIMIT 1`,
    )
    const r = rows[0]
    if (r) {
      return {
        table, id: r.id, glbKey: r.full_glb_path, key: r.key, old: r.turntable_path ?? null,
        pitch: Number(r.default_pitch_deg) || 0, roll: Number(r.default_roll_deg) || 0,
      }
    }
  }
  return null
}

/** Draw one spin-around sheet. Returns false when there was nothing to do. */
export async function renderOneMissingTurntable(): Promise<boolean> {
  const row = await pickRow()
  if (!row) return false
  const t0 = Date.now()
  try {
    const sheet = await renderTurntable(await downloadObject(row.glbKey), { pitchDeg: row.pitch, rollDeg: row.roll })
    const path = `thumbnails/spin-${crypto.randomBytes(16).toString('hex')}.webp`
    await uploadObject(path, sheet, 'image/webp')
    await db.query(
      `UPDATE ${row.table} SET turntable_path = $1, turntable_key = $2, turntable_failed_at = NULL WHERE id = $3`,
      [path, row.key, row.id],
    )
    if (row.old) await deleteObject(row.old).catch(() => undefined)
    logger.info('Turntable stored', { table: row.table, id: row.id, bytes: sheet.length, ms: Date.now() - t0 })
  } catch (err: any) {
    logger.warn('Turntable failed, marked; retried when the model changes', {
      table: row.table, id: row.id, error: err?.message || String(err),
    })
    // Keep any older sheet: a slightly out-of-date spin beats none.
    await db
      .query(`UPDATE ${row.table} SET turntable_key = $1, turntable_failed_at = NOW() WHERE id = $2`, [row.key, row.id])
      .catch((e) => logger.error('Could not mark failed turntable', { id: row.id, error: e }))
  }
  return true
}
