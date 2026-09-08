// backend/src/services/downloadSize.ts
// How many bytes a buyer's download will actually transfer, for display only
// ("Download ZIP (4 parts) · 182 MB"). Lifted out of routes/models.ts on
// 2026-09-08 so the buyer's "My downloads" page (GET /orders/library) can show
// the same figure the product page does — it was the only place still missing
// it after the My Models / My Downloads merge.

import { db } from '../db'
import { isR2Enabled, objectSize } from './r2'

/** Matches ZIP_FETCH_CONCURRENCY in routes/models.ts — HEADs are cheap, so 6 at a time. */
const SIZE_FETCH_CONCURRENCY = 6

/** How many models a library sizing pass works on at once (each up to SIZE_FETCH_CONCURRENCY HEADs). */
const MODEL_SIZE_CONCURRENCY = 4

// Computing a model's total download size means one R2 HEAD request per
// deliverable file — cheap alone, but wasteful to redo on every product-page
// view of a large multi-part set. Sizes only change when a file version is
// replaced, which is rare, so an in-memory TTL cache avoids re-HEADing on
// every view. Not shared across replicas/restarts and not invalidated on
// re-upload — worst case is a stale size for up to the TTL, which is fine for
// a display-only estimate that nothing else depends on.
const DOWNLOAD_SIZE_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const downloadSizeCache = new Map<string, { bytes: number | null; expires: number }>()

/** The path columns the size sum reads — the model row and each part row share them. */
type SizedRow = {
  stl_file_path?: string | null
  source_format?: string | null
  source_file_path?: string | null
}

type SizedPart = SizedRow & { processing_status?: string | null }

/**
 * Total bytes a buyer's download will actually transfer: the STL (+ original
 * file for an OBJ/3MF upload), or all of that summed across every part for a
 * multi-part "set" (mirrors streamWatermarkedZip's own deliverable list,
 * including its exclusion of failed parts). The watermark header rewrite is a
 * fixed 80-byte swap, so it doesn't change a file's length. Returns null if R2
 * isn't configured, or if any object's size couldn't be read (rather than
 * caching/returning a falsely-small total).
 */
export async function getEstimatedDownloadBytes(
  modelId: string,
  model: SizedRow,
  parts: SizedPart[],
): Promise<number | null> {
  if (!isR2Enabled()) return null
  const cached = downloadSizeCache.get(modelId)
  if (cached && cached.expires > Date.now()) return cached.bytes

  const keys: string[] = []
  const addKeys = (m: SizedRow) => {
    if (m.stl_file_path) keys.push(m.stl_file_path)
    if (m.source_format && m.source_format !== 'stl' && m.source_file_path) keys.push(m.source_file_path)
  }
  addKeys(model)
  for (const p of parts) {
    if (p.processing_status === 'failed') continue
    addKeys(p)
  }

  let total = 0
  let anyMissing = false
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = nextIndex++
      if (i >= keys.length) return
      const size = await objectSize(keys[i])
      if (size == null) { anyMissing = true; continue }
      total += size
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SIZE_FETCH_CONCURRENCY, keys.length) }, () => worker()),
  )

  if (anyMissing) return null
  downloadSizeCache.set(modelId, { bytes: total, expires: Date.now() + DOWNLOAD_SIZE_CACHE_TTL_MS })
  return total
}

/**
 * Sizes for a whole list of model rows at once (the buyer's library). Fetches
 * every multi-part model's parts in ONE query rather than per model, then reuses
 * the same per-model cache as the product page — so a library of already-viewed
 * models costs no R2 calls at all. A model whose size can't be read is simply
 * absent from the map; callers render the button without a size, as before.
 */
export async function getDownloadBytesForModels(
  models: Array<SizedRow & { id: string; part_count?: number | null }>,
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  if (!isR2Enabled() || models.length === 0) return sizes

  const multiPartIds = models.filter((m) => (m.part_count ?? 1) > 1).map((m) => m.id)
  const partsByModel = new Map<string, SizedPart[]>()
  if (multiPartIds.length > 0) {
    const rows = (await db.query(
      `SELECT model_id, stl_file_path, source_format, source_file_path, processing_status
       FROM model_parts WHERE model_id = ANY($1::uuid[])`,
      [multiPartIds],
    )).rows
    for (const row of rows) {
      const list = partsByModel.get(row.model_id) ?? []
      list.push(row)
      partsByModel.set(row.model_id, list)
    }
  }

  // A few models at a time rather than all at once: each one may itself fan out
  // to SIZE_FETCH_CONCURRENCY HEADs, and a big library of multi-part sets would
  // otherwise open hundreds of R2 connections on a single page load.
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const model = models[nextIndex++]
      if (!model) return
      const bytes = await getEstimatedDownloadBytes(model.id, model, partsByModel.get(model.id) ?? [])
      if (bytes != null) sizes.set(model.id, bytes)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MODEL_SIZE_CONCURRENCY, models.length) }, () => worker()),
  )
  return sizes
}
