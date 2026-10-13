// backend/src/services/fingerprintUpgrade.ts
//
// Upgrades stored geometry fingerprints to the current version, one file at a
// time, inside the worker — the lowest-priority thing it does, only when no
// upload, preview bake or owner-GLB build is waiting.
//
// Why here and not only scripts/backfill-fingerprints.ts: that script runs on a
// laptop via `railway run`, and the production database's public proxy is not
// reachable from every network (it timed out from the office connection on
// 2026-10-13). The worker is already inside Railway, already has R2 and the
// database, and already fingerprints uploads in an isolated child process.
//
// Until a row is upgraded its old fingerprint is simply incomparable — it can't
// block an upload — so there is no hurry; this just gets there on its own.
//
// Only rows that already HAVE a fingerprint are touched (a rejected upload stores
// none on purpose). A file that can't be upgraded (missing from R2, unparseable)
// gets `upgradeFailedAt` written into its old fingerprint JSON so it isn't
// retried forever; the laptop script ignores that marker and will retry it.

import path from 'path'
import os from 'os'
import { promises as fsp } from 'fs'
import { db } from '../db'
import logger from '../utils/logger'
import { downloadObject } from './r2'
import { FINGERPRINT_VERSION } from './fingerprint'
import { isolatedFingerprint, isIsolatedFailure } from './modelIngest/isolatedRunner'

export const isFingerprintUpgradeEnabled = () => process.env.FINGERPRINT_UPGRADE_ENABLED !== 'false'

/** SQL predicate for a row whose fingerprint should be upgraded (alias-free). */
export const STALE_FINGERPRINT_SQL = `geometry_fingerprint IS NOT NULL
  AND COALESCE(geometry_fingerprint->>'v', '1') <> '${FINGERPRINT_VERSION}'
  AND geometry_fingerprint->>'upgradeFailedAt' IS NULL
  AND stl_file_path IS NOT NULL`

type Table = 'models' | 'model_parts'

async function pickStaleRow(): Promise<{ table: Table; id: string; key: string } | null> {
  for (const table of ['models', 'model_parts'] as Table[]) {
    // random() spreads replicas across different rows instead of all racing for one.
    const { rows } = await db.query(
      `SELECT id, stl_file_path FROM ${table} WHERE ${STALE_FINGERPRINT_SQL} ORDER BY random() LIMIT 1`,
    )
    if (rows[0]) return { table, id: rows[0].id, key: rows[0].stl_file_path }
  }
  return null
}

/** Upgrade one stale fingerprint. Returns false when there was nothing to do. */
export async function upgradeOneStaleFingerprint(): Promise<boolean> {
  const row = await pickStaleRow()
  if (!row) return false

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-fp-upgrade-'))
  const t0 = Date.now()
  try {
    const stlTmp = path.join(tmpDir, 'mesh.stl')
    await fsp.writeFile(stlTmp, await downloadObject(row.key))
    const result = await isolatedFingerprint(stlTmp)
    if (isIsolatedFailure(result)) throw new Error(result.reason)
    // Guarded on still being stale, so a replica that raced us (or a fresh
    // re-upload that already wrote a current fingerprint) is never overwritten.
    const { rowCount } = await db.query(
      `UPDATE ${row.table} SET geometry_fingerprint = $1 WHERE id = $2 AND ${STALE_FINGERPRINT_SQL}`,
      [JSON.stringify(result.fingerprint), row.id],
    )
    logger.info('Geometry fingerprint upgraded', {
      table: row.table, id: row.id, tris: result.fingerprint.tris, ms: Date.now() - t0, written: rowCount === 1,
    })
  } catch (err: any) {
    logger.warn('Geometry fingerprint upgrade failed — marked, will not retry', {
      table: row.table, id: row.id, error: err?.message || String(err),
    })
    await db
      .query(
        `UPDATE ${row.table}
            SET geometry_fingerprint = geometry_fingerprint || jsonb_build_object('upgradeFailedAt', NOW()::text)
          WHERE id = $1 AND ${STALE_FINGERPRINT_SQL}`,
        [row.id],
      )
      .catch((e) => logger.error('Could not mark failed fingerprint upgrade', { id: row.id, error: e }))
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
  return true
}
