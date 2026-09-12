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
//   railway run npm run backfill:planner-lod -- --model <id> --force   # one model + its parts
//
// AFTER CHANGING A plannerLod* DEFAULT, START WITH --model. The config only takes
// effect through a re-bake, and the thing that has to be checked is not that the
// job ran but that the result LOOKS right in the planner — so re-bake one model you
// can recognise, open it, and only then do the rest.
//
// Run it linked to the **Postgres** service, not the backend one: `railway run`
// injects production's env but executes on your machine, and the backend's
// DATABASE_URL is a private *.railway.internal host that only resolves inside
// Railway. Postgres also exposes DATABASE_PUBLIC_URL, which is reachable — see
// scripts/script-env.ts, which does the swap. Safe to re-run: meshes with an open
// bake job are skipped, and so are meshes whose proxy_report already records a
// planner-LOD outcome.

import './script-env'
import { db, closeDatabase } from '../src/db'
import { enqueueBakeJob } from '../src/services/proxyBake/queue'
import { loadBakeConfig } from '../src/services/proxyBake/config'

// Same window /admin/queues and the queue alarm use (queueHealth.ts owns the
// default); read here rather than importing that service into a one-off script.
const WORKER_STALE_MS = Number(process.env.QUEUE_WORKER_STALE_MS ?? 5 * 60_000)

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
// Restrict to ONE model and its parts. `--limit 1` picks whichever mesh sorts
// first, which is how a smoke test can confirm the pipeline RAN without anyone
// being able to go and look at a model they recognise — the exact gap that let a
// visibly broken LOD reach the whole catalogue. Naming the model means the
// verification step is "open this piece in the planner and look at it".
const MODEL = arg('model')

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
  // Connection first. Running against the local DB_MOCK would report "0 live
  // workers, 0 models" — indistinguishable from a healthy, already-done system.
  if (process.env.DB_MOCK === 'true' || !process.env.DATABASE_URL) {
    console.error(
      [
        'Not connected to a real database — this is the local DB_MOCK environment.',
        '',
        'Run it through Railway, linked to the POSTGRES service. It exposes the',
        'publicly reachable DATABASE_PUBLIC_URL; the backend service only has the',
        'private internal one, which does not resolve off-platform:',
        '',
        '  railway link          (same project, choose "Postgres")',
        '  railway run npm run backfill:planner-lod -- --dry-run',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  // Is anything actually going to RUN these jobs?
  //
  // This used to read PROXY_BAKE_ENABLED, which was the wrong question twice
  // over. It is a property of whichever Railway service the shell happens to be
  // linked to — and this script has to be linked to POSTGRES, for the public
  // database URL, where that variable does not exist — so it reported "disabled"
  // on a perfectly healthy system. More importantly the flag only says uploads
  // are routed to the worker, not that a worker is alive to receive them, which
  // is the thing that actually matters before queueing hundreds of re-bakes.
  //
  // worker_heartbeats (migration 062) answers the real question, from the same
  // database we are already connected to, using the same staleness window
  // /admin/queues and the queue alarm use.
  const { rows: workerRows } = await db.query(
    `SELECT COUNT(*) FILTER (
              WHERE last_seen_at > NOW() - ($1::int * INTERVAL '1 millisecond')
            ) AS live,
            COUNT(*) AS total,
            MAX(last_seen_at) AS newest
       FROM worker_heartbeats`,
    [WORKER_STALE_MS],
  )
  const liveWorkers = Number(workerRows[0]?.live ?? 0)
  if (liveWorkers === 0) {
    const newest = workerRows[0]?.newest
    const msg =
      'No bake worker has checked in within the last ' +
      `${Math.round(WORKER_STALE_MS / 60000)} minutes` +
      (newest ? ` (last seen ${new Date(newest).toISOString()})` : ' (none has ever checked in)') +
      '.\nQueued jobs would sit there indefinitely. Check /admin/queues and the\n' +
      'worker service on Railway before backfilling.'
    if (!DRY_RUN) {
      console.error(msg)
      process.exit(1)
    }
    console.warn(`WARNING: ${msg}\nContinuing anyway because this is a --dry-run.\n`)
  } else {
    console.log(`${liveWorkers} live bake worker(s).\n`)
  }

  // WHICH CONFIG IS THE WORKER GOING TO BAKE WITH? Not this one.
  //
  // `railway run` injects production's env but executes on YOUR machine, so the
  // config this process can read is the LOCAL config/proxyBake.defaults.json --
  // the file you just edited. The bake happens inside the worker container against
  // ITS deployed copy. The two disagree for exactly as long as it takes a push to
  // reach Railway, and a backfill started inside that window re-bakes the
  // catalogue with the settings you believe you have already replaced.
  //
  // Not hypothetical: the plannerLodSimplifyError retune was backfilled before its
  // deploy landed. It rebuilt the broken LOD it existed to fix AND re-enabled it,
  // because writing lod_glb_path undoes the kill switch. Nothing here noticed,
  // since a dry run only ever counted meshes -- it never said a word about which
  // settings those meshes were about to be baked with.
  //
  // The worker leaves its own answer behind: every bake records the values it used
  // on the job's report. Show the last one next to the local file.
  const localCfg = loadBakeConfig()
  const { rows: lastLod } = await db.query(
    `SELECT report -> 'plannerLod' ->> 'simplifyError' AS err,
            report -> 'plannerLod' ->> 'budget'        AS budget,
            updated_at                                 AS at
       FROM proxy_bake_jobs
      WHERE status = 'succeeded' AND report -> 'plannerLod' IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1`,
  )
  const localErr = localCfg.plannerLodSimplifyError
  const lastErr = lastLod[0]?.err != null ? Number(lastLod[0].err) : null
  console.log(
    `Planner LOD settings in THIS checkout: error ${localErr}, budget ${localCfg.plannerLodTriangleBudget}`,
  )
  if (lastErr === null) {
    console.log(
      '  No completed bake has recorded its LOD settings yet, so there is nothing to\n' +
        '  compare against and this check cannot tell you what the worker will use.\n' +
        '  Confirm your deploy has landed before continuing.\n',
    )
  } else if (lastErr !== localErr) {
    console.log(
      `  The last completed bake used error ${lastErr}, at ${new Date(lastLod[0].at).toISOString()}.\n` +
        '  THAT DIFFERS FROM THIS CHECKOUT. Fine if you have just changed the config AND\n' +
        '  the worker service has finished redeploying -- the worker is simply ahead of\n' +
        '  that record. NOT fine if you have not pushed and waited for that redeploy, in\n' +
        `  which case this run bakes at ${lastErr} again and silently undoes the rollback.\n`,
    )
  } else {
    console.log(`  The last completed bake used the same error. The worker is in sync.\n`)
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
        AND ($1::uuid IS NULL OR m.id = $1::uuid)
      ORDER BY m.sale_count DESC NULLS LAST, m.created_at DESC`,
    [MODEL ?? null],
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
        AND ($1::uuid IS NULL OR p.model_id = $1::uuid)
      ORDER BY m.sale_count DESC NULLS LAST, m.created_at DESC`,
    [MODEL ?? null],
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

  if (MODEL) console.log(`Restricted to model ${MODEL} (--model)`)
  console.log(`Meshes found:   ${all.length} (${models.length} models, ${parts.length} set parts)`)
  if (MODEL && all.length === 0) {
    console.log('Nothing matched that model id — check it against GET /api/models/sets.')
  }
  console.log(`  already done: ${alreadyDone}${FORCE ? ' (ignored — --force)' : ''}`)
  console.log(`  bake in queue:${skippedOpen}`)
  console.log(`  no source key:${skippedNoSource}`)
  console.log(`To enqueue:     ${Math.min(todo.length, LIMIT)}`)
  if (todo.length > 0) {
    // Divide by the workers actually checked in, not by one. The queue is drained
    // by every live replica in parallel, so quoting a single-worker figure on a
    // five-worker cluster overstates the wait five-fold — which is exactly the sort
    // of number that talks someone into batching a job that would have been over in
    // a few minutes.
    const mins = (Math.min(todo.length, LIMIT) * 40) / 60 / Math.max(1, liveWorkers)
    console.log(
      `\nRough drain time at ~40s/bake across ${liveWorkers} live worker(s): ` +
        `${mins < 1 ? '<1' : mins.toFixed(0)} minute(s). ` +
        `Artist uploads queue BEHIND these, so on a long run use --limit and batch it.`,
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
    `  railway run npm run db:query -- "SELECT status, count(*) FROM proxy_bake_jobs GROUP BY status"`,
  )
  console.log(
    `  railway run npm run db:query -- "SELECT count(*) FILTER (WHERE lod_glb_path IS NOT NULL) AS with_lod, count(*) FROM models WHERE processing_status = 'ready'"`,
  )
  // The one check that would have caught the bad re-bake: not "did it run" but
  // "what did it run with". Read it back off the worker's own report.
  console.log(`\nThen confirm WHICH SETTINGS the worker actually used:`)
  console.log(
    `  railway run npm run db:query -- "SELECT report->'plannerLod' FROM proxy_bake_jobs WHERE status='succeeded' ORDER BY updated_at DESC LIMIT 1"`,
  )
  console.log(
    `  Expect simplifyError ${localErr}. Anything else means the worker had not redeployed,\n` +
      `  the result is not what you tested, and the kill switch has just been undone:\n` +
      `    railway run npm run db:query -- "UPDATE models SET lod_glb_path = NULL"\n` +
      `    railway run npm run db:query -- "UPDATE model_parts SET lod_glb_path = NULL"`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDatabase().catch(() => {}))
