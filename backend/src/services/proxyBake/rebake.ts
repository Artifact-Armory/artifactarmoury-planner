// Re-bake ONE model (and its set parts) on demand.
//
// This is the same work scripts/backfill-planner-lod.ts does for `--model <id>
// --force`, exposed so an admin can trigger it from inside the platform instead of
// from a laptop that has to reach the database through the public TCP proxy.
//
// The source-key selection lives here and is imported by the script, because
// getting it wrong is silent and expensive: a pre-supported listing must bake from
// its clean display file, and re-baking from the print file would bring the support
// struts back into the preview. Keep it in step with previewSourceKey in
// services/modelIngest/process.ts.

import { db } from '../../db'
import logger from '../../utils/logger'
import { NotFoundError, ValidationError } from '../../middleware/error'
import { WORKER_STALE_MS } from '../queueHealth'
import { enqueueBakeJob } from './queue'

// The bake's source is NOT simply stl_file_path. A pre-supported listing
// (migrations 053/054) previews from its clean display file, and an OBJ upload
// bakes from the original so its materials survive into the baseColor atlas.
export const SOURCE_KEY_SQL = (t: string) => `
  CASE
    WHEN ${t}.display_stl_path IS NOT NULL THEN ${t}.display_stl_path
    WHEN ${t}.source_format = 'obj' AND ${t}.source_file_path IS NOT NULL THEN ${t}.source_file_path
    ELSE ${t}.stl_file_path
  END`

export const SOURCE_FORMAT_SQL = (t: string) => `
  CASE
    WHEN ${t}.display_stl_path IS NULL AND ${t}.source_format = 'obj' THEN 'obj'
    ELSE 'stl'
  END`

export interface RebakeResult {
  modelId: string
  modelName: string
  /** Meshes for which a bake job was queued (the model itself, then each set part). */
  queued: Array<{ kind: 'model' | 'part'; label: string }>
  /** Skipped because a bake for that mesh is already queued or running. */
  skippedOpen: number
  /** Skipped because there is no source file to bake from. */
  skippedNoSource: number
  liveWorkers: number
}

interface Mesh {
  partId: string | null
  sourceKey: string | null
  sourceFormat: string
  label: string
  overrides: unknown
  openJob: boolean
}

export async function rebakeModel(modelId: string): Promise<RebakeResult> {
  const { rows: found } = await db.query(
    `SELECT id, name, processing_status, status FROM models WHERE id = $1`,
    [modelId],
  )
  const model = found[0]
  if (!model) throw new NotFoundError('Model')
  if (model.status === 'archived') throw new ValidationError('That model is archived.')
  if (model.processing_status !== 'ready') {
    throw new ValidationError(
      `That model is "${model.processing_status}", not ready - re-baking only applies to finished models. ` +
        'A stuck upload is fixed from the queue table above instead.',
    )
  }

  // Queued jobs with nobody to run them would just sit there and look like a
  // success. Same liveness rule the backfill script and /admin/queues use.
  const { rows: workerRows } = await db.query(
    `SELECT COUNT(*) FILTER (
              WHERE last_seen_at > NOW() - ($1::int * INTERVAL '1 millisecond')
            ) AS live
       FROM worker_heartbeats`,
    [WORKER_STALE_MS],
  )
  const liveWorkers = Number(workerRows[0]?.live ?? 0)
  if (liveWorkers === 0) {
    throw new ValidationError(
      'No bake worker has checked in recently, so a queued re-bake would never run. ' +
        'Check the worker services on Railway first.',
    )
  }

  const { rows: primary } = await db.query(
    `SELECT NULL::uuid AS part_id,
            ${SOURCE_KEY_SQL('m')} AS source_key,
            ${SOURCE_FORMAT_SQL('m')} AS source_format,
            m.name AS label,
            m.proxy_bake_config AS overrides,
            EXISTS (
              SELECT 1 FROM proxy_bake_jobs j
               WHERE j.model_id = m.id AND j.part_id IS NULL
                 AND j.status IN ('queued', 'running')
            ) AS open_job
       FROM models m
      WHERE m.id = $1`,
    [modelId],
  )
  const { rows: parts } = await db.query(
    `SELECT p.id AS part_id,
            ${SOURCE_KEY_SQL('p')} AS source_key,
            ${SOURCE_FORMAT_SQL('p')} AS source_format,
            COALESCE(m.name, '') || ' / ' || COALESCE(p.name, 'part') AS label,
            -- The PART's own override column, as the upload path uses.
            p.proxy_bake_config AS overrides,
            EXISTS (
              SELECT 1 FROM proxy_bake_jobs j
               WHERE j.part_id = p.id AND j.status IN ('queued', 'running')
            ) AS open_job
       FROM model_parts p
       JOIN models m ON m.id = p.model_id
      WHERE p.model_id = $1 AND p.processing_status = 'ready'
      ORDER BY p.display_order NULLS LAST, p.created_at`,
    [modelId],
  )

  const meshes: Mesh[] = [...primary, ...parts].map((r: any) => ({
    partId: r.part_id ?? null,
    sourceKey: r.source_key ?? null,
    sourceFormat: r.source_format,
    label: r.label,
    overrides: r.overrides,
    openJob: !!r.open_job,
  }))

  const result: RebakeResult = {
    modelId,
    modelName: model.name,
    queued: [],
    skippedOpen: 0,
    skippedNoSource: 0,
    liveWorkers,
  }
  for (const m of meshes) {
    if (!m.sourceKey) { result.skippedNoSource++; continue }
    if (m.openJob) { result.skippedOpen++; continue }
    await enqueueBakeJob({
      modelId,
      partId: m.partId,
      sourceKey: m.sourceKey,
      sourceFormat: m.sourceFormat,
      overrides: (m.overrides as any) ?? null,
    })
    result.queued.push({ kind: m.partId ? 'part' : 'model', label: m.label })
  }

  logger.info('Re-bake queued', {
    modelId,
    queued: result.queued.length,
    skippedOpen: result.skippedOpen,
    skippedNoSource: result.skippedNoSource,
  })
  return result
}
