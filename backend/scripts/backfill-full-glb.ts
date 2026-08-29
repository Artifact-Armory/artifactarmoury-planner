// backend/scripts/backfill-full-glb.ts
//
// Queue owner full-fidelity GLB builds for models that already exist.
//
// Migration 041 only enqueues on NEW uploads and file-version replacements, so
// every model already in the catalogue would sit at full_glb_status = NULL
// forever and its buyers would keep seeing the preview proxy. Run this once after
// deploying 041 (and again after any long spell with FULL_GLB_ENABLED=false).
//
// It only writes queue rows — the actual builds are drained by whatever is
// draining them (the bake worker, or the API server's inline drainer), at their
// normal below-previews priority. Safe to re-run: the unique partial index on
// (model_id, part_id) WHERE status IN ('queued','running') collapses duplicates,
// and meshes that already have a ready GLB are skipped unless --force.
//
//   railway run npm run backfill:full-glb -- --dry-run
//   railway run npm run backfill:full-glb
//   railway run npm run backfill:full-glb -- --limit 50
//   railway run npm run backfill:full-glb -- --force        # rebuild ready ones too
//
// Run it linked to the BACKEND service so DATABASE_URL is injected.

import 'dotenv/config'
import { db, closeDatabase } from '../src/db'
import { enqueueFullGlbJob, isFullGlbEnabled } from '../src/services/fullGlb/queue'

interface Mesh {
  model_id: string
  part_id: string | null
  source_key: string | null
  label: string
  status: string | null
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const LIMIT = Number(arg('limit') ?? 0) || Infinity

async function main() {
  if (!isFullGlbEnabled()) {
    console.error('FULL_GLB_ENABLED=false — nothing would ever build these. Aborting.')
    process.exit(1)
  }

  // Only models that finished processing: an in-flight upload will enqueue its own
  // job when it completes, and a failed one has no canonical STL worth converting.
  const { rows: models } = await db.query(
    `SELECT id AS model_id, NULL::uuid AS part_id, stl_file_path AS source_key,
            name AS label, full_glb_status AS status
       FROM models
      WHERE processing_status = 'ready'
        AND stl_file_path IS NOT NULL
        AND status <> 'archived'
      ORDER BY sale_count DESC NULLS LAST, created_at DESC`,
  )
  const { rows: parts } = await db.query(
    `SELECT p.model_id, p.id AS part_id, p.stl_file_path AS source_key,
            COALESCE(m.name, '') || ' / ' || COALESCE(p.name, 'part') AS label,
            p.full_glb_status AS status
       FROM model_parts p
       JOIN models m ON m.id = p.model_id
      WHERE p.processing_status = 'ready'
        AND p.stl_file_path IS NOT NULL
        AND m.status <> 'archived'
      ORDER BY m.created_at DESC`,
  )

  // Most-sold first: if the queue is only partly drained before someone looks, the
  // models people actually own are the ones that got built.
  const all: Mesh[] = [...models, ...parts]
  const todo = all.filter((m) => {
    if (!m.source_key) return false
    if (FORCE) return true
    // 'skipped' meshes were rejected on size and would be rejected again;
    // 'failed' ones have already burned their attempts. Both need --force.
    return m.status !== 'ready' && m.status !== 'skipped' && m.status !== 'failed'
  })

  const counts = all.reduce<Record<string, number>>((acc, m) => {
    const k = m.status ?? 'none'
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  console.log(`Meshes found: ${all.length} (${models.length} models, ${parts.length} set parts)`)
  console.log('Current full_glb_status:', counts)
  console.log(`To enqueue: ${Math.min(todo.length, LIMIT)}${FORCE ? ' (--force)' : ''}`)

  if (DRY_RUN) {
    for (const m of todo.slice(0, 20)) {
      console.log(`  would queue  ${m.part_id ? 'part' : 'model'}  ${m.label}`)
    }
    if (todo.length > 20) console.log(`  … and ${todo.length - 20} more`)
    return
  }

  let queued = 0
  for (const m of todo.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
    const id = await enqueueFullGlbJob({
      modelId: m.model_id,
      partId: m.part_id,
      sourceKey: m.source_key,
    })
    if (id) queued++
    if (queued % 25 === 0 && queued) console.log(`  … ${queued} queued`)
  }
  console.log(`Queued ${queued} build(s). Drain progress:`)
  console.log(`  npm run db:query -- "SELECT status, count(*) FROM full_glb_jobs GROUP BY status"`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDatabase().catch(() => {}))
