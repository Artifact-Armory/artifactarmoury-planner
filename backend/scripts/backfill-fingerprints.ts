// backend/scripts/backfill-fingerprints.ts
//
// Upgrade stored geometry fingerprints to the current version (v2, 2026-10-13).
//
// A v1 fingerprint can't be compared with a v2 one, so until this runs every
// model uploaded before the upgrade is invisible to the re-upload check (the
// dedup log reports them as `incomparable`). This downloads each model's /
// part's canonical STL from R2, recomputes the fingerprint and writes it back.
//
// Only rows that ALREADY have a fingerprint are touched: a rejected upload
// deliberately stores none (so it can never become a match candidate), and
// this must not quietly give it one. Safe to re-run — up-to-date rows are
// skipped.
//
//   railway run npm run backfill:fingerprints -- --dry-run
//   railway run npm run backfill:fingerprints
//   railway run npm run backfill:fingerprints -- --limit 50
//
// Run it linked to the BACKEND service so DATABASE_URL and the R2 keys are
// injected. It runs on YOUR machine: every STL is downloaded once, one at a
// time, so expect it to take a while on a large catalogue.

import './script-env'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { db, closeDatabase } from '../src/db'
import { downloadObject } from '../src/services/r2'
import { computeGeometryFingerprint, FINGERPRINT_VERSION } from '../src/services/fingerprint'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT = Number(arg('limit') ?? 0) || Infinity

interface Row { kind: 'model' | 'part'; id: string; key: string; label: string }

async function main() {
  const stale = `geometry_fingerprint IS NOT NULL
    AND COALESCE(geometry_fingerprint->>'v', '1') <> '${FINGERPRINT_VERSION}'
    AND stl_file_path IS NOT NULL`
  const { rows: models } = await db.query(
    `SELECT 'model' AS kind, id, stl_file_path AS key, name AS label
       FROM models WHERE ${stale} ORDER BY created_at`,
  )
  const { rows: parts } = await db.query(
    `SELECT 'part' AS kind, p.id, p.stl_file_path AS key,
            COALESCE(m.name, '') || ' / ' || COALESCE(p.name, 'part') AS label
       FROM model_parts p JOIN models m ON m.id = p.model_id
      WHERE ${stale.replace(/geometry_fingerprint|stl_file_path/g, 'p.$&')}
      ORDER BY m.created_at, p.display_order`,
  )
  const todo: Row[] = [...models, ...parts].slice(0, LIMIT)
  console.log(`${models.length} model(s) + ${parts.length} part(s) need a v${FINGERPRINT_VERSION} fingerprint; doing ${todo.length}${DRY_RUN ? ' (dry run)' : ''}`)
  if (DRY_RUN) {
    for (const r of todo) console.log(`  ${r.kind.padEnd(5)} ${r.id}  ${r.label}`)
    await closeDatabase()
    return
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fp-backfill-'))
  let ok = 0, failed = 0
  try {
    for (const [i, r] of todo.entries()) {
      const tmp = path.join(tmpDir, 'mesh.stl')
      const t0 = Date.now()
      try {
        await fs.writeFile(tmp, await downloadObject(r.key))
        const fp = await computeGeometryFingerprint(tmp)
        const table = r.kind === 'model' ? 'models' : 'model_parts'
        await db.query(`UPDATE ${table} SET geometry_fingerprint = $1 WHERE id = $2`, [JSON.stringify(fp), r.id])
        ok++
        console.log(`  [${i + 1}/${todo.length}] ✓ ${r.label} (${fp.tris.toLocaleString()} tris, ${Date.now() - t0} ms)`)
      } catch (err: any) {
        failed++
        console.log(`  [${i + 1}/${todo.length}] ✗ ${r.label}: ${err?.message || err}`)
      } finally {
        await fs.rm(tmp, { force: true })
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
    await closeDatabase()
  }
  console.log(`\nDone: ${ok} upgraded, ${failed} failed${failed ? ' (re-run to retry them)' : ''}.`)
  if (failed) process.exitCode = 1
}

main().catch(async (e) => { console.error(e); await closeDatabase().catch(() => {}); process.exit(1) })
