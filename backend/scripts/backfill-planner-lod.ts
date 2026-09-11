// backend/scripts/backfill-planner-lod.ts
//
// Queue RE-BAKES so the existing catalogue gets a planner LOD (migration 064).
//
// WHY THIS IS A RE-BAKE AND NOT A RE-PROCESS. Every other backfill in this repo
// derives something new from a file we already have. This one cannot. The LOD is
// produced by simplifying the bake's output, and a proxy baked before
// proxyCreaseAngleDeg was turned on is FLAT-SHADED: an STL has no vertex normals,
// so Blender imports it flat, and a flat-shaded mesh gives every triangle its own
// copy of each vertex. There are no shared edges left to collapse, and meshopt
// refuses to — asked for 33% of a real flat bake it returned 91-95% of the
// triangles. The shared edges only exist if the mesh is crease-shaded, and that
// happens inside Blender. So the whole bake has to run again.
//
// WHAT THAT COSTS. A real bake is roughly 20-60 seconds of Blender per mesh, and
// the worker drains its queue serially, BEHIND nothing — a backfill job sits in
// the same queue as a live artist's upload. Use --limit and run it in batches
// rather than dumping the catalogue in at once, or an artist uploading during the
// backfill waits behind all of it. /admin/queues shows the depth while it drains.
//
// WHAT ELSE CHANGES. The re-baked proxy is crease-shaded rather than flat, so this
// also updates what every buyer sees on the product page. That was QA'd before the
// default flipped — identical geometry, identical emboss holes, and under 1% of
// pixels changed at the closest camera distance — but it is a real change, not
// purely additive, so it is worth knowing before kicking off a few hundred bakes.
//
//   railway run npm run backfill:planner-lod -- --dry-run
//   railway run npm run backfill:planner-lod -- --limit 25
//   railway run npm run backfill:planner-lod
//   railway run npm run backfill:planner-lod -- --force      # re-bake even ones already done
//
// Run it linked to the BACKEND service so DATABASE_URL is injected. Safe to
// re-run: meshes with an open bake job are skipped, and so are meshes whose
// proxy_report already records a planner-LOD outcome.

import './script-env'
import { db, closeDatabase } from '../src/db'
import { enqueueBakeJob, isBakeWorkerEnabled } from '../src/services/proxyBake/queue'

interface Mesh {
  model_id: string
  part_id: string | null
  source_key: string | null
  source_format: string
  label: string
  overrides: unknown
  /** Already carries a planner-LOD verdict in proxy_report (built, or knowingly skipped). */
  done: boolean
  /** A bake for this mesh is queued or running right now. */
  open_job: boolean
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const LIMIT = Number(arg('limit') ?? 0) || Infinity

// The bake's source is NOT simply stl_file_path. A pre-supported listing
// (migrations 053/054) previews from its clean display file, and an OBJ upload
// bakes from the original so its materials survive into the baseColor atlas.
// This mirrors previewSourceKey in services/modelIngest/process.ts — get it wrong
// and a re-bake quietly regenerates a presupported model's preview from the file
// with the support struts still in it.
const SOURCE_KEY_SQL = (t: string) => `
  CASE
    WHEN ${t}.display_stl_path IS NOT NULL THEN ${t}.display_stl_path
    WHEN ${t}.source_format = 'obj' AND ${t}.source_file_path IS NOT NULL THEN ${t}.source_file_path
    ELSE ${t}.stl_file_path
  END`
const SOURCE_FORMAT_SQL = (t: string) => `
  CASE
    WHEN ${t}.display_stl_path IS NULL AND ${t}.source_format = 'obj' THEN 'obj'
    ELSE 'stl'
  END`

async function main() {
  // Check the CONNECTION before the feature flag. Both failures look identical
  // from the outside — neither var is set — but only one of them is about this
  // script: running without `railway run` (or linked to the wrong service) injects
  // no production env at all, so the flag reads as off AND every query would run
  // against the local mock and cheerfully report zero models. Blaming the flag
  // there sends you off to change a Railway setting that was already correct.
  if (process.env.DB_MOCK === 'true' || !process.env.DATABASE_URL) {
    console.error(
      'Not connected to a real database — this is the local DB_MOCK environment.\n\n' +
        'Run it through Railway, linked to the BACKEND service, so DATABASE_URL and\n' +
        'PROXY_BAKE_ENABLED are injected:\n\n' +
        '  railway link          (choose the project, then the backend service)\n' +
        '  railway run npm run backfill:planner-lod -- --dry-run\n',
    )
    process.exit(1)
  }

  // A dry run writes nothing, so it is allowed through with a warning: seeing how
  // big the job is before deciding whether to turn the worker on is a reasonable
  // thing to want, and refusing it forces the flag to be flipped blind.
  if (!isBakeWorkerEnabled()) {
    const msg =
      'PROXY_BAKE_ENABLED is not "true" — nothing would ever drain these jobs.\n' +
      'Set it on the backend service, and confirm the worker service is running.'
    if (!DRY_RUN) {
      console.error(msg)
      process.exit(1)
    }
    console.warn(`WARNING: ${msg}\nContinuing anyway because this is a --dry-run.\n`)
  }

  const { rows: models } = await db.query(
    `SELECT m.id AS model_id, NULL::uuid AS part_id,
            ${SOURCE_KEY_SQL('m')} AS source_key,
            ${SOURCE_FORMAT_SQL('m')} AS source_format,
            m.name AS label,
            m.proxy_bake_config AS overrides,
            (m.proxy_report -> 'plannerLod') IS NOT NULL AS done,
            EXISTS (
              SELECT 1 FROM proxy_bake_jobs j
               WHERE j.model_id = m.id AND j.part_id IS NULL
                 AND j.status IN ('queued', 'running')
            ) AS open_job
       FROM models m
      WHERE m.processing_status = 'ready'
        AND m.status <> 'archived'
      ORDER BY m.sale_count DESC NULLS LAST, m.created_at DESC`,
  )

  const { rows: parts } = await db.query(
    `SELECT p.model_id, p.id AS part_id,
            ${SOURCE_KEY_SQL('p')} AS source_key,
            ${SOURCE_FORMAT_SQL('p')} AS source_format,
            COALESCE(m.name, '') || ' / ' || COALESCE(p.name, 'part') AS label,
            -- The PART's own override column, not its model's: that is what the
            -- upload path uses for a part, and it is normally NULL, so this
            -- reproduces production's behaviour rather than newly applying a
            -- model-level override to its parts.
            p.proxy_bake_config AS overrides,
            (p.proxy_report -> 'plannerLod') IS NOT NULL AS done,
            EXISTS (
              SELECT 1 FROM proxy_bake_jobs j
               WHERE j.part_id = p.id AND j.status IN ('queued', 'running')
            ) AS open_job
       FROM model_parts p
       JOIN models m ON m.id = p.model_id
      WHERE p.processing_status = 'ready'
        AND m.status <> 'archived'
      ORDER BY m.sale_count DESC NULLS LAST, m.created_at DESC`,
  )

  // Most-sold first, so a partly-drained queue has still re-baked the models
  // people are most likely to be looking at in the planner.
  const all: Mesh[] = [...models, ...parts]
  const todo = all.filter((m) => {
    if (!m.source_key) return false
    if (m.open_job) return false // already about to be re-baked
    return FORCE || !m.done
  })

  const skippedNoSource = all.filter((m) => !m.source_key).length
  const skippedOpen = all.filter((m) => m.source_key && m.open_job).length
  const alreadyDone = all.filter((m) => m.done).length

  console.log(`Meshes found:   ${all.length} (${models.length} models, ${parts.length} set parts)`)
  console.log(`  already done: ${alreadyDone}${FORCE ? ' (ignored — --force)' : ''}`)
  console.log(`  bake in queue:${skippedOpen}`)
  console.log(`  no source key:${skippedNoSource}`)
  console.log(`To enqueue:     ${Math.min(todo.length, LIMIT)}`)
  if (todo.length > 0) {
    const mins = (Math.min(todo.length, LIMIT) * 40) / 60
    console.log(
      `\nRough drain time at ~40s/bake on one worker: ${mins.toFixed(0)} minutes. ` +
        `Artist uploads queue BEHIND these — use --limit and batch it.`,
    )
  }

  if (DRY_RUN) {
    for (const m of todo.slice(0, 20)) {
      console.log(`  would re-bake  ${m.part_id ? 'part ' : 'model'}  ${m.label}  [${m.source_format}]`)
    }
    if (todo.length > 20) console.log(`  … and ${todo.length - 20} more`)
    return
  }

  let queued = 0
  for (const m of todo.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
    await enqueueBakeJob({
      modelId: m.model_id,
      partId: m.part_id,
      sourceKey: m.source_key!,
      sourceFormat: m.source_format,
      overrides: (m.overrides as any) ?? null,
    })
    queued++
    if (queued % 25 === 0) console.log(`  … ${queued} queued`)
  }
  console.log(`\nQueued ${queued} re-bake(s). Watch it drain:`)
  console.log(`  /admin/queues`)
  console.log(
    `  npm run db:query -- "SELECT status, count(*) FROM proxy_bake_jobs GROUP BY status"`,
  )
  console.log(
    `  npm run db:query -- "SELECT count(*) FILTER (WHERE lod_glb_path IS NOT NULL) AS with_lod, count(*) FROM models WHERE processing_status = 'ready'"`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDatabase().catch(() => {}))
