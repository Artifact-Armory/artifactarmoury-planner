// backend/src/routes/models.ts
// Artist model management: upload, update, delete models

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import {
  authenticate,
  requireArtist,
  requireVerifiedEmail,
  requireTwoFactor,
  requireModelOwnership,
  optionalAuth
} from '../middleware/auth';
import { 
  uploadModelWithThumbnail, 
  uploadImages,
  handleUploadError,
  cleanupOnError,
  deleteUploadedFile,
  getRelativePath
} from '../middleware/upload';
import { uploadRateLimit, previewRateLimit } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { ValidationError, NotFoundError, AuthorizationError } from '../middleware/error';
import { processSTL, generateGLB, computeFileHash } from '../services/fileProcessor';
import { enqueueFullGlbJob } from '../services/fullGlb/queue';
import crypto from 'crypto';
import { readFile as fsReadFile } from 'fs/promises';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { estimatePrintCost } from '../services/printEstimator';
import { getPrintProvider, buildPrintPrice } from '../services/printProvider';
import { uploadToStorage, deleteFromStorage } from '../services/storage';
import { isR2Enabled, objectSize, downloadObject, deleteObject, getObjectStream } from '../services/r2';
import { computeGeometryFingerprint, isLikelyDuplicate, fingerprintDistance, MATCH_THRESHOLD, type GeometryFingerprint } from '../services/fingerprint';
import { analyzeMeshQuality } from '../services/meshQA';
import { annotateModelsWithSales, recordPrice } from '../services/sales';
import { buildWatermarkHeader, isBinarySTL, watermarkAsciiSTL, WATERMARK_ZERO_ORDER, type WatermarkPayload } from '../services/watermark';
import { meshFormatFromName, convertToStl, watermarkOriginal, MAX_MODEL_FILE_BYTES, MAX_MODEL_FILE_MB, type MeshFormat } from '../services/meshConvert';
import { isBakeWorkerEnabled, enqueueBakeJob } from '../services/proxyBake/queue';
import { validateAndResolveTerms, writeModelTerms, assertRequiredTermsPresent, getModelTerms } from '../services/modelTerms';
import { notifyFollowersOfRelease, notifyOwnersOfModelUpdate, createNotification, notifyAdminsOfMeshOverride } from '../services/notifications';
import { maybeStartIntroOffer } from '../services/introCommission';
import { logProductView, logWishlistAdd } from '../services/analytics';
import type { Archiver } from 'archiver';
import type { Response } from 'express';

// The installed @types/archiver omits the factory's call signature, so require
// the real factory and type it via the Archiver class.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createArchive: (format: string, options?: any) => Archiver = require('archiver');

const router = Router();

const VALID_CATEGORIES = ['buildings', 'nature', 'scatter', 'props', 'complete_sets', 'other', 'vehicles', 'characters'];

// Buyer usage licences (migration 030). Neither permits redistributing the digital
// file — that's the platform rule the per-buyer watermark enforces.
const VALID_LICENSES = ['personal', 'commercial'];

// Printer authoring targets (migration 032).
const VALID_PRINTER_TYPES = ['fdm', 'resin', 'both'];

// A listing may bundle several named components ("Small Village" = tower +
// tavern + well), each of several files. Caps are generous but bounded: every
// extra file is a separate background conversion + preview bake.
const MAX_EXTRA_PARTS = 60;
const MAX_COMPONENTS = 20;

// The type facet a model must be tagged with, per model class. A model's headline
// classification is class-conditional (a Vehicle needs vehicle-type, not terrain-type).
const TYPE_FACET_BY_CLASS: Record<string, string> = {
  terrain: 'terrain-type',
  vehicles: 'vehicle-type',
  characters: 'character-type',
};

function parseTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

// ============================================================================
// CREATE MODEL
// ============================================================================

router.post('/',
  authenticate,
  requireArtist,
  requireVerifiedEmail,
  uploadRateLimit,
  uploadModelWithThumbnail,
  handleUploadError,
  asyncHandler(async (req, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    
    if (!files.model || !files.model[0]) {
      throw new ValidationError('Model file is required');
    }

    const modelFile = files.model[0];
    const thumbnailFile = files.thumbnail?.[0];

    const { name, description, category, tags, basePrice } = req.body;

    // Validate required fields
    if (!name || !category || !basePrice) {
      // Cleanup uploaded files
      await deleteUploadedFile(modelFile.path);
      if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
      
      throw new ValidationError('Name, category, and base price are required');
    }

    // Validate category
    const validCategories = VALID_CATEGORIES;
    if (!validCategories.includes(category)) {
      await deleteUploadedFile(modelFile.path);
      if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
      
      throw new ValidationError('Invalid category');
    }

    // Validate base price
    const price = parseFloat(basePrice);
    if (isNaN(price) || price < 0) {
      await deleteUploadedFile(modelFile.path);
      if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
      
      throw new ValidationError('Invalid base price');
    }

    try {
      // Fingerprint: compute SHA-256 and reject exact duplicates
      const rawBuffer = await fsReadFile(modelFile.path);
      const fileHash = computeFileHash(rawBuffer);
      const dupCheck = await db.query(
        'SELECT id, name FROM models WHERE file_hash = $1 AND artist_id <> $2',
        [fileHash, (req as any).userId],
      );
      if (dupCheck.rows.length > 0) {
        await deleteUploadedFile(modelFile.path);
        if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
        throw new ValidationError(`This model file has already been uploaded (matches "${dupCheck.rows[0].name}")`);
      }

      // Geometry fingerprint — reject re-uploads even when re-exported to beat the hash.
      const fingerprint = await computeGeometryFingerprint(modelFile.path);
      const geoDup = (await findGeometryDuplicate(
        fingerprint, '00000000-0000-0000-0000-000000000000', (req as any).userId,
      )).foreign;
      if (geoDup) {
        await deleteUploadedFile(modelFile.path);
        if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
        throw new ValidationError(`This model appears to be a copy of an existing model ("${geoDup.name}")`);
      }

      // Process STL file
      logger.info('Processing STL file', { userId: (req as any).userId, filename: modelFile.filename });
      const stlData = await processSTL(modelFile.path);

      // Generate GLB for 3D preview
      logger.info('Generating GLB preview', { userId: (req as any).userId });
      const glbPath = await generateGLB(modelFile.path);

      // Upload files to storage
      const stlStoragePath = await uploadToStorage(modelFile.path, 'models');
      const glbStoragePath = await uploadToStorage(glbPath, 'previews');
      
      let thumbnailStoragePath = null;
      if (thumbnailFile) {
        thumbnailStoragePath = await uploadToStorage(thumbnailFile.path, 'thumbnails');
      }

      // Estimate print cost
      const printEstimate = estimatePrintCost({
        volume_mm3: stlData.volume,
        surface_area_mm2: stlData.surfaceArea,
        estimated_weight_g: undefined,
        estimated_print_time_minutes: undefined,
        triangle_count: undefined,
      });

      // Parse tags
      let tagsArray: string[] = [];
      if (tags) {
        if (typeof tags === 'string') {
          tagsArray = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
        } else if (Array.isArray(tags)) {
          tagsArray = tags;
        }
      }

      // Create model in database
      const result = await db.query(
        `INSERT INTO models (
          artist_id, name, description, category, tags,
          stl_file_path, glb_file_path, thumbnail_path,
          width, depth, height,
          base_price, estimated_print_time, estimated_material_cost,
          supports_required, recommended_layer_height, recommended_infill,
          file_hash, fulfillment_type, geometry_fingerprint, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'draft')
        RETURNING id, name, created_at`,
        [
          (req as any).userId,
          name,
          description || null,
          category,
          tagsArray,
          stlStoragePath,
          glbStoragePath,
          thumbnailStoragePath,
          stlData.dimensions.x,
          stlData.dimensions.y,
          stlData.dimensions.z,
          price,
          Math.round(printEstimate.estimated_time_hours * 60),
          Number(printEstimate.total_cost.toFixed(2)),
          stlData.needsSupports,
          0.2,
          20,
          fileHash,
          // Digital STL sales only for now — ignore any client-supplied fulfilment.
          'stl',
          JSON.stringify(fingerprint),
        ]
      );

      const model = result.rows[0];

      // Owner full-fidelity GLB (migration 041): queued, never awaited for its
      // result — this legacy multipart path already has the artist's request
      // blocked on the upload, so the build must not join it.
      await enqueueFullGlbJob({ modelId: model.id, partId: null, sourceKey: stlStoragePath });

      // Log activity
      await db.query(
        `INSERT INTO activity_log (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'model.created', 'model', $2, $3)`,
        [(req as any).userId, model.id, JSON.stringify({ name: model.name })]
      );

      logger.info('Model created', { 
        userId: (req as any).userId, 
        modelId: model.id, 
        name: model.name 
      });

      res.status(201).json({
        message: 'Model created successfully',
        model: {
          id: model.id,
          name: model.name,
          status: 'draft',
          createdAt: model.created_at
        }
      });

    } catch (error) {
      // Cleanup uploaded files on error
      await deleteUploadedFile(modelFile.path);
      if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
      
      logger.error('Failed to create model', { error, userId: (req as any).userId });
      throw error;
    }
  }),
  cleanupOnError
);

// ============================================================================
// CREATE MODEL FROM A DIRECT R2 UPLOAD (better path: bytes never touch the app)
// ============================================================================
// The browser presigns + PUTs the raw STL straight to R2 under the `raw/`
// quarantine prefix, then calls this with the returned key. We create the row
// in `processing` state and hand off to a background job, so the seller gets an
// instant response and the request thread isn't blocked on GLB generation.

router.post('/from-upload',
  authenticate,
  requireArtist,
  requireVerifiedEmail,
  requireTwoFactor,
  uploadRateLimit,
  asyncHandler(async (req, res) => {
    if (!isR2Enabled()) {
      throw new ValidationError('Direct uploads are not configured (R2 is disabled)');
    }

    const { rawKey, filename, name, description, category, tags, basePrice, thumbnailKey, parts, terms, license, printerType, primaryGroupName, showInPlanner, isPresupported, displayRawKey, displayFilename } = req.body ?? {};

    if (!rawKey || typeof rawKey !== 'string' || !rawKey.startsWith('raw/')) {
      throw new ValidationError('rawKey (an uploaded raw/ object) is required');
    }
    if (!meshFormatFromName(filename || rawKey)) {
      throw new ValidationError('The model file must be an STL, OBJ or 3MF file');
    }

    // Pre-supported print file → optional support-free "clean preview" companion
    // (see migration 053). The checkbox and the file travel together: ticking it
    // without attaching a file is rejected rather than silently ignored.
    const presupported = isPresupported === true || isPresupported === 'true';
    let cleanDisplayRawKey: string | null = null;
    if (presupported) {
      if (!displayRawKey || typeof displayRawKey !== 'string' || !displayRawKey.startsWith('raw/')) {
        throw new ValidationError('Upload a support-free preview model, or untick "this file is pre-supported"');
      }
      if (!meshFormatFromName(displayFilename || displayRawKey)) {
        throw new ValidationError('The preview model file must be an STL, OBJ or 3MF file');
      }
      const displayBytes = await objectSize(displayRawKey);
      if (displayBytes == null) {
        throw new ValidationError('Preview model file not found in storage — retry the upload');
      }
      if (displayBytes > MAX_MODEL_FILE_BYTES) {
        await safeDeleteObject(displayRawKey);
        throw new ValidationError(
          `Preview model file is too large (${(displayBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB.`,
        );
      }
      cleanDisplayRawKey = displayRawKey;
    }
    // A thumbnail is required up-front (it's also a hard requirement to publish),
    // so we never create a draft that can't be listed.
    if (!thumbnailKey || typeof thumbnailKey !== 'string' || !thumbnailKey.startsWith('thumbnails/')) {
      throw new ValidationError('A thumbnail image is required');
    }
    if (!name || !category || basePrice == null) {
      throw new ValidationError('Name, category, and base price are required');
    }
    if (!VALID_CATEGORIES.includes(category)) {
      throw new ValidationError('Invalid category');
    }
    const price = parseFloat(basePrice);
    if (isNaN(price) || price < 0) {
      throw new ValidationError('Invalid base price');
    }
    // Usage licence — defaults to the conservative 'personal' when unset.
    const modelLicense = license == null ? 'personal' : license;
    if (!VALID_LICENSES.includes(modelLicense)) {
      throw new ValidationError('Invalid licence');
    }
    // Printer authoring target (optional).
    const modelPrinterType = printerType == null || printerType === '' ? null : printerType;
    if (modelPrinterType !== null && !VALID_PRINTER_TYPES.includes(modelPrinterType)) {
      throw new ValidationError('Invalid printer type');
    }
    // Confirm the object actually landed in R2 before we create a row for it,
    // and that it's within the size we can process without exhausting memory.
    const rawBytes = await objectSize(rawKey);
    if (rawBytes == null) {
      throw new ValidationError('Uploaded file not found in storage — retry the upload');
    }
    if (rawBytes > MAX_MODEL_FILE_BYTES) {
      await safeDeleteObject(rawKey);
      throw new ValidationError(
        `Model file is too large (${(rawBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB — please reduce the model's detail (e.g. decimate it in Blender) and upload again.`,
      );
    }

    // Optional extra STL parts (multi-part "set" models). Each must be its own
    // raw/ upload; they're processed alongside the primary in the background.
    // A part may also declare the COMPONENT it belongs to (groupIndex/groupName),
    // which is how a "Small Village" listing keeps its Village Tower's three
    // files together and separate from the Tavern's two (migration 038).
    const extraParts: Array<{
      rawKey: string; filename?: string; name?: string; groupIndex: number; groupName: string | null;
      isPresupported: boolean; displayRawKey: string | null;
    }> = [];
    if (parts != null) {
      if (!Array.isArray(parts)) throw new ValidationError('parts must be an array');
      if (parts.length > MAX_EXTRA_PARTS) {
        throw new ValidationError(`A listing can have at most ${MAX_EXTRA_PARTS} extra files`);
      }
      for (const p of parts) {
        if (!p?.rawKey || typeof p.rawKey !== 'string' || !p.rawKey.startsWith('raw/')) {
          throw new ValidationError('Each part needs an uploaded raw/ object');
        }
        if (!meshFormatFromName(p.filename || p.rawKey)) {
          throw new ValidationError('Each part must be an STL, OBJ or 3MF file');
        }
        const groupIndex = p.groupIndex == null ? 0 : Number(p.groupIndex);
        if (!Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex > MAX_COMPONENTS) {
          throw new ValidationError('Invalid part group');
        }
        const groupName = typeof p.groupName === 'string' && p.groupName.trim()
          ? p.groupName.trim().slice(0, 255)
          : null;
        const partBytes = await objectSize(p.rawKey);
        if (partBytes == null) {
          throw new ValidationError('A part file was not found in storage — retry the upload');
        }
        if (partBytes > MAX_MODEL_FILE_BYTES) {
          await safeDeleteObject(p.rawKey);
          throw new ValidationError(
            `A part file is too large (${(partBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB per file — please reduce it and upload again.`,
          );
        }
        // Per-component "clean preview" (migration 054) — only meaningful when
        // this part is a component's first/primary file, but that's a frontend
        // convention (which part it attaches the field to), not something
        // enforced here.
        const partPresupported = p.isPresupported === true || p.isPresupported === 'true';
        let partDisplayRawKey: string | null = null;
        if (partPresupported) {
          if (!p.displayRawKey || typeof p.displayRawKey !== 'string' || !p.displayRawKey.startsWith('raw/')) {
            throw new ValidationError('Upload a support-free preview model for each pre-supported part, or untick it');
          }
          if (!meshFormatFromName(p.displayRawKey)) {
            throw new ValidationError('A part’s preview model file must be an STL, OBJ or 3MF file');
          }
          const displayBytes = await objectSize(p.displayRawKey);
          if (displayBytes == null) {
            throw new ValidationError('A part’s preview model file was not found in storage — retry the upload');
          }
          if (displayBytes > MAX_MODEL_FILE_BYTES) {
            await safeDeleteObject(p.displayRawKey);
            throw new ValidationError(
              `A part's preview model file is too large (${(displayBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB.`,
            );
          }
          partDisplayRawKey = p.displayRawKey;
        }
        extraParts.push({
          rawKey: p.rawKey, filename: p.filename, name: p.name, groupIndex, groupName,
          isPresupported: partPresupported, displayRawKey: partDisplayRawKey,
        });
      }
    }
    const partCount = 1 + extraParts.length;
    // Name of the component owning the primary file (NULL when the listing isn't
    // split into named models).
    const primaryGroup = typeof primaryGroupName === 'string' && primaryGroupName.trim()
      ? primaryGroupName.trim().slice(0, 255)
      : null;
    // Opt-out of the 3D planner (misc items — a paint brush holder, a display base —
    // aren't placeable scenery). Defaults to true so leaving it unset behaves exactly
    // as before this field existed.
    const modelShowInPlanner = showInPlanner === false ? false : true;

    // Validate taxonomy tags up-front (read-only) so a bad payload never creates a
    // half-tagged draft; they're written after the model row exists.
    const resolvedTerms = await validateAndResolveTerms(terms);

    // Determine the chosen model class (Terrain / Vehicles / Characters). It gates
    // which type facet is required and which legacy category the row gets stored as.
    const modelClass = resolvedTerms.find((t) => t.facetSlug === 'model-class')?.path ?? null;

    // The headline browse facets are mandatory at upload (mirrors the required
    // dropdowns in the UI) — a model must be classified before it's created. The
    // "type" facet is class-conditional; the rest are universal.
    const REQUIRED_UPLOAD_FACETS: Record<string, string> = {
      'model-class': 'Model class',
      ...(modelClass && TYPE_FACET_BY_CLASS[modelClass]
        ? { [TYPE_FACET_BY_CLASS[modelClass]]: 'Model type' }
        : { 'terrain-type': 'Model type' }),
      'setting-era': 'Theme / Era',
      scale: 'Scale',
      // Condition doesn't apply to characters & units.
      ...(modelClass === 'characters' ? {} : { condition: 'Condition' }),
    };
    const taggedFacets = new Set(resolvedTerms.map((t) => t.facetSlug));
    const missingFacets = Object.keys(REQUIRED_UPLOAD_FACETS).filter((f) => !taggedFacets.has(f));
    if (missingFacets.length > 0) {
      throw new ValidationError(
        `Choose a value for: ${missingFacets.map((f) => REQUIRED_UPLOAD_FACETS[f]).join(', ')}`,
      );
    }

    // Digital STL sales only for now — fulfilment is always 'stl'. For vehicles /
    // characters, store that as the legacy `category` so category-based code paths
    // (browse related / categories / stats) stay meaningful; terrain keeps the
    // artist-chosen sub-category (buildings / nature / …).
    const storedCategory = modelClass === 'vehicles' || modelClass === 'characters' ? modelClass : category;
    const userId = (req as any).userId;

    const result = await db.query(
      `INSERT INTO models (
        artist_id, name, description, category, tags,
        stl_file_path, thumbnail_path, base_price, fulfillment_type, part_count, license, printer_type, primary_group_name, show_in_planner, is_presupported, status, processing_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'stl', $9, $10, $11, $12, $13, $14, 'draft', 'processing')
      RETURNING id, name, created_at`,
      [userId, name, description || null, storedCategory, parseTags(tags), rawKey, thumbnailKey || null, price, partCount, modelLicense, modelPrinterType, primaryGroup, modelShowInPlanner, presupported]
    );
    const model = result.rows[0];
    // Seed price history (backs the anti-inflation guard on sales).
    recordPrice('model', model.id, price);

    // Insert a row per extra part (processed in the background job). Default part
    // names count within their own component — group 0 continues from the primary
    // (which is that component's part 1), later components start at part 1.
    const seenInGroup = new Map<number, number>();
    for (let i = 0; i < extraParts.length; i++) {
      const p = extraParts[i];
      const nth = (seenInGroup.get(p.groupIndex) ?? (p.groupIndex === 0 ? 1 : 0)) + 1;
      seenInGroup.set(p.groupIndex, nth);
      await db.query(
        `INSERT INTO model_parts (model_id, name, stl_file_path, display_order, group_index, group_name, is_presupported, display_stl_path, processing_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing')`,
        // display_stl_path starts as the raw uploaded key — same "starts raw,
        // finalized in place" convention stl_file_path uses — and is turned
        // into a canonical path by processModelParts, same as the print file.
        [model.id, p.name || `Part ${nth}`, p.rawKey, i + 1, p.groupIndex, p.groupName, p.isPresupported, p.displayRawKey]
      );
    }

    // Write the (already validated) taxonomy tags.
    if (resolvedTerms.length > 0) {
      await writeModelTerms(model.id, resolvedTerms);
    }

    await db.query(
      `INSERT INTO activity_log (user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'model.created', 'model', $2, $3)`,
      [userId, model.id, JSON.stringify({ name: model.name, via: 'direct-upload', partCount })]
    ).catch((err) => logger.error('activity_log insert failed', { error: err }));

    // Fire-and-forget: process in the background, seller polls GET /:id.
    processUploadedModel(model.id, rawKey, filename, cleanDisplayRawKey ?? undefined, displayFilename).catch((err) =>
      logger.error('Async model processing crashed', { error: err, modelId: model.id })
    );

    logger.info('Model upload accepted for processing', { userId, modelId: model.id });

    res.status(202).json({
      message: 'Upload received — processing',
      model: {
        id: model.id,
        name: model.name,
        status: 'draft',
        processingStatus: 'processing',
        createdAt: model.created_at,
      },
    });
  })
);

// ============================================================================
// UPLOAD A NEW FILE VERSION  (replaces the primary file; owners re-download free)
// ============================================================================

router.post('/:id/new-version',
  authenticate,
  requireArtist,
  requireVerifiedEmail,
  requireTwoFactor,
  requireModelOwnership,
  uploadRateLimit,
  asyncHandler(async (req, res) => {
    if (!isR2Enabled()) {
      throw new ValidationError('Direct uploads are not configured (R2 is disabled)');
    }
    const { id } = req.params;
    const { rawKey, filename, notes } = req.body ?? {};

    if (!rawKey || typeof rawKey !== 'string' || !rawKey.startsWith('raw/')) {
      throw new ValidationError('rawKey (an uploaded raw/ object) is required');
    }
    if (!meshFormatFromName(filename || rawKey)) {
      throw new ValidationError('The model file must be an STL, OBJ or 3MF file');
    }

    const rawBytes = await objectSize(rawKey);
    if (rawBytes == null) {
      throw new ValidationError('Uploaded file not found in storage — retry the upload');
    }
    if (rawBytes > MAX_MODEL_FILE_BYTES) {
      await safeDeleteObject(rawKey);
      throw new ValidationError(
        `Model file is too large (${(rawBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB.`,
      );
    }

    const cur = await db.query('SELECT processing_status FROM models WHERE id = $1', [id]);
    if (cur.rows.length === 0) throw new NotFoundError('Model');
    if (cur.rows[0].processing_status === 'processing') {
      throw new ValidationError('This model is still processing — please try again shortly');
    }

    const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 1000) || null : null;

    // Flip to processing so the poller/UI reflect the reprocess, then run in the
    // background. The old file stays live until the new one succeeds.
    await db.query(
      `UPDATE models SET processing_status = 'processing', processing_error = NULL, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    processModelVersionUpdate(id, rawKey, filename, cleanNotes).catch((err) =>
      logger.error('processModelVersionUpdate crashed', { error: err, modelId: id }),
    );

    logger.info('New model version accepted for processing', { userId: (req as any).userId, modelId: id });
    res.status(202).json({ message: 'New version received — processing', modelId: id, processingStatus: 'processing' });
  })
);

// ============================================================================
// GET MY MODELS (Artist's own models)
// ============================================================================

router.get('/my-models',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const { status, page = 1, limit = 20 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = 'WHERE artist_id = $1';
    const params: any[] = [(req as any).userId];

    if (status) {
      whereClause += ' AND status = $2';
      params.push(status);
    }

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM models ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);

    // Get models
    const result = await db.query(
      `SELECT 
        m.id, m.name, m.description, m.category, m.tags,
        m.thumbnail_path, m.base_price, m.status, m.visibility,
        m.processing_status, m.processing_error, m.part_count, m.show_in_planner,
        m.view_count, m.download_count, m.sale_count,
        m.width, m.height, m.depth,
        m.print_provider_cost, m.print_price, m.print_provider, m.print_quoted_at,
        m.print_consent,
        m.mesh_analyzed, m.mesh_is_watertight, m.mesh_is_manifold, m.mesh_open_edges,
        m.mesh_warning_acknowledged, m.mesh_warning_acknowledged_at,
        m.created_at, m.updated_at, m.published_at,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating
       FROM models m
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       ${whereClause}
       GROUP BY m.id
       ORDER BY m.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), offset]
    );

    res.json({
      models: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / Number(limit))
      }
    });
  })
);

// ============================================================================
// PREVIEW GLB — stream the preview mesh through the API (raw key stays private)
// ============================================================================
// The planner/preview loads the low-poly GLB through here instead of a permanent
// public CDN URL, so the raw object key is never exposed and previews can't be
// hotlinked or bulk-scraped. Published+public models are visible to anyone; drafts
// only to the owner/admin (the loader sends the JWT). We STREAM the bytes rather
// than 302-redirecting to a signed R2 URL because the loader sets an Authorization
// header for drafts, which makes the request preflighted — and browsers refuse to
// follow a cross-origin redirect on a preflighted request (→ every authed load
// failed, planner showed box fallbacks). Streaming keeps everything same-origin.

/**
 * Has this viewer bought (or do they own) this model? Same rule as
 * `GET /:id/download`: the artist, an admin, or a buyer with a succeeded order.
 */
async function isEntitledToModel(modelId: string, viewerId?: string, role?: string): Promise<boolean> {
  if (!viewerId) return false;
  if (role === 'admin') return true;
  const { rows } = await db.query(
    `SELECT 1
       FROM models m
       LEFT JOIN order_items oi ON oi.model_id = m.id AND oi.refunded_at IS NULL
       LEFT JOIN orders o ON o.id = oi.order_id
                         AND o.user_id = $2
                         AND o.payment_status = 'succeeded'
      WHERE m.id = $1 AND (m.artist_id = $2 OR o.id IS NOT NULL)
      LIMIT 1`,
    [modelId, viewerId],
  );
  return rows.length > 0;
}

/**
 * Stream the GLB if the viewer may see this model, else 404.
 *
 * TWO variants live behind this one URL:
 *
 *   - the PREVIEW proxy (`glb_file_path`) — decimated and, on the bake path,
 *     carrying an embossed watermark. What anyone browsing the marketplace gets.
 *   - the OWNER copy (`full_glb_path`) — every triangle of the canonical STL (or,
 *     above a triangle budget several times the public preview's, a light
 *     decimation toward that budget — see OWNER_GLB_TARGET_TRIS in
 *     fileProcessor.ts), no watermark. Served only to someone who has bought the
 *     model (or its artist, or an admin), who already holds the STL and has
 *     nothing left to be protected from (migration 041).
 *
 * Serving both from one URL — rather than a second endpoint the planner has to
 * choose between — keeps the entitlement decision on the server, where it belongs,
 * and means the planner needs no ownership logic at load time. It does make the
 * response vary by viewer, which is why the cache lifetime below is minutes rather
 * than the hour it used to be: buy a model and the planner picks up the real mesh
 * on the next load, instead of serving the cached proxy for the rest of the hour.
 * `?variant=preview` forces the proxy (an artist checking what buyers actually see).
 *
 * If the owner copy isn't built yet, has been skipped, or failed, this silently
 * serves the proxy — the full build is a bonus, never a dependency.
 */
async function servePreviewGlb(
  req: any,
  res: any,
  row: {
    model_id: string;
    artist_id: string;
    status: string;
    visibility: string;
    glb_file_path: string | null;
    full_glb_path: string | null;
  },
) {
  const isPublic = row.status === 'published' && row.visibility === 'public';
  const viewerId = req.userId;
  const isOwnerOrAdmin = viewerId && (viewerId === row.artist_id || req.user?.role === 'admin');
  if (!isPublic && !isOwnerOrAdmin) throw new NotFoundError('Preview');

  let key = row.glb_file_path;
  let variant: 'preview' | 'full' = 'preview';
  if (row.full_glb_path && req.query?.variant !== 'preview') {
    if (await isEntitledToModel(row.model_id, viewerId, req.user?.role)) {
      key = row.full_glb_path;
      variant = 'full';
    }
  }
  if (!key) throw new NotFoundError('Preview');

  if (!isR2Enabled()) {
    // Dev/local fallback: serve via the public asset path (no R2 configured).
    res.redirect(302, `/uploads/${key.replace(/^\/+/, '')}`);
    return;
  }

  // The ETag hashes the key rather than exposing it: full_glb_path is deliberately
  // unguessable (the bucket is public through the CDN) and must not leak in a header.
  // It still changes whenever the served object does — a rebuild mints a new key —
  // so a stale cached copy revalidates into a 304 or the new bytes.
  const etag = `W/"${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}"`;
  res.set('ETag', etag);
  // Short, not the hour this used to hold. The URL is now viewer-dependent, so a
  // long cache would keep serving the proxy to someone who has just bought the
  // model (and a stale full GLB after a file-version rebuild). Five minutes still
  // absorbs reload bursts — which matters, because previewRateLimit counts every
  // request that isn't served from cache and a planner load is dozens of them.
  res.set('Cache-Control', 'private, max-age=300');
  // Entitlement — and therefore which variant this response is — is decided
  // entirely off the Authorization header (see optionalAuth), but the browser's
  // HTTP cache only ever keys on (method, URL) unless a response's Vary header
  // says otherwise. Without this, one identical URL fetched signed-in (say, an
  // admin, who is entitled to EVERY model) gets cached and then handed straight
  // back — no network round-trip at all — to the same browser after signing out
  // or switching accounts, for as long as max-age allows: an admin viewing the
  // unwatermarked owner GLB, then logging out, would keep seeing that exact same
  // response instead of the public proxy. Vary makes the cache key on the header
  // too, so a logged-out (or different-account) request always revalidates.
  res.set('Vary', 'Authorization');
  res.set('X-Preview-Variant', variant);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  const { stream, size } = await getObjectStream(key);
  res.set('Content-Type', 'model/gltf-binary');
  if (size) res.set('Content-Length', String(size));
  stream.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
  stream.pipe(res);
}

// Primary part (part 1 lives on the model row). Its planner asset id IS the model id.
router.get('/:id/preview.glb',
  previewRateLimit,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const row = (await db.query(
      `SELECT id AS model_id, artist_id, status, visibility, glb_file_path, full_glb_path
         FROM models WHERE id = $1`,
      [req.params.id],
    )).rows[0];
    if (!row) throw new NotFoundError('Preview');
    await servePreviewGlb(req, res, row);
  })
);

// An extra "set" part (a model_parts row). Gated by its parent model's visibility.
router.get('/parts/:partId/preview.glb',
  previewRateLimit,
  optionalAuth,
  asyncHandler(async (req, res) => {
    // Entitlement for a set part is the PARENT model's — one purchase covers
    // every part — so the model's id travels with the part's file paths.
    const row = (await db.query(
      `SELECT m.id AS model_id, m.artist_id, m.status, m.visibility,
              p.glb_file_path, p.full_glb_path
       FROM model_parts p JOIN models m ON m.id = p.model_id
       WHERE p.id = $1`,
      [req.params.partId],
    )).rows[0];
    if (!row) throw new NotFoundError('Preview');
    await servePreviewGlb(req, res, row);
  })
);

// ============================================================================
// GET SETS (published multi-part models + their parts) — for the planner
// ============================================================================
// Each part is its own placeable asset in the planner; the primary STL is part
// 1 (on the model row), extras come from model_parts.

router.get('/sets',
  optionalAuth,
  asyncHandler(async (_req, res) => {
    const models = (await db.query(
      `SELECT m.id, m.name, m.base_price, m.thumbnail_path, m.artist_id,
              m.glb_file_path, m.width, m.depth, m.height, m.default_pitch_deg,
              m.primary_group_name
       FROM models m
       WHERE m.part_count > 1 AND m.status = 'published' AND m.visibility = 'public'
         AND m.show_in_planner = true
       ORDER BY m.created_at DESC`
    )).rows;

    const sets = await Promise.all(models.map(async (m: any) => {
      const extra = (await db.query(
        `SELECT id, name, glb_file_path, width, depth, height, group_index, group_name
         FROM model_parts
         WHERE model_id = $1 AND processing_status = 'ready'
         ORDER BY group_index ASC, display_order ASC`,
        [m.id]
      )).rows;
      // NB: never expose the raw glb_file_path (public CDN key). The planner fetches
      // each part's preview through the signed endpoint, keyed by id (primary part's
      // id IS the model id; extras are model_parts ids). `is_primary` tells the
      // frontend which signed route to use.
      const parts = [
        {
          id: m.id, name: 'Part 1', is_primary: true, has_glb: !!m.glb_file_path,
          width: m.width, depth: m.depth, height: m.height,
          group_index: 0, group_name: m.primary_group_name ?? null,
        },
        ...extra.map((p: any) => ({
          id: p.id, name: p.name, is_primary: false, has_glb: !!p.glb_file_path,
          width: p.width, depth: p.depth, height: p.height,
          group_index: p.group_index ?? 0, group_name: p.group_name ?? null,
        })),
      ].filter((p) => p.has_glb);
      return {
        id: m.id,
        name: m.name,
        price: m.base_price,
        thumbnail_path: m.thumbnail_path,
        artist_id: m.artist_id,
        default_pitch_deg: m.default_pitch_deg,
        primary_group_name: m.primary_group_name ?? null,
        parts,
      };
    }));

    res.json({ sets });
  })
);

// ============================================================================
// MY PLACEABLE MODELS (artist's own, incl. drafts) — for the planner palette
// ============================================================================
// Lets an artist lay out their own models on a table *before* they're published.
// Single-part, GLB-ready models of any status (draft/published), scoped to the
// signed-in artist.

router.get('/mine/planner',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const models = (await db.query(
      `SELECT id, name, tags, (glb_file_path IS NOT NULL) AS has_glb, thumbnail_path,
              width, depth, height, base_price, status, default_pitch_deg
       FROM models
       WHERE artist_id = $1 AND part_count = 1 AND glb_file_path IS NOT NULL
         AND (processing_status IS NULL OR processing_status = 'ready')
         AND show_in_planner = true
       ORDER BY created_at DESC`,
      [(req as any).userId]
    )).rows;
    res.json({ models });
  })
);

// ============================================================================
// RESOLVE PLACEABLE ASSETS BY ID (publish-agnostic) — render any table fully
// ============================================================================
// A table may reference models that aren't in the public catalogue (an artist's
// unpublished piece). To render such tables for everyone, resolve the referenced
// models by id here WITHOUT a publish-status gate. Only exposes what the planner
// needs to draw the mesh (already-public GLB + dimensions), never the STL.

router.get('/planner-assets',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 300);
    if (ids.length === 0) { res.json({ models: [] }); return; }
    const models = (await db.query(
      `SELECT m.id, m.name, m.tags, (m.glb_file_path IS NOT NULL) AS has_glb, m.thumbnail_path,
              m.width, m.depth, m.height, m.base_price, m.artist_id, m.default_pitch_deg, u.artist_name
       FROM models m JOIN users u ON u.id = m.artist_id
       WHERE m.id = ANY($1::uuid[]) AND m.part_count = 1 AND m.glb_file_path IS NOT NULL`,
      [ids]
    )).rows;
    res.json({ models });
  })
);

// ============================================================================
// GET SINGLE MODEL (Detailed view)
// ============================================================================

router.get('/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await db.query(
      `SELECT
        m.*,
        u.artist_name, u.artist_bio, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        COUNT(DISTINCT f.id) as favorite_count
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       LEFT JOIN favorites f ON m.id = f.model_id
       WHERE m.id = $1
       GROUP BY m.id, u.artist_name, u.artist_bio, u.artist_url`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Model');
    }

    const model = result.rows[0];

    // Whether the signed-in user has liked (favorited) this model.
    const viewerId = (req as any).userId;
    if (viewerId) {
      const fav = await db.query(
        'SELECT 1 FROM favorites WHERE user_id = $1 AND model_id = $2',
        [viewerId, id]
      );
      model.is_favorited = fav.rows.length > 0;
    } else {
      model.is_favorited = false;
    }

    // Check visibility permissions
    if (model.status !== 'published' || model.visibility !== 'public') {
      if (!(req as any).userId || ((req as any).userId !== model.artist_id && (req as any).user?.role !== 'admin')) {
        throw new NotFoundError('Model');
      }
    }

    // Increment view count (async, don't wait) + log the view event for analytics.
    if (model.status === 'published') {
      db.query('UPDATE models SET view_count = view_count + 1 WHERE id = $1', [id])
        .catch(err => logger.error('Failed to increment view count', { error: err }));
      const sessionId = req.get('x-session-id');
      logProductView(id, model.artist_id, {
        userId: (req as any).userId ?? null,
        sessionId: sessionId && sessionId.length <= 64 ? sessionId : null,
        source: typeof req.query.src === 'string' ? req.query.src : null,
      });
    }

    // Get additional images
    const imagesResult = await db.query(
      `SELECT id, image_path, caption, display_order
       FROM model_images
       WHERE model_id = $1
       ORDER BY display_order`,
      [id]
    );

    // Get recent reviews
    const reviewsResult = await db.query(
      `SELECT 
        r.id, r.rating, r.title, r.comment,
        r.print_quality_rating, r.would_recommend,
        r.created_at,
        u.display_name as reviewer_name
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.model_id = $1 AND r.is_visible = true
       ORDER BY r.created_at DESC
       LIMIT 5`,
      [id]
    );

    // Multi-part "set" — the extra STL parts (primary is part 1 on the model row).
    let parts: any[] = [];
    if ((model.part_count ?? 1) > 1) {
      parts = (await db.query(
        `SELECT id, name, glb_file_path, width, depth, height, processing_status, display_order,
                group_index, group_name
         FROM model_parts WHERE model_id = $1 ORDER BY group_index ASC, display_order ASC`,
        [id]
      )).rows;
    }

    // File version history (changelog) — most recent first.
    const versions = (await db.query(
      `SELECT version, notes, created_at
       FROM model_versions WHERE model_id = $1 ORDER BY version DESC LIMIT 20`,
      [id]
    )).rows;

    // Apply any active sale (adds sale_price / sale_percent / original_price).
    await annotateModelsWithSales([model]);

    // Taxonomy tags (facet terms) for the product page + cross-linking.
    const taxonomyTerms = await getModelTerms(id);

    // How many public tables feature this model ("Featured in N tables").
    const tablesCount = await db.query(
      `SELECT COUNT(*)::int AS c
       FROM table_models tm JOIN user_tables ut ON ut.id = tm.table_id
       WHERE tm.model_id = $1 AND ut.is_public = true`,
      [id]
    );

    // SECURITY: never leak the raw R2 object keys in a public response. The bucket
    // is served by a public CDN domain, so a leaked stl_file_path (the `raw/` key)
    // would let anyone download the original, un-watermarked STL directly, bypassing
    // the entitlement + per-buyer watermark on /:id/download. Expose only booleans;
    // the preview GLB is fetched through the signed /:id/preview.glb endpoint.
    const hasGlb = !!model.glb_file_path;
    delete model.stl_file_path;
    delete model.glb_file_path;
    delete model.source_file_path;
    const safeParts = parts.map((p: any) => ({
      id: p.id, name: p.name, width: p.width, depth: p.depth, height: p.height,
      processing_status: p.processing_status, display_order: p.display_order,
      group_index: p.group_index ?? 0, group_name: p.group_name ?? null,
      has_glb: !!p.glb_file_path,
    }));

    res.json({
      model: {
        ...model,
        has_glb: hasGlb,
        images: imagesResult.rows,
        recentReviews: reviewsResult.rows,
        parts: safeParts,
        versions,
        taxonomyTerms,
        featuredInTables: tablesCount.rows[0]?.c ?? 0,
      }
    });
  })
);

// ============================================================================
// PUBLIC TABLES FEATURING THIS MODEL ("Featured in N tables" → the tables)
// ============================================================================

router.get('/:id/tables',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const limit = Math.min(Number(req.query.limit) || 12, 40);
    const result = await db.query(
      `SELECT ut.id, ut.name, ut.share_token, ut.view_count, ut.created_at,
              jsonb_array_length(COALESCE(ut.layout_data->'models', '[]'::jsonb)) AS model_count
       FROM table_models tm
       JOIN user_tables ut ON ut.id = tm.table_id
       WHERE tm.model_id = $1 AND ut.is_public = true
       ORDER BY ut.view_count DESC, ut.created_at DESC
       LIMIT $2`,
      [id, limit]
    );
    res.json({ tables: result.rows });
  })
);

// ============================================================================
// UPDATE MODEL
// ============================================================================

router.patch('/:id',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'name', 'description', 'category', 'tags', 'base_price', 'license', 'printer_type',
      'supports_required', 'recommended_layer_height', 'recommended_infill', 'default_pitch_deg',
      'show_in_planner'
    ];

    // Whether this model may be placed on the 3D planner — coerce to a real boolean.
    if (updates.show_in_planner !== undefined) {
      updates.show_in_planner = updates.show_in_planner === true || updates.show_in_planner === 'true';
    }

    // Default planner tilt: normalise to an integer in [0, 359] (any junk → 0).
    if (updates.default_pitch_deg !== undefined) {
      const p = Math.round(Number(updates.default_pitch_deg));
      updates.default_pitch_deg = Number.isFinite(p) ? ((p % 360) + 360) % 360 : 0;
    }

    // Validate the usage licence up-front if the caller is changing it.
    if (updates.license !== undefined && !VALID_LICENSES.includes(updates.license)) {
      throw new ValidationError('Invalid licence');
    }
    // Validate printer type (null/'' clears it).
    if (
      updates.printer_type !== undefined &&
      updates.printer_type !== null &&
      updates.printer_type !== '' &&
      !VALID_PRINTER_TYPES.includes(updates.printer_type)
    ) {
      throw new ValidationError('Invalid printer type');
    }
    // Empty string clears the (nullable) printer_type without tripping the CHECK.
    if (updates.printer_type === '') updates.printer_type = null;

    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = $${paramIndex}`);
        updateValues.push(updates[field]);
        paramIndex++;
      }
    }

    // Thumbnail: the client uploads the image straight to R2 (presign, `thumbnails/`
    // prefix) and sends the resulting key here. This is the only way to set/replace a
    // model's thumbnail after creation — required before a draft can be published.
    if (updates.thumbnailKey !== undefined) {
      const key = updates.thumbnailKey;
      if (key !== null && (typeof key !== 'string' || !key.startsWith('thumbnails/'))) {
        throw new ValidationError('thumbnailKey must be an uploaded thumbnails/ object');
      }
      updateFields.push(`thumbnail_path = $${paramIndex}`);
      updateValues.push(key || null);
      paramIndex++;
    }

    // Taxonomy tags can be updated on their own or alongside column edits.
    const hasTermsUpdate = updates.terms !== undefined;
    if (updateFields.length === 0 && !hasTermsUpdate) {
      throw new ValidationError('No valid fields to update');
    }

    // Validate tags before touching anything (throws on bad token / cap).
    const resolvedTerms = hasTermsUpdate ? await validateAndResolveTerms(updates.terms) : null;

    let updatedRow: any = { id };
    if (updateFields.length > 0) {
      updateValues.push(id);
      const result = await db.query(
        `UPDATE models
         SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${paramIndex}
         RETURNING id, name, updated_at`,
        updateValues
      );
      updatedRow = result.rows[0];
    }

    // Track price changes for the sale anti-inflation guard.
    if (updates.base_price !== undefined) {
      const p = Number(updates.base_price);
      if (!Number.isNaN(p)) recordPrice('model', id, p);
    }

    if (resolvedTerms) {
      await writeModelTerms(id, resolvedTerms);
    }

    logger.info('Model updated', { userId: (req as any).userId, modelId: id, terms: hasTermsUpdate });

    res.json({
      message: 'Model updated successfully',
      model: updatedRow
    });
  })
);

// ============================================================================
// PRINT QUOTE — outsourced print-on-demand pricing (artist dashboard button)
// ============================================================================
// Asks the configured print provider what it costs to physically print this
// model, then computes the customer-facing print price:
//   print_price = provider cost + artist fee (the model's base_price) + £1 site.
// The result is stored on the model so the quote persists.

router.post('/:id/print-quote',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const consent = (req.body || {}).consent === true;

    const result = await db.query(
      `SELECT id, name, base_price, width, depth, height, print_consent
       FROM models WHERE id = $1`,
      [id]
    );
    const model = result.rows[0];
    if (!model) {
      throw new NotFoundError('Model not found');
    }

    // The artist must agree the model may be manufactured by a third party
    // before it can be priced for print. Consent is captured once, per model.
    if (!model.print_consent && !consent) {
      throw new ValidationError(
        'Artist consent required before this model can be manufactured by a third-party print service',
      );
    }

    const provider = getPrintProvider();
    const quote = await provider.getQuote({
      modelId: model.id,
      modelName: model.name,
      widthMm: model.width != null ? Number(model.width) : null,
      depthMm: model.depth != null ? Number(model.depth) : null,
      heightMm: model.height != null ? Number(model.height) : null,
    });

    const breakdown = buildPrintPrice(quote, Number(model.base_price));

    await db.query(
      `UPDATE models
       SET print_provider_cost = $1, print_price = $2, print_provider = $3,
           print_quoted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
           print_consent = true,
           print_consent_at = COALESCE(print_consent_at, CURRENT_TIMESTAMP)
       WHERE id = $4`,
      [breakdown.providerCost, breakdown.total, breakdown.provider, id]
    );

    logger.info('Print quote generated', {
      userId: (req as any).userId,
      modelId: id,
      provider: breakdown.provider,
      providerCost: breakdown.providerCost,
      total: breakdown.total,
    });

    res.json({ quote: breakdown });
  })
);

// ============================================================================
// PUBLISH MODEL
// ============================================================================

router.post('/:id/publish',
  authenticate,
  requireArtist,
  requireTwoFactor,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verify model is complete enough to publish
    const modelResult = await db.query(
      `SELECT artist_id, name, description, thumbnail_path, base_price, status, published_at,
              mesh_analyzed, mesh_open_edges, mesh_warning_acknowledged
       FROM models WHERE id = $1`,
      [id]
    );

    if (modelResult.rows.length === 0) {
      throw new NotFoundError('Model');
    }

    const model = modelResult.rows[0];

    if (!model.thumbnail_path) {
      throw new ValidationError('Model must have a thumbnail before publishing');
    }

    // A SERIOUS mesh warning (real open edges/holes — the shell isn't closed) has
    // to be acknowledged before it can go live. Non-manifold-only / degenerate-only
    // issues never block publish — see meshQA.ts / notifications.ts for the reasoning.
    if (model.mesh_analyzed && (model.mesh_open_edges ?? 0) > 0 && !model.mesh_warning_acknowledged) {
      throw new ValidationError(
        'This model has open edges detected in the mesh, which can cause real print failures. ' +
        'Review it on the Edit page and acknowledge the warning before publishing.'
      );
    }

    // Required-facet guardrail: can't publish until the mandatory facets are tagged.
    await assertRequiredTermsPresent(id);

    // First-time publish? (used to fan out release notifications exactly once)
    const isFirstPublish = !model.published_at;

    // Publish model (keep the original published_at on re-publish)
    await db.query(
      `UPDATE models
       SET status = 'published',
           visibility = 'public',
           published_at = COALESCE(published_at, CURRENT_TIMESTAMP)
       WHERE id = $1`,
      [id]
    );

    logger.info('Model published', { userId: (req as any).userId, modelId: id });

    // Fan out "new release" notifications to the artist's followers (once).
    if (isFirstPublish) {
      notifyFollowersOfRelease(model.artist_id, id);
    }

    // If this artist has a pending introductory commission offer, this is the
    // trigger that starts its clock — but only the very first time ANY of their
    // models goes live, not every publish.
    maybeStartIntroOffer(model.artist_id).catch(err =>
      logger.error('maybeStartIntroOffer failed', { error: err, artistId: model.artist_id, modelId: id })
    );

    res.json({
      message: 'Model published successfully',
      modelId: id
    });
  })
);

// ============================================================================
// ACKNOWLEDGE MESH WARNING — artist override of a SERIOUS mesh QA issue (real
// open edges/holes). Required before such a model can publish (see the gate
// above); notifies admins so an ignored-warning pattern is visible, not silent.
// ============================================================================

router.post('/:id/acknowledge-mesh-warning',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;

    const result = await db.query(
      `SELECT artist_id, mesh_analyzed, mesh_open_edges, mesh_warning_acknowledged
       FROM models WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) throw new NotFoundError('Model');
    const model = result.rows[0];

    if (!model.mesh_analyzed || (model.mesh_open_edges ?? 0) <= 0) {
      throw new ValidationError('This model has no outstanding mesh warning to acknowledge');
    }

    await db.query(
      `UPDATE models
       SET mesh_warning_acknowledged = true,
           mesh_warning_acknowledged_at = CURRENT_TIMESTAMP,
           mesh_warning_acknowledged_by = $2
       WHERE id = $1`,
      [id, userId]
    );

    logger.info('Mesh warning acknowledged', { userId, modelId: id, openEdges: model.mesh_open_edges });
    notifyAdminsOfMeshOverride(id, model.artist_id, model.mesh_open_edges).catch(err =>
      logger.error('notifyAdminsOfMeshOverride failed', { error: err, modelId: id })
    );

    res.json({ message: 'Mesh warning acknowledged', modelId: id });
  })
);

// ============================================================================
// UNPUBLISH MODEL
// ============================================================================

router.post('/:id/unpublish',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    await db.query(
      `UPDATE models 
       SET status = 'draft', visibility = 'private'
       WHERE id = $1`,
      [id]
    );

    logger.info('Model unpublished', { userId: (req as any).userId, modelId: id });

    res.json({
      message: 'Model unpublished successfully',
      modelId: id
    });
  })
);

// ============================================================================
// DELETE MODEL
// ============================================================================

router.delete('/:id',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get model file paths for cleanup
    const result = await db.query(
      `SELECT stl_file_path, glb_file_path, thumbnail_path
       FROM models WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Model');
    }

    const model = result.rows[0];

    // Delete model from database
    await db.query('DELETE FROM models WHERE id = $1', [id]);

    // Delete files from storage (async, don't wait)
    deleteFromStorage(model.stl_file_path).catch(err => 
      logger.error('Failed to delete STL file', { error: err })
    );
    if (model.glb_file_path) {
      deleteFromStorage(model.glb_file_path).catch(err => 
        logger.error('Failed to delete GLB file', { error: err })
      );
    }
    if (model.thumbnail_path) {
      deleteFromStorage(model.thumbnail_path).catch(err => 
        logger.error('Failed to delete thumbnail', { error: err })
      );
    }

    logger.info('Model deleted', { userId: (req as any).userId, modelId: id });

    res.json({
      message: 'Model deleted successfully',
      modelId: id
    });
  })
);

// ============================================================================
// UPLOAD ADDITIONAL IMAGES
// ============================================================================

router.post('/:id/images',
  authenticate,
  requireArtist,
  requireModelOwnership,
  uploadRateLimit,
  uploadImages,
  handleUploadError,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      throw new ValidationError('No images provided');
    }

    try {
      const uploadedImages = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const storagePath = await uploadToStorage(file.path, 'images');

        const result = await db.query(
          `INSERT INTO model_images (model_id, image_path, display_order)
           VALUES ($1, $2, $3)
           RETURNING id, image_path, display_order`,
          [id, storagePath, i]
        );

        uploadedImages.push(result.rows[0]);
      }

      logger.info('Model images uploaded', { 
        userId: (req as any).userId, 
        modelId: id, 
        count: files.length 
      });

      res.status(201).json({
        message: 'Images uploaded successfully',
        images: uploadedImages
      });

    } catch (error) {
      logger.error('Failed to upload model images', { error, userId: (req as any).userId });
      throw error;
    }
  }),
  cleanupOnError
);

// ============================================================================
// DELETE IMAGE
// ============================================================================

router.delete('/:id/images/:imageId',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { imageId } = req.params;

    // Get image path for cleanup
    const result = await db.query(
      'SELECT image_path FROM model_images WHERE id = $1',
      [imageId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Image');
    }

    const imagePath = result.rows[0].image_path;

    // Delete from database
    await db.query('DELETE FROM model_images WHERE id = $1', [imageId]);

    // Delete from storage (async)
    deleteFromStorage(imagePath).catch(err => 
      logger.error('Failed to delete image file', { error: err })
    );

    res.json({
      message: 'Image deleted successfully',
      imageId
    });
  })
);

// ============================================================================
// GET MODEL STATISTICS (For artist dashboard)
// ============================================================================

router.get('/:id/stats',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await db.query(
      `SELECT 
        m.view_count,
        m.download_count,
        m.sale_count,
        COUNT(DISTINCT f.id) as favorite_count,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        SUM(oi.total_price) as total_revenue,
        SUM(oi.artist_commission_amount) as total_commission
       FROM models m
       LEFT JOIN favorites f ON m.id = f.model_id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       LEFT JOIN order_items oi ON m.id = oi.model_id AND oi.refunded_at IS NULL
       WHERE m.id = $1
       GROUP BY m.id, m.view_count, m.download_count, m.sale_count`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Model');
    }

    res.json({
      stats: result.rows[0]
    });
  })
);

// ============================================================================
// LIKE / UNLIKE A MODEL (favorites) — powers the like button + count
// ============================================================================

async function favoriteCount(id: string): Promise<number> {
  const r = await db.query('SELECT COUNT(*)::int AS c FROM favorites WHERE model_id = $1', [id]);
  return r.rows[0]?.c ?? 0;
}

router.post('/:id/favorite',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;
    const ins = await db.query(
      `INSERT INTO favorites (user_id, model_id) VALUES ($1, $2)
       ON CONFLICT (user_id, model_id) DO NOTHING
       RETURNING (SELECT artist_id FROM models WHERE id = $2) AS artist_id`,
      [userId, id]
    );
    // Log the wishlist event only on a fresh add (not a duplicate).
    if ((ins.rowCount ?? 0) > 0) {
      logWishlistAdd(id, ins.rows[0]?.artist_id ?? null, { userId });
    }
    res.json({ favorited: true, favoriteCount: await favoriteCount(id) });
  })
);

router.delete('/:id/favorite',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;
    await db.query('DELETE FROM favorites WHERE user_id = $1 AND model_id = $2', [userId, id]);
    res.json({ favorited: false, favoriteCount: await favoriteCount(id) });
  })
);

// ============================================================================
// REVIEWS (buyers rate/review models they've purchased)
// ============================================================================

// Public: list a model's visible reviews (paginated).
router.get('/:id/reviews',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const countRes = await db.query(
      `SELECT COUNT(*) FROM reviews WHERE model_id = $1 AND is_visible = true`,
      [id]
    );
    const totalCount = parseInt(countRes.rows[0].count, 10);

    const result = await db.query(
      `SELECT r.id, r.model_id, r.user_id, r.rating, r.title, r.comment,
              r.created_at, r.updated_at,
              u.display_name AS user_display_name
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.model_id = $1 AND r.is_visible = true
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.json({
      success: true,
      data: {
        reviews: result.rows,
        totalCount,
        page,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    });
  })
);

// Create or update the signed-in buyer's review for a model they purchased.
router.post('/:id/reviews',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;
    const rating = Number(req.body.rating);
    const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() || null : null;
    const title = typeof req.body.title === 'string' ? req.body.title.trim() || null : null;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('Rating must be a whole number from 1 to 5');
    }

    // Only buyers (a succeeded, un-refunded order for this model) may review it.
    const purchase = (await db.query(
      `SELECT oi.id FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.model_id = $1 AND o.user_id = $2 AND o.payment_status = 'succeeded' AND oi.refunded_at IS NULL
       ORDER BY o.created_at DESC LIMIT 1`,
      [id, userId]
    )).rows[0];
    if (!purchase) throw new AuthorizationError('You can only review models you have purchased');

    const result = await db.query(
      `INSERT INTO reviews (model_id, user_id, order_item_id, rating, comment, title)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (model_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating,
                     comment = EXCLUDED.comment,
                     title = EXCLUDED.title,
                     order_item_id = EXCLUDED.order_item_id,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING id, model_id, user_id, rating, title, comment, created_at, updated_at`,
      [id, userId, purchase.id, rating, comment, title]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  })
);

// Update the caller's own review.
router.put('/reviews/:reviewId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    const userId = (req as any).userId;

    const existing = (await db.query('SELECT user_id FROM reviews WHERE id = $1', [reviewId])).rows[0];
    if (!existing) throw new NotFoundError('Review');
    if (existing.user_id !== userId && (req as any).user?.role !== 'admin') {
      throw new AuthorizationError('You can only edit your own review');
    }

    const sets: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (req.body.rating !== undefined) {
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new ValidationError('Rating must be a whole number from 1 to 5');
      }
      sets.push(`rating = $${i++}`);
      values.push(rating);
    }
    if (req.body.comment !== undefined) {
      sets.push(`comment = $${i++}`);
      values.push(typeof req.body.comment === 'string' ? req.body.comment.trim() || null : null);
    }
    if (req.body.title !== undefined) {
      sets.push(`title = $${i++}`);
      values.push(typeof req.body.title === 'string' ? req.body.title.trim() || null : null);
    }
    if (!sets.length) throw new ValidationError('Nothing to update');

    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(reviewId);
    const result = await db.query(
      `UPDATE reviews SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, model_id, user_id, rating, title, comment, created_at, updated_at`,
      values
    );
    res.json({ success: true, data: result.rows[0] });
  })
);

// Delete the caller's own review (or admin).
router.delete('/reviews/:reviewId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    const userId = (req as any).userId;
    const existing = (await db.query('SELECT user_id FROM reviews WHERE id = $1', [reviewId])).rows[0];
    if (!existing) throw new NotFoundError('Review');
    if (existing.user_id !== userId && (req as any).user?.role !== 'admin') {
      throw new AuthorizationError('You can only delete your own review');
    }
    await db.query('DELETE FROM reviews WHERE id = $1', [reviewId]);
    res.json({ success: true });
  })
);

// ============================================================================
// DOWNLOAD PURCHASED STL (watermarked per buyer, streamed from R2)
// ============================================================================

router.get('/:id/download',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;

    const model = (await db.query(
      `SELECT id, artist_id, name, stl_file_path, source_format, source_file_path,
              fulfillment_type, processing_status, part_count, status, primary_group_name
       FROM models WHERE id = $1`,
      [id]
    )).rows[0];
    if (!model) throw new NotFoundError('Model');
    if (model.processing_status && model.processing_status !== 'ready') {
      throw new ValidationError('This model is still processing');
    }
    // Moderation takedown: a flagged/archived model can't be downloaded (even by prior
    // buyers or the artist) — only admins, for evidence. Copyright/inappropriate removals
    // rely on this to actually stop distribution.
    if ((model.status === 'archived' || model.status === 'flagged') && (req as any).user?.role !== 'admin') {
      throw new AuthorizationError('This model is unavailable for download');
    }
    if (!model.stl_file_path) throw new NotFoundError('STL file');
    if (!isR2Enabled()) throw new ValidationError('Downloads are not configured (R2 disabled)');

    // Entitlement: the artist, or a buyer with a succeeded, un-refunded order for this model.
    const isArtist = model.artist_id === userId;
    let orderId = WATERMARK_ZERO_ORDER;
    if (!isArtist) {
      const ent = (await db.query(
        `SELECT o.id FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE oi.model_id = $1 AND o.user_id = $2 AND o.payment_status = 'succeeded' AND oi.refunded_at IS NULL
         ORDER BY o.created_at DESC LIMIT 1`,
        [id, userId]
      )).rows[0];
      if (!ent) throw new AuthorizationError('You have not purchased this model');
      orderId = ent.id;
    }

    const safeName = String(model.name || 'model').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60);
    const payload = { modelId: id, buyerId: userId, orderId } as WatermarkPayload;

    // Each part delivers its watermarked canonical STL, plus (for OBJ/3MF uploads)
    // the artist's original file.
    type Entry = { name: string; key: string; format: MeshFormat };
    const entries: Entry[] = [];
    // Artists are free to name two parts (or two components) the same thing, so
    // de-duplicate entry paths — a ZIP with repeated names hides files on extract.
    const usedNames = new Set<string>();
    const uniqueName = (name: string) => {
      if (!usedNames.has(name)) { usedNames.add(name); return name; }
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let n = 2;
      while (usedNames.has(`${stem}-${n}${ext}`)) n++;
      const out = `${stem}-${n}${ext}`;
      usedNames.add(out);
      return out;
    };
    const addDeliverable = (label: string, stlKey: string, srcFormat?: string, srcKey?: string | null) => {
      entries.push({ name: uniqueName(`${label}.stl`), key: stlKey, format: 'stl' });
      if (srcFormat && srcFormat !== 'stl' && srcKey) {
        entries.push({ name: uniqueName(`${label}.${srcFormat}`), key: srcKey, format: srcFormat as MeshFormat });
      }
    };

    if ((model.part_count ?? 1) > 1) {
      // Multi-part "set": every part's STL (+ original) as one watermarked ZIP.
      const parts = (await db.query(
        `SELECT name, stl_file_path, source_format, source_file_path, group_index, group_name
         FROM model_parts WHERE model_id = $1 ORDER BY group_index ASC, display_order ASC`,
        [id]
      )).rows;
      // When the listing is split into named components ("Small Village" → Village
      // Tower / Tavern / Well), give each component its own folder in the ZIP so a
      // buyer can tell which files belong together. Ungrouped sets stay flat.
      const slug = (v: string) => String(v).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60);
      const grouped =
        !!model.primary_group_name ||
        parts.some((p: any) => (p.group_index ?? 0) !== 0 || p.group_name);
      const folderFor = (groupIndex: number, groupName: string | null) =>
        grouped ? `${slug(groupName || `model-${groupIndex + 1}`)}/` : '';

      addDeliverable(
        `${folderFor(0, model.primary_group_name)}${safeName}-part-1`,
        model.stl_file_path, model.source_format, model.source_file_path,
      );
      parts.forEach((p: any, i: number) => {
        const label = slug(p.name || `part-${i + 2}`);
        addDeliverable(
          `${folderFor(p.group_index ?? 0, p.group_name)}${label}`,
          p.stl_file_path, p.source_format, p.source_file_path,
        );
      });
      await streamWatermarkedZip(entries, payload, safeName, res);
    } else {
      addDeliverable(safeName, model.stl_file_path, model.source_format, model.source_file_path);
      if (entries.length === 1) {
        // Pure single STL — stream it directly (backpressure-aware, low memory).
        res.setHeader('Content-Type', 'model/stl');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.stl"`);
        await streamWatermarkedSTL(model.stl_file_path, payload, res);
      } else {
        // OBJ/3MF upload → original + converted STL as a ZIP.
        await streamWatermarkedZip(entries, payload, safeName, res);
      }
    }

    db.query('UPDATE models SET download_count = download_count + 1 WHERE id = $1', [id])
      .catch((err) => logger.error('download_count bump failed', { error: err, id }));
  })
);

// ============================================================================
// BACKGROUND PROCESSING for direct (R2) uploads
// ============================================================================
// NOTE: this runs in-process (fits Railway's single service). If the process
// restarts mid-job the row is left in 'processing'; a future reaper/retry can
// pick those up. For higher volume, move this to a real job queue.

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

async function processUploadedModel(
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
    const fingerprint = await computeGeometryFingerprint(stlTmp);
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

      const displayFingerprint = await computeGeometryFingerprint(displayStlTmp);
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
    const stlData = await processSTL(stlTmp);
    const bakeEnabled = isBakeWorkerEnabled();
    let glbStoragePath: string | null = null;
    if (!bakeEnabled) {
      const glbPath = await generateGLB(previewSourceLocalPath);
      glbStoragePath = await uploadToStorage(glbPath, 'previews');
    }

    // Advisory mesh QA (watertight/manifold). Never blocks the upload.
    const meshQA = await analyzeMeshQuality(stlTmp);

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
async function processModelVersionUpdate(
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

    const fingerprint = await computeGeometryFingerprint(stlTmp);
    const geoDup = await findGeometryDuplicate(fingerprint, modelId, ownerId);
    if (geoDup.foreign) {
      await failVersionUpdate(modelId, 'That file looks like a copy of a model already on the marketplace — not applied');
      await safeDeleteObject(rawKey);
      return;
    }

    const stlData = await processSTL(stlTmp);
    const bakeEnabled = isBakeWorkerEnabled();
    // Preview GLB: baked out-of-process by the worker, or the pure-Node fallback.
    // When baking we keep the OLD preview via COALESCE until the new bake lands.
    let glbStoragePath: string | null = null;
    if (!bakeEnabled) {
      const glbPath = await generateGLB(stlTmp);
      glbStoragePath = await uploadToStorage(glbPath, 'previews');
    }
    const meshQA = await analyzeMeshQuality(stlTmp);

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
      const fileHash = computeFileHash(stlBuffer);
      const fingerprint = await computeGeometryFingerprint(stlTmp);
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
        const displayFingerprint = await computeGeometryFingerprint(displayStlTmp);
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

      const stlData = await processSTL(stlTmp);
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

async function findGeometryDuplicate(
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
 * Stream an STL from R2 to the client, stamping the encrypted watermark header
 * on the fly. Backpressure-aware and only buffers the 84-byte head, so a 100MB+
 * STL never sits in memory.
 */
async function streamWatermarkedSTL(stlKey: string, payload: WatermarkPayload, res: Response): Promise<void> {
  const { stream, size } = await getObjectStream(stlKey);
  const write = (buf: Buffer) =>
    new Promise<void>((resolve, reject) => {
      const ok = res.write(buf, (err?: Error | null) => { if (err) reject(err); });
      if (ok) resolve();
      else res.once('drain', resolve);
    });

  const iter = stream[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let head = Buffer.alloc(0);
  while (head.length < 84) {
    const { value, done } = await iter.next();
    if (done) break;
    chunks.push(value as Buffer);
    head = Buffer.concat(chunks);
  }

  if (isBinarySTL(size, head)) {
    // Overwrite the ignored 80-byte header; keep everything from byte 80 on.
    await write(buildWatermarkHeader(payload));
    if (head.length > 80) await write(head.subarray(80));
    for (let r = await iter.next(); !r.done; r = await iter.next()) await write(r.value as Buffer);
  } else {
    // Not a recognised binary STL: assemble it, watermark ASCII if possible,
    // otherwise serve it unchanged (never corrupt a buyer's file).
    const parts: Buffer[] = [head];
    for (let r = await iter.next(); !r.done; r = await iter.next()) parts.push(r.value as Buffer);
    const full = Buffer.concat(parts);
    const isAscii = full.subarray(0, 5).toString('ascii').toLowerCase() === 'solid';
    await write(isAscii ? watermarkAsciiSTL(full, payload) : full);
  }
  res.end();
}

/** Download an STL from R2 and return it with the buyer's watermark applied. */
async function watermarkedSTLBuffer(key: string, payload: WatermarkPayload): Promise<Buffer> {
  const buf = await downloadObject(key);
  if (isBinarySTL(buf.length, buf)) {
    // Overwrite the ignored 80-byte header; geometry bytes 80+ are untouched.
    return Buffer.concat([buildWatermarkHeader(payload), buf.subarray(80)]);
  }
  const isAscii = buf.subarray(0, 5).toString('ascii').toLowerCase() === 'solid';
  return isAscii ? watermarkAsciiSTL(buf, payload) : buf;
}

/** Watermark one deliverable: STL via its header, OBJ/3MF via a best-effort tag. */
async function watermarkedEntryBuffer(key: string, format: MeshFormat, payload: WatermarkPayload): Promise<Buffer> {
  if (format === 'stl') return watermarkedSTLBuffer(key, payload);
  const buf = await downloadObject(key);
  return watermarkOriginal(buf, format, payload);
}

/**
 * Stream a ZIP of watermarked deliverables. Used for multi-part "sets" and for
 * single OBJ/3MF models (where the buyer gets the original file + a converted STL).
 */
async function streamWatermarkedZip(
  files: Array<{ name: string; key: string; format: MeshFormat }>,
  payload: WatermarkPayload,
  zipName: string,
  res: Response,
): Promise<void> {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"`);
  const archive = createArchive('zip', { zlib: { level: 6 } });
  archive.on('error', (err: Error) => {
    logger.error('ZIP stream error', { error: err });
    res.destroy(err);
  });
  archive.pipe(res);
  for (const f of files) {
    const buf = await watermarkedEntryBuffer(f.key, f.format, payload);
    archive.append(buf, { name: f.name });
  }
  await archive.finalize();
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

async function safeDeleteObject(key: string): Promise<void> {
  try { await deleteObject(key); } catch (err) { logger.warn('Failed to delete quarantined object', { error: err, key }); }
}

export default router;
