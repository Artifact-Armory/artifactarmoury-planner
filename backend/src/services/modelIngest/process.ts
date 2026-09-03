// backend/src/services/modelIngest/process.ts
//
// The actual heavy work of ingesting an uploaded model: download the raw file
// from R2, dedup it (file hash + geometry fingerprint), parse the STL for
// dims/mesh-QA, and (pure-Node fallback) decimate a preview GLB. This is the
// exact code that used to live in routes/models.ts and run in-process in the
// API server ("background" only in that it wasn't awaited by the HTTP
// response) — moved here, unchanged, so it can also be run from the worker
// process via services/modelIngest/queue.ts + runner.ts. See migration 057
// and fileProcessor.ts's MAX_INGEST_TRIANGLES comment for why this needed to
// move off the web dyno.
//
// `processUploadedModel` / `processModelVersionUpdate` / `processModelParts`
// are the entire success/failure contract: they never throw (every error path
// ends in markModelFailed/failVersionUpdate + an artist notification), so a
// caller — whether the old in-process fire-and-forget or the new queue runner
// — never needs its own failure handling for a "normal" failure. The only way
// an ingest job doesn't complete is the process itself crashing (e.g. OOM)
// mid-call, which the queue's stale-lock reclaim handles.

import { db } from '../../db';
import logger from '../../utils/logger';
import { generateGLB, computeFileHash } from '../fileProcessor';
import { enqueueFullGlbJob } from '../fullGlb/queue';
import { downloadObject, deleteObject } from '../r2';
import {
  isLikelyDuplicate,
  fingerprintDistance,
  MATCH_THRESHOLD,
  type GeometryFingerprint,
} from '../fingerprint';
import { isolatedFingerprint, isolatedStlAnalysis, isIsolatedFailure } from './isolatedRunner';
import { meshFormatFromName, convertToStl, type MeshFormat } from '../meshConvert';
import { isBakeWorkerEnabled, enqueueBakeJob } from '../proxyBake/queue';
import { createNotification, notifyOwnersOfModelUpdate } from '../notifications';
import { estimatePrintCost } from '../printEstimator';
import { uploadToStorage } from '../storage';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Wording for a "this file is already on the site" rejection.
 *
 * Only ever called for a clash with ANOTHER artist — the uploader's own models are
 * exempt from dedup (migration 039), so there is no "you already uploaded this"
 * rejection to word. The clashing listing is deliberately NOT named: dedup scans
 * every artist's catalogue, so naming it would hand a stranger the name of someone
 * else's model, and it reads as gibberish to whoever is uploading.
 */
function duplicateMessage(kind: 'file' | 'geometry', partLabel?: string): string {
  const subject = partLabel ? `The file "${partLabel}"` : 'This file';
  return kind === 'file'
    ? `${subject} is already on the marketplace under another artist's listing. If you believe this is your own work, contact support.`
    : `${subject} is nearly identical to a model already on the marketplace (same shape, even if re-exported or rescaled). If you believe this is your own work, contact support.`;
}

export async function processUploadedModel(
  modelId: string,
  rawKey: string,
  filename?: string,
  displayRawKey?: string,
  displayFilename?: string,
): Promise<void> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-model-'));
  const format: MeshFormat = meshFormatFromName(filename || rawKey) ?? 'stl';
  const stlTmp = path.join(tmpDir, 'model.stl');

  try {
    // 1. Pull the raw upload from R2 and convert it to our canonical STL (a no-op
    //    for STL uploads). OBJ/3MF are parsed to triangles and re-emitted as STL,
    //    which is what the fingerprint, preview-GLB and watermark all operate on.
    const rawBuffer = await downloadObject(rawKey);
    const stlBuffer = convertToStl(rawBuffer, format);
    await fsp.writeFile(stlTmp, stlBuffer);

    // 2. Reject exact-duplicate uploads (by canonical-STL hash) — but only against
    //    ANOTHER artist. The uploader's own models are exempt: selling a piece
    //    individually *and* inside a set means uploading the same file twice,
    //    which is legitimate (migration 039).
    const uploaderId: string | null =
      (await db.query('SELECT artist_id FROM models WHERE id = $1', [modelId])).rows[0]?.artist_id ?? null;
    // Matches against the artist's OWN catalogue — allowed, but collected so they
    // can be told once at the end (an accidental double upload looks identical).
    const selfMatches: string[] = [];

    const fileHash = computeFileHash(stlBuffer);
    const dup = await db.query(
      'SELECT id, name, artist_id FROM models WHERE file_hash = $1 AND id <> $2',
      [fileHash, modelId],
    );
    const foreignHashDup = dup.rows.find((r: any) => r.artist_id !== uploaderId);
    if (foreignHashDup) {
      await markModelFailed(modelId, duplicateMessage('file'));
      await safeDeleteObject(rawKey);
      return;
    }
    if (dup.rows.length > 0) selfMatches.push(dup.rows[0].name);

    // 3. Geometry fingerprint — catches re-uploads even if the file was
    //    re-exported/rotated/rescaled/converted to dodge the exact-hash check above.
    //    Runs in an isolated child process — see isolatedRunner.ts — because
    //    a large enough file can OOM-crash the parser outright.
    const fpResult = await isolatedFingerprint(stlTmp);
    if (isIsolatedFailure(fpResult)) {
      await markModelFailed(modelId, fpResult.reason);
      await safeDeleteObject(rawKey);
      return;
    }
    const fingerprint = fpResult.fingerprint;
    const geoDup = await findGeometryDuplicate(fingerprint, modelId, uploaderId);
    if (geoDup.foreign) {
      await markModelFailed(modelId, duplicateMessage('geometry'));
      await safeDeleteObject(rawKey);
      return;
    }
    if (geoDup.own && !selfMatches.includes(geoDup.own.name)) selfMatches.push(geoDup.own.name);

    // 3b. Optional "clean preview" companion file (pre-supported models, migration
    //     053). When the artist attached one, IT — not the print file above —
    //     becomes the source for the preview/owner GLBs; the print file (with its
    //     supports) stays exactly what buyers download. It goes through the same
    //     dedup as the print file (still someone's geometry, still worth
    //     protecting), scanned against every model + part, foreign match rejects
    //     the whole upload. Always treated as STL going forward (no OBJ-material
    //     passthrough to the bake worker) — simpler, and this file only ever
    //     drives a render, not a sale.
    // Defaults for "no display file" — finalized once canonicalStlPath is known
    // below; overwritten outright when a display file is present.
    let previewSourceKey: string = rawKey;
    let previewSourceFormat: 'stl' | 'obj' = format === 'obj' ? 'obj' : 'stl';
    let previewSourceLocalPath = stlTmp;
    let displayStlPathForDb: string | null = null;
    if (displayRawKey) {
      const displayFormat: MeshFormat = meshFormatFromName(displayFilename || displayRawKey) ?? 'stl';
      const displayStlTmp = path.join(tmpDir, 'display.stl');
      const displayRawBuffer = await downloadObject(displayRawKey);
      const displayStlBuffer = convertToStl(displayRawBuffer, displayFormat);
      await fsp.writeFile(displayStlTmp, displayStlBuffer);

      const displayFileHash = computeFileHash(displayStlBuffer);
      const displayHashDup = await db.query(
        'SELECT id, name, artist_id FROM models WHERE file_hash = $1 AND id <> $2',
        [displayFileHash, modelId],
      );
      const foreignDisplayHashDup = displayHashDup.rows.find((r: any) => r.artist_id !== uploaderId);
      if (foreignDisplayHashDup) {
        await markModelFailed(modelId, duplicateMessage('file', 'preview model'));
        await safeDeleteObject(rawKey);
        await safeDeleteObject(displayRawKey);
        return;
      }

      const displayFpResult = await isolatedFingerprint(displayStlTmp);
      if (isIsolatedFailure(displayFpResult)) {
        await markModelFailed(modelId, displayFpResult.reason);
        await safeDeleteObject(rawKey);
        await safeDeleteObject(displayRawKey);
        return;
      }
      const displayFingerprint = displayFpResult.fingerprint;
      const displayGeoDup = await findGeometryDuplicate(displayFingerprint, modelId, uploaderId);
      if (displayGeoDup.foreign) {
        await markModelFailed(modelId, duplicateMessage('geometry', 'preview model'));
        await safeDeleteObject(rawKey);
        await safeDeleteObject(displayRawKey);
        return;
      }
      const displaySelfName = displayHashDup.rows[0]?.name ?? displayGeoDup.own?.name;
      if (displaySelfName && !selfMatches.includes(displaySelfName)) selfMatches.push(displaySelfName);

      // STL uploads keep the raw/ object in place (same convention as the print
      // file); OBJ/3MF get canonicalized into a stored STL.
      displayStlPathForDb = displayRawKey;
      if (displayFormat !== 'stl') {
        const displayCanonTmp = path.join(tmpDir, 'display-canonical.stl');
        await fsp.writeFile(displayCanonTmp, displayStlBuffer);
        displayStlPathForDb = await uploadToStorage(displayCanonTmp, 'models');
      }

      previewSourceLocalPath = displayStlTmp;
      previewSourceKey = displayStlPathForDb;
      previewSourceFormat = 'stl';
    }

    // 4. Analyse geometry + generate the GLB preview. Dimensions/print-estimate/
    //    mesh QA always read the PRINT file (stlTmp) — those describe what a buyer
    //    actually prints. Only the preview GLB's source swaps to the clean display
    //    file when one was provided. Preview generation has two modes: when the
    //    bake worker is enabled the GLB is produced out-of-process (normal/AO-baked
    //    proxy) and glb_file_path is filled in later by the worker; otherwise we
    //    fall back to the in-process pure-Node decimator exactly as before.
    // Dims/volume + mesh QA together, in one isolated child process (same
    // reasoning as the fingerprint above — parseSTL is the actual OOM site).
    const analysis = await isolatedStlAnalysis(stlTmp, { includeMeshQA: true });
    if (isIsolatedFailure(analysis)) {
      await markModelFailed(modelId, analysis.reason);
      await safeDeleteObject(rawKey);
      return;
    }
    const stlData = analysis.stlData;
    // Advisory mesh QA (watertight/manifold). Never blocks the upload.
    const meshQA = analysis.meshQA!;
    const bakeEnabled = isBakeWorkerEnabled();
    let glbStoragePath: string | null = null;
    if (!bakeEnabled) {
      const glbPath = await generateGLB(previewSourceLocalPath);
      glbStoragePath = await uploadToStorage(glbPath, 'previews');
    }

    // For a non-STL upload, store the converted canonical STL in R2 (it becomes
    // stl_file_path) and keep the artist's original as source_file_path, so the
    // buyer receives both. STL uploads keep rawKey as their stl_file_path.
    let canonicalStlPath: string | null = null;
    let sourceFilePath: string | null = null;
    if (format !== 'stl') {
      const canonTmp = path.join(tmpDir, 'canonical.stl');
      await fsp.writeFile(canonTmp, stlBuffer);
      canonicalStlPath = await uploadToStorage(canonTmp, 'models');
      sourceFilePath = rawKey;
    }
    // No display file → the preview/owner GLBs are sourced from the print file
    // itself, same as before this feature existed (prefer the original OBJ for
    // the bake worker's material atlas, else the canonical/raw STL).
    if (!displayRawKey) {
      previewSourceKey = format === 'obj' ? rawKey : (canonicalStlPath ?? rawKey);
      previewSourceFormat = format === 'obj' ? 'obj' : 'stl';
    }

    const printEstimate = estimatePrintCost({
      volume_mm3: stlData.volume,
      surface_area_mm2: stlData.surfaceArea,
      estimated_weight_g: undefined,
      estimated_print_time_minutes: undefined,
      triangle_count: undefined,
    });

    // Multi-part models have extra parts still to process — stay 'processing'
    // until they're all done so the poller never briefly sees a premature 'ready'.
    const hasParts = (await db.query(
      'SELECT 1 FROM model_parts WHERE model_id = $1 LIMIT 1', [modelId]
    )).rows.length > 0;

    // 4. Fill in the derived fields (still 'draft' for moderation).
    await db.query(
      `UPDATE models SET
         glb_file_path = COALESCE($1, glb_file_path),
         width = $2, depth = $3, height = $4,
         estimated_print_time = $5, estimated_material_cost = $6, supports_required = $7,
         recommended_layer_height = 0.2, recommended_infill = 20,
         file_hash = $8,
         geometry_fingerprint = $9,
         source_format = $10,
         source_file_path = $11,
         stl_file_path = COALESCE($12, stl_file_path),
         mesh_analyzed = $13,
         mesh_is_watertight = $14,
         mesh_is_manifold = $15,
         mesh_triangle_count = $16,
         mesh_open_edges = $17,
         mesh_report = $18,
         mesh_warning_acknowledged = false, mesh_warning_acknowledged_at = NULL, mesh_warning_acknowledged_by = NULL,
         display_stl_path = $21,
         processing_status = $19, processing_error = NULL,
         updated_at = NOW()
       WHERE id = $20`,
      [
        glbStoragePath,
        stlData.dimensions.x, stlData.dimensions.y, stlData.dimensions.z,
        Math.round(printEstimate.estimated_time_hours * 60),
        Number(printEstimate.total_cost.toFixed(2)),
        stlData.needsSupports,
        fileHash,
        JSON.stringify(fingerprint),
        format,
        sourceFilePath,
        canonicalStlPath,
        meshQA.analyzed,
        meshQA.watertight,
        meshQA.manifold,
        meshQA.triangleCount || null,
        meshQA.openEdges,
        JSON.stringify(meshQA),
        // The bake worker keeps the model 'processing' until every bake finishes;
        // the pure-Node path is ready now (unless it still has parts to convert).
        bakeEnabled || hasParts ? 'processing' : 'ready',
        modelId,
        displayStlPathForDb,
      ]
    );

    // 5. Extra STL parts (multi-part "set"). processModelParts either converts them
    //    inline (pure-Node) or enqueues a bake per part; only the inline path can
    //    mark the model ready here — the bake path is rolled up by the worker.
    if (hasParts) {
      await processModelParts(modelId, uploaderId, selfMatches);
      if (!bakeEnabled) {
        await db.query(
          `UPDATE models SET processing_status = 'ready', processing_error = NULL, updated_at = NOW()
           WHERE id = $1 AND processing_status = 'processing'`,
          [modelId]
        );
      }
    }

    // 6. Preview bake (worker mode): enqueue the primary mesh. Sourced from the
    //    clean display file when one was provided, else the print file (preferring
    //    the original OBJ so its materials survive for the baseColor atlas).
    if (bakeEnabled) {
      await enqueueBakeJob({ modelId, partId: null, sourceKey: previewSourceKey, sourceFormat: previewSourceFormat });
    }

    // 6b. Owner full-fidelity GLB (migration 041) — a SEPARATE queue. Same source
    //     as the preview bake above: the display file when present, else the
    //     canonical STL. Enqueued after the model has already been marked 'ready'
    //     above, and it never feeds back into processing_status, so it adds
    //     exactly nothing to how long the artist waits on this upload.
    await enqueueFullGlbJob({ modelId, partId: null, sourceKey: previewSourceKey });

    // Allowed self-duplicates: tell the artist once, neutrally. Listing a piece on
    // its own AND in a set is exactly what this permits, but an accidental double
    // upload now looks identical from here — this is the only signal they'd get.
    if (selfMatches.length > 0 && uploaderId) {
      const names = selfMatches.slice(0, 3).map((n) => `"${n}"`).join(', ');
      const more = selfMatches.length > 3 ? ` and ${selfMatches.length - 3} more` : '';
      await createNotification({
        userId: uploaderId,
        type: 'model.duplicate_allowed',
        title: 'Uploaded — you already list this file',
        body: `This upload reuses a file you already sell as ${names}${more}. That's allowed (a piece can be sold on its own and inside a set) — no action needed unless you uploaded it by mistake.`,
        link: '/artist/models',
        modelId,
      });
    }

    logger.info('Model processed successfully', { modelId, hasParts, bakeEnabled, selfMatches: selfMatches.length });
  } catch (error) {
    logger.error('Model processing failed', { error, modelId });
    await markModelFailed(modelId, (error as Error)?.message?.slice(0, 500) || 'Processing failed');
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Replace an existing model's PRIMARY file with a new version. Re-runs the same
 * dedup / fingerprint / preview / mesh-QA pipeline on the replacement, then bumps
 * file_version, records the changelog in model_versions and notifies every owner
 * (they re-download the new version for free). Only the primary file is versioned
 * here; multi-part extras are left untouched. On any failure the model keeps its
 * previous file (the derived columns are only written on success) and is returned
 * to 'ready'.
 */
export async function processModelVersionUpdate(
  modelId: string,
  rawKey: string,
  filename: string | undefined,
  notes: string | null,
): Promise<void> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-ver-'));
  const format: MeshFormat = meshFormatFromName(filename || rawKey) ?? 'stl';
  const stlTmp = path.join(tmpDir, 'model.stl');

  try {
    const rawBuffer = await downloadObject(rawKey);
    const stlBuffer = convertToStl(rawBuffer, format);
    await fsp.writeFile(stlTmp, stlBuffer);

    // Exact-hash dedup against OTHER models (a version identical to someone else's
    // model is still theft). Self is excluded, so re-uploading a tweak is fine.
    // As above: only a clash with ANOTHER artist blocks. Replacing a model's file
    // with one the artist already uses elsewhere is their business.
    const ownerId: string | null =
      (await db.query('SELECT artist_id FROM models WHERE id = $1', [modelId])).rows[0]?.artist_id ?? null;

    const fileHash = computeFileHash(stlBuffer);
    const dup = await db.query(
      'SELECT id, name FROM models WHERE file_hash = $1 AND id <> $2 AND artist_id <> $3',
      [fileHash, modelId, ownerId],
    );
    if (dup.rows.length > 0) {
      await failVersionUpdate(modelId, 'That file matches a model already on the marketplace — not applied');
      await safeDeleteObject(rawKey);
      return;
    }

    const fpResult = await isolatedFingerprint(stlTmp);
    if (isIsolatedFailure(fpResult)) {
      await failVersionUpdate(modelId, fpResult.reason);
      await safeDeleteObject(rawKey);
      return;
    }
    const fingerprint = fpResult.fingerprint;
    const geoDup = await findGeometryDuplicate(fingerprint, modelId, ownerId);
    if (geoDup.foreign) {
      await failVersionUpdate(modelId, 'That file looks like a copy of a model already on the marketplace — not applied');
      await safeDeleteObject(rawKey);
      return;
    }

    const analysis = await isolatedStlAnalysis(stlTmp, { includeMeshQA: true });
    if (isIsolatedFailure(analysis)) {
      await failVersionUpdate(modelId, analysis.reason);
      await safeDeleteObject(rawKey);
      return;
    }
    const stlData = analysis.stlData;
    const meshQA = analysis.meshQA!;
    const bakeEnabled = isBakeWorkerEnabled();
    // Preview GLB: baked out-of-process by the worker, or the pure-Node fallback.
    // When baking we keep the OLD preview via COALESCE until the new bake lands.
    let glbStoragePath: string | null = null;
    if (!bakeEnabled) {
      const glbPath = await generateGLB(stlTmp);
      glbStoragePath = await uploadToStorage(glbPath, 'previews');
    }

    // Where the buyer-facing STL lives: the raw key for STL uploads, or a stored
    // canonical STL for OBJ/3MF (with the original kept as the source file).
    let newStlPath = rawKey;
    let sourceFilePath: string | null = null;
    if (format !== 'stl') {
      const canonTmp = path.join(tmpDir, 'canonical.stl');
      await fsp.writeFile(canonTmp, stlBuffer);
      newStlPath = await uploadToStorage(canonTmp, 'models');
      sourceFilePath = rawKey;
    }

    const printEstimate = estimatePrintCost({
      volume_mm3: stlData.volume,
      surface_area_mm2: stlData.surfaceArea,
      estimated_weight_g: undefined,
      estimated_print_time_minutes: undefined,
      triangle_count: undefined,
    });

    // Bump the version and write all derived fields atomically.
    const updated = await db.query(
      `UPDATE models SET
         glb_file_path = COALESCE($1, glb_file_path),
         width = $2, depth = $3, height = $4,
         estimated_print_time = $5, estimated_material_cost = $6, supports_required = $7,
         file_hash = $8,
         geometry_fingerprint = $9,
         source_format = $10,
         source_file_path = $11,
         stl_file_path = $12,
         mesh_analyzed = $13, mesh_is_watertight = $14, mesh_is_manifold = $15,
         mesh_triangle_count = $16, mesh_open_edges = $17, mesh_report = $18,
         mesh_warning_acknowledged = false, mesh_warning_acknowledged_at = NULL, mesh_warning_acknowledged_by = NULL,
         file_version = file_version + 1,
         version_notes = $19,
         files_updated_at = NOW(),
         processing_status = $21, processing_error = NULL,
         updated_at = NOW()
       WHERE id = $20
       RETURNING file_version`,
      [
        glbStoragePath,
        stlData.dimensions.x, stlData.dimensions.y, stlData.dimensions.z,
        Math.round(printEstimate.estimated_time_hours * 60),
        Number(printEstimate.total_cost.toFixed(2)),
        stlData.needsSupports,
        fileHash,
        JSON.stringify(fingerprint),
        format,
        sourceFilePath,
        newStlPath,
        meshQA.analyzed, meshQA.watertight, meshQA.manifold,
        meshQA.triangleCount || null, meshQA.openEdges, JSON.stringify(meshQA),
        notes,
        modelId,
        // Baking keeps the model 'processing' until the new proxy is ready; the
        // pure-Node path already wrote the new preview so it's ready immediately.
        bakeEnabled ? 'processing' : 'ready',
      ]
    );

    const newVersion: number = updated.rows[0]?.file_version ?? 2;

    // Re-bake the preview for the new primary mesh (worker flips it back to ready).
    if (bakeEnabled) {
      const bakeSourceKey = format === 'obj' ? rawKey : newStlPath;
      const bakeSourceFormat = format === 'obj' ? 'obj' : 'stl';
      await enqueueBakeJob({ modelId, partId: null, sourceKey: bakeSourceKey, sourceFormat: bakeSourceFormat });
    }

    // Rebuild the owner GLB against the NEW file. Owners re-download a new version
    // free, so what they see in the planner has to follow the file too. The old
    // full GLB keeps serving until the rebuild lands, then completeFullGlbJob
    // deletes it — a buyer never gets a broken model mid-rebuild.
    await enqueueFullGlbJob({ modelId, partId: null, sourceKey: newStlPath });

    // Record the changelog entry, then notify owners they can re-download free.
    await db.query(
      `INSERT INTO model_versions (model_id, version, notes) VALUES ($1, $2, $3)
       ON CONFLICT (model_id, version) DO NOTHING`,
      [modelId, newVersion, notes]
    );
    await notifyOwnersOfModelUpdate(modelId, newVersion, notes);

    logger.info('Model version updated', { modelId, newVersion, bakeEnabled });
  } catch (error) {
    logger.error('Model version update failed', { error, modelId });
    await failVersionUpdate(modelId, (error as Error)?.message?.slice(0, 300) || 'Version update failed');
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A version update failed — the previous file is still intact, so just return the
 * model to 'ready' and surface the reason (advisory; doesn't fail the model).
 */
async function failVersionUpdate(modelId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE models SET processing_status = 'ready', processing_error = $1, updated_at = NOW() WHERE id = $2`,
    [reason, modelId]
  ).catch((err) => logger.error('failVersionUpdate update failed', { error: err, modelId }));
}

/**
 * Process every extra STL part of a multi-part ("set") model: dedup, per-part GLB
 * preview, dimensions + fingerprint. Throws (after marking the model failed) if any
 * part can't be processed, so the caller leaves the model in 'failed'.
 */
async function processModelParts(
  modelId: string,
  uploaderId?: string | null,
  selfMatches?: string[],
): Promise<void> {
  const { rows: parts } = await db.query(
    `SELECT id, name, stl_file_path, is_presupported, display_stl_path FROM model_parts WHERE model_id = $1 ORDER BY display_order ASC`,
    [modelId]
  );

  for (const part of parts) {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-part-'));
    const stlTmp = path.join(tmpDir, 'part.stl');
    // A part's format is taken from its raw upload key's extension.
    const format: MeshFormat = meshFormatFromName(part.stl_file_path) ?? 'stl';
    try {
      const rawBuffer = await downloadObject(part.stl_file_path);
      const stlBuffer = convertToStl(rawBuffer, format);
      await fsp.writeFile(stlTmp, stlBuffer);

      // Dedup each part against every other model + part (not this model's own).
      // Isolated child process — see isolatedRunner.ts — because a single
      // oversized part (this is exactly what happened to a real 10-model
      // upload on 2026-09-03) can OOM-crash the whole worker mid-parse.
      const fileHash = computeFileHash(stlBuffer);
      const fpResult = await isolatedFingerprint(stlTmp);
      if (isIsolatedFailure(fpResult)) {
        await db.query(`UPDATE model_parts SET processing_status='failed', processing_error=$1 WHERE id=$2`, [fpResult.reason, part.id]);
        await markModelFailed(modelId, `${part.name}: ${fpResult.reason}`);
        await safeDeleteObject(part.stl_file_path);
        throw new Error(fpResult.reason);
      }
      const fingerprint = fpResult.fingerprint;
      const geoDup = await findGeometryDuplicate(fingerprint, modelId, uploaderId);
      if (geoDup.foreign) {
        const reason = duplicateMessage('geometry', part.name);
        await db.query(`UPDATE model_parts SET processing_status='failed', processing_error=$1 WHERE id=$2`, [reason, part.id]);
        await markModelFailed(modelId, reason);
        await safeDeleteObject(part.stl_file_path);
        throw new Error(reason);
      }
      // The artist's own model — allowed (that's the point of selling a piece both
      // ways); recorded so the roll-up notice can mention it.
      if (geoDup.own && selfMatches && !selfMatches.includes(geoDup.own.name)) {
        selfMatches.push(geoDup.own.name);
      }

      // Per-component "clean preview" (migration 054) — display_stl_path still
      // holds the RAW uploaded key at this point (see the from-upload INSERT).
      // Mirrors processUploadedModel's handling of the whole-listing case:
      // dims/dedup/mesh-QA read the print file above; only the preview/owner
      // GLB source swaps to this file when present.
      let previewSourceKey: string;
      let previewSourceFormat: 'stl' | 'obj' = format === 'obj' ? 'obj' : 'stl';
      let previewSourceLocalPath = stlTmp;
      let displayStlPathForDb: string | null = null;
      if (part.is_presupported && part.display_stl_path) {
        const displayRawKey: string = part.display_stl_path;
        const displayFormat: MeshFormat = meshFormatFromName(displayRawKey) ?? 'stl';
        const displayStlTmp = path.join(tmpDir, 'display.stl');
        const displayRawBuffer = await downloadObject(displayRawKey);
        const displayStlBuffer = convertToStl(displayRawBuffer, displayFormat);
        await fsp.writeFile(displayStlTmp, displayStlBuffer);

        const displayFileHash = computeFileHash(displayStlBuffer);
        const displayHashDup = await db.query(
          'SELECT id, name, artist_id FROM models WHERE file_hash = $1 AND id <> $2',
          [displayFileHash, modelId],
        );
        const foreignDisplayHashDup = displayHashDup.rows.find((r: any) => r.artist_id !== uploaderId);
        const displayFpResult = await isolatedFingerprint(displayStlTmp);
        if (isIsolatedFailure(displayFpResult)) {
          await db.query(`UPDATE model_parts SET processing_status='failed', processing_error=$1 WHERE id=$2`, [displayFpResult.reason, part.id]);
          await markModelFailed(modelId, `${part.name} preview: ${displayFpResult.reason}`);
          await safeDeleteObject(part.stl_file_path);
          await safeDeleteObject(displayRawKey);
          throw new Error(displayFpResult.reason);
        }
        const displayFingerprint = displayFpResult.fingerprint;
        const displayGeoDup = foreignDisplayHashDup
          ? null
          : await findGeometryDuplicate(displayFingerprint, modelId, uploaderId);
        if (foreignDisplayHashDup || displayGeoDup?.foreign) {
          const reason = duplicateMessage(foreignDisplayHashDup ? 'file' : 'geometry', `${part.name} preview`);
          await db.query(`UPDATE model_parts SET processing_status='failed', processing_error=$1 WHERE id=$2`, [reason, part.id]);
          await markModelFailed(modelId, reason);
          await safeDeleteObject(part.stl_file_path);
          await safeDeleteObject(displayRawKey);
          throw new Error(reason);
        }
        const displaySelfName = displayHashDup.rows[0]?.name ?? displayGeoDup?.own?.name;
        if (displaySelfName && selfMatches && !selfMatches.includes(displaySelfName)) {
          selfMatches.push(displaySelfName);
        }

        displayStlPathForDb = displayRawKey;
        if (displayFormat !== 'stl') {
          const displayCanonTmp = path.join(tmpDir, 'display-canonical.stl');
          await fsp.writeFile(displayCanonTmp, displayStlBuffer);
          displayStlPathForDb = await uploadToStorage(displayCanonTmp, 'models');
        }

        previewSourceLocalPath = displayStlTmp;
        previewSourceFormat = 'stl';
      }

      const partAnalysis = await isolatedStlAnalysis(stlTmp, { includeMeshQA: false });
      if (isIsolatedFailure(partAnalysis)) {
        await db.query(`UPDATE model_parts SET processing_status='failed', processing_error=$1 WHERE id=$2`, [partAnalysis.reason, part.id]);
        await markModelFailed(modelId, `${part.name}: ${partAnalysis.reason}`);
        await safeDeleteObject(part.stl_file_path);
        throw new Error(partAnalysis.reason);
      }
      const stlData = partAnalysis.stlData;
      // Preview GLB: baked out-of-process (worker) or the pure-Node fallback.
      const bakeEnabled = isBakeWorkerEnabled();
      let glbStoragePath: string | null = null;
      if (!bakeEnabled) {
        const glbPath = await generateGLB(previewSourceLocalPath);
        glbStoragePath = await uploadToStorage(glbPath, 'previews');
      }

      // Non-STL part: store the converted STL and keep the original as the source.
      let canonicalStlPath: string | null = null;
      let sourceFilePath: string | null = null;
      if (format !== 'stl') {
        const canonTmp = path.join(tmpDir, 'canonical.stl');
        await fsp.writeFile(canonTmp, stlBuffer);
        canonicalStlPath = await uploadToStorage(canonTmp, 'models');
        sourceFilePath = part.stl_file_path;
      }
      // No display file → preview/owner GLBs source from the print file itself,
      // same as before this feature existed.
      if (!displayStlPathForDb) {
        previewSourceKey = format === 'obj' ? part.stl_file_path : (canonicalStlPath ?? part.stl_file_path);
      } else {
        previewSourceKey = displayStlPathForDb;
      }

      await db.query(
        `UPDATE model_parts SET
           glb_file_path = COALESCE($1, glb_file_path), width = $2, depth = $3, height = $4,
           file_hash = $5, geometry_fingerprint = $6,
           source_format = $7, source_file_path = $8,
           stl_file_path = COALESCE($9, stl_file_path),
           display_stl_path = $12,
           processing_status = $11, processing_error = NULL
         WHERE id = $10`,
        [glbStoragePath, stlData.dimensions.x, stlData.dimensions.y, stlData.dimensions.z, fileHash, JSON.stringify(fingerprint), format, sourceFilePath, canonicalStlPath, part.id, bakeEnabled ? 'processing' : 'ready', displayStlPathForDb]
      );

      // Worker mode: enqueue a bake for this part (sourced from the clean
      // preview file when present, else the original OBJ when we have one,
      // else the canonical STL). The worker fills in its glb + status.
      if (bakeEnabled) {
        await enqueueBakeJob({ modelId, partId: part.id, sourceKey: previewSourceKey, sourceFormat: previewSourceFormat });
      }

      // Owner full-fidelity GLB for this part. Each part of a set is placed
      // individually in the planner, so each needs its own full mesh — one
      // purchase, N owner GLBs. Off the critical path, same as the primary.
      await enqueueFullGlbJob({ modelId, partId: part.id, sourceKey: previewSourceKey });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Compare a fingerprint against every stored model's fingerprint and return the
 * first likely match (a re-upload), or null. O(N) — fine at this scale; swap for
 * a vector index if the catalogue grows large.
 */
interface GeometryMatch { id: string; name: string; artistId: string }

/**
 * Split the result of a fingerprint scan into the match that BLOCKS an upload and
 * the match that merely informs it.
 *
 * `foreign` is another artist's model — that's the theft case dedup exists for.
 * `own` is the uploader's own model, which is allowed: an artist can legitimately
 * sell a piece on its own and again inside a set (migration 039). Both are
 * reported, and `foreign` always wins, so a file that matches the uploader's model
 * AND someone else's is still rejected rather than waved through on the self-match.
 */
interface GeometryDuplicates { foreign: GeometryMatch | null; own: GeometryMatch | null }

export async function findGeometryDuplicate(
  fingerprint: GeometryFingerprint,
  excludeId: string,
  uploaderId?: string | null,
): Promise<GeometryDuplicates> {
  // Scan both whole models and individual set parts (excluding the model being
  // processed and its own parts), so a stolen file re-uploaded as a "part" is
  // still caught.
  const { rows: modelRows } = await db.query(
    `SELECT id, name, artist_id, geometry_fingerprint FROM models
     WHERE geometry_fingerprint IS NOT NULL AND id <> $1`,
    [excludeId]
  );
  const { rows: partRows } = await db.query(
    `SELECT mp.model_id AS id, COALESCE(m.name, mp.name) AS name, m.artist_id, mp.geometry_fingerprint
     FROM model_parts mp JOIN models m ON m.id = mp.model_id
     WHERE mp.geometry_fingerprint IS NOT NULL AND mp.model_id <> $1`,
    [excludeId]
  );
  const rows = [...modelRows, ...partRows];
  let foreign: GeometryMatch | null = null;
  let own: GeometryMatch | null = null;
  // Track the closest candidate so a false positive / near-miss is diagnosable
  // in the logs (compare against FINGERPRINT_MATCH_THRESHOLD).
  let best = { id: '', name: '', dist: Infinity };
  for (const row of rows) {
    const fp = row.geometry_fingerprint as GeometryFingerprint;
    const dist = fingerprintDistance(fingerprint, fp);
    if (dist < best.dist) best = { id: row.id, name: row.name, dist };
    if (isLikelyDuplicate(fingerprint, fp)) {
      const hit: GeometryMatch = { id: row.id, name: row.name, artistId: row.artist_id };
      if (uploaderId && row.artist_id === uploaderId) { own ??= hit; }
      else { foreign ??= hit; }
    }
  }
  logger.info('Geometry dedup check', {
    candidates: rows.length,
    closest: best.name || null,
    closestDistance: Number.isFinite(best.dist) ? Number(best.dist.toFixed(4)) : null,
    threshold: MATCH_THRESHOLD,
    matched: foreign?.name ?? null,
    ownMatch: own?.name ?? null,
  });
  return { foreign, own };
}

/**
 * Mark an upload as failed AND tell the artist why.
 *
 * Processing runs in the background after the artist has already left the upload
 * form, so a failure that only lands in `processing_error` is invisible: the
 * model just sits there without a preview. Every rejection path (duplicate file,
 * duplicate geometry, conversion error) funnels through here, so this is the one
 * place that guarantees the seller is told. Best-effort — a failed notification
 * must never mask the failure itself.
 */
async function markModelFailed(modelId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE models SET processing_status = 'failed', processing_error = $1, updated_at = NOW() WHERE id = $2`,
    [reason, modelId]
  ).catch((err) => logger.error('Failed to mark model as failed', { error: err, modelId }));

  try {
    const row = (await db.query('SELECT artist_id, name FROM models WHERE id = $1', [modelId])).rows[0];
    if (!row?.artist_id) return;
    await createNotification({
      userId: row.artist_id,
      type: 'model.upload_failed',
      title: `Upload failed: ${row.name || 'your model'}`,
      body: reason,
      link: '/artist/models',
      modelId,
    });
  } catch (err) {
    logger.error('Upload-failure notification failed', { error: err, modelId });
  }
}

export async function safeDeleteObject(key: string): Promise<void> {
  try { await deleteObject(key); } catch (err) { logger.warn('Failed to delete quarantined object', { error: err, key }); }
}
