// backend/scripts/recheck-mesh-qa.ts
//
// Re-run the mesh check (services/meshQA.ts) on listings that currently show a
// hole warning, so they get the 10 Nov 2026 rules: hairline cracks and pinholes
// that every slicer repairs no longer count. Downloads each listing's main STL
// from R2, re-analyses it and rewrites the mesh_* columns. Doesn't touch status,
// files or the preview. Safe to re-run.
//
//   railway run npm run recheck:mesh -- --dry-run
//   railway run npm run recheck:mesh
//   railway run npm run recheck:mesh -- --artist <artist user id>
//   railway run npm run recheck:mesh -- --all      # every analysed listing, not just flagged ones
//
// Run it linked to the BACKEND service so the R2 keys are injected (see
// scripts/script-env.ts for reaching the database from a laptop).

import './script-env'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { db, closeDatabase } from '../src/db'
import { downloadObject } from '../src/services/r2'
import { analyzeMeshQuality } from '../src/services/meshQA'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const DRY_RUN = process.argv.includes('--dry-run')
const ALL = process.argv.includes('--all')
const ARTIST = arg('artist')
const LIMIT = Number(arg('limit') ?? 0) || Infinity

async function main() {
  const params: unknown[] = []
  let where = `deleted_at IS NULL AND stl_file_path IS NOT NULL AND mesh_analyzed`
  if (!ALL) where += ` AND COALESCE(mesh_open_edges, 0) > 0`
  if (ARTIST) {
    params.push(ARTIST)
    where += ` AND artist_id = $${params.length}`
  }
  const { rows } = await db.query(
    `SELECT id, name, stl_file_path AS key, primary_part_name, mesh_open_edges
       FROM models WHERE ${where} ORDER BY created_at`,
    params,
  )
  const todo = rows.slice(0, LIMIT)
  console.log(`${rows.length} listing(s) to re-check; doing ${todo.length}${DRY_RUN ? ' (dry run)' : ''}`)
  if (DRY_RUN) {
    for (const r of todo) console.log(`  ${r.id}  ${r.name}  (${r.primary_part_name ?? 'main file'}, ${r.mesh_open_edges} open edges)`)
    await closeDatabase()
    return
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-recheck-'))
  let cleared = 0, still = 0, failed = 0
  try {
    for (const [i, r] of todo.entries()) {
      const tmp = path.join(tmpDir, 'mesh.stl')
      try {
        console.log(`  [${i + 1}/${todo.length}] downloading ${r.name} ...`)
        await fs.writeFile(tmp, await downloadObject(r.key))
        console.log(`  [${i + 1}/${todo.length}] analysing ...`)
        const t0 = Date.now()
        const qa = await analyzeMeshQuality(tmp)
        if (!qa.analyzed) throw new Error(qa.note || 'analysis skipped')
        await db.query(
          `UPDATE models SET mesh_is_watertight = $1, mesh_is_manifold = $2,
                  mesh_open_edges = $3, mesh_report = $4
            WHERE id = $5`,
          [qa.watertight, qa.manifold, qa.significantOpenEdges, JSON.stringify(qa), r.id],
        )
        if (qa.significantOpenEdges > 0) still++
        else cleared++
        console.log(`  [${i + 1}/${todo.length}] ${qa.significantOpenEdges > 0 ? '!' : '✓'} ${r.name}: ` +
          `${r.mesh_open_edges} -> ${qa.significantOpenEdges} (holes ${qa.holes}, largest ${qa.largestHolePerimeter} mm round, ${Date.now() - t0} ms)`)
      } catch (err: any) {
        failed++
        console.log(`  [${i + 1}/${todo.length}] ✗ ${r.name}: ${err?.message || err}`)
      } finally {
        await fs.rm(tmp, { force: true })
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
    await closeDatabase()
  }
  console.log(`\nDone: ${cleared} cleared, ${still} still warned, ${failed} failed.`)
  if (failed) process.exitCode = 1
}

main().catch(async (e) => { console.error(e); await closeDatabase().catch(() => {}); process.exit(1) })
