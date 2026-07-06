// backend/src/routes/models.ts
// Artist model management: upload, update, delete models

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { 
  authenticate, 
  requireArtist, 
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
import { uploadRateLimit } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { ValidationError, NotFoundError, AuthorizationError } from '../middleware/error';
import { processSTL, generateGLB, computeFileHash } from '../services/fileProcessor';
import { readFile as fsReadFile } from 'fs/promises';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { estimatePrintCost } from '../services/printEstimator';
import { uploadToStorage, deleteFromStorage } from '../services/storage';
import { isR2Enabled, objectExists, downloadObject, deleteObject, getObjectStream } from '../services/r2';
import { computeGeometryFingerprint, isLikelyDuplicate, fingerprintDistance, MATCH_THRESHOLD, type GeometryFingerprint } from '../services/fingerprint';
import { buildWatermarkHeader, isBinarySTL, watermarkAsciiSTL, WATERMARK_ZERO_ORDER, type WatermarkPayload } from '../services/watermark';
import { validateAndResolveTerms, writeModelTerms, assertRequiredTermsPresent, getModelTerms } from '../services/modelTerms';
import { notifyFollowersOfRelease } from '../services/notifications';
import type { Archiver } from 'archiver';
import type { Response } from 'express';

// The installed @types/archiver omits the factory's call signature, so require
// the real factory and type it via the Archiver class.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createArchive: (format: string, options?: any) => Archiver = require('archiver');

const router = Router();

const VALID_CATEGORIES = ['buildings', 'nature', 'scatter', 'props', 'complete_sets', 'other'];

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
    const validCategories = ['buildings', 'nature', 'scatter', 'props', 'complete_sets', 'other'];
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
      const dupCheck = await db.query('SELECT id, name FROM models WHERE file_hash = $1', [fileHash]);
      if (dupCheck.rows.length > 0) {
        await deleteUploadedFile(modelFile.path);
        if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
        throw new ValidationError(`This model file has already been uploaded (matches "${dupCheck.rows[0].name}")`);
      }

      // Geometry fingerprint — reject re-uploads even when re-exported to beat the hash.
      const fingerprint = await computeGeometryFingerprint(modelFile.path);
      const geoDup = await findGeometryDuplicate(fingerprint, '00000000-0000-0000-0000-000000000000');
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
  uploadRateLimit,
  asyncHandler(async (req, res) => {
    if (!isR2Enabled()) {
      throw new ValidationError('Direct uploads are not configured (R2 is disabled)');
    }

    const { rawKey, filename, name, description, category, tags, basePrice, thumbnailKey, parts, terms } = req.body ?? {};

    if (!rawKey || typeof rawKey !== 'string' || !rawKey.startsWith('raw/')) {
      throw new ValidationError('rawKey (an uploaded raw/ object) is required');
    }
    if (thumbnailKey != null && (typeof thumbnailKey !== 'string' || !thumbnailKey.startsWith('thumbnails/'))) {
      throw new ValidationError('thumbnailKey must be an uploaded thumbnails/ object');
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
    // Confirm the object actually landed in R2 before we create a row for it.
    if (!(await objectExists(rawKey))) {
      throw new ValidationError('Uploaded file not found in storage — retry the upload');
    }

    // Optional extra STL parts (multi-part "set" models). Each must be its own
    // raw/ upload; they're processed alongside the primary in the background.
    const extraParts: Array<{ rawKey: string; filename?: string; name?: string }> = [];
    if (parts != null) {
      if (!Array.isArray(parts)) throw new ValidationError('parts must be an array');
      if (parts.length > 20) throw new ValidationError('A set can have at most 20 extra parts');
      for (const p of parts) {
        if (!p?.rawKey || typeof p.rawKey !== 'string' || !p.rawKey.startsWith('raw/')) {
          throw new ValidationError('Each part needs an uploaded raw/ object');
        }
        if (!(await objectExists(p.rawKey))) {
          throw new ValidationError('A part file was not found in storage — retry the upload');
        }
        extraParts.push({ rawKey: p.rawKey, filename: p.filename, name: p.name });
      }
    }
    const partCount = 1 + extraParts.length;

    // Validate taxonomy tags up-front (read-only) so a bad payload never creates a
    // half-tagged draft; they're written after the model row exists.
    const resolvedTerms = await validateAndResolveTerms(terms);

    // Digital STL sales only for now — fulfilment is always 'stl'.
    const userId = (req as any).userId;

    const result = await db.query(
      `INSERT INTO models (
        artist_id, name, description, category, tags,
        stl_file_path, thumbnail_path, base_price, fulfillment_type, part_count, status, processing_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'stl', $9, 'draft', 'processing')
      RETURNING id, name, created_at`,
      [userId, name, description || null, category, parseTags(tags), rawKey, thumbnailKey || null, price, partCount]
    );
    const model = result.rows[0];

    // Insert a row per extra part (processed in the background job).
    for (let i = 0; i < extraParts.length; i++) {
      const p = extraParts[i];
      await db.query(
        `INSERT INTO model_parts (model_id, name, stl_file_path, display_order, processing_status)
         VALUES ($1, $2, $3, $4, 'processing')`,
        [model.id, p.name || `Part ${i + 2}`, p.rawKey, i + 1]
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
    processUploadedModel(model.id, rawKey, filename).catch((err) =>
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
        m.processing_status, m.processing_error, m.part_count,
        m.view_count, m.download_count, m.sale_count,
        m.width, m.height, m.depth,
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
// GET SETS (published multi-part models + their parts) — for the planner
// ============================================================================
// Each part is its own placeable asset in the planner; the primary STL is part
// 1 (on the model row), extras come from model_parts.

router.get('/sets',
  optionalAuth,
  asyncHandler(async (_req, res) => {
    const models = (await db.query(
      `SELECT m.id, m.name, m.base_price, m.thumbnail_path, m.artist_id,
              m.glb_file_path, m.width, m.depth, m.height
       FROM models m
       WHERE m.part_count > 1 AND m.status = 'published' AND m.visibility = 'public'
       ORDER BY m.created_at DESC`
    )).rows;

    const sets = await Promise.all(models.map(async (m: any) => {
      const extra = (await db.query(
        `SELECT id, name, glb_file_path, width, depth, height
         FROM model_parts
         WHERE model_id = $1 AND processing_status = 'ready'
         ORDER BY display_order ASC`,
        [m.id]
      )).rows;
      const parts = [
        // Primary part (part 1) lives on the model row; its asset id is the modelId.
        { id: m.id, name: 'Part 1', glb_file_path: m.glb_file_path, width: m.width, depth: m.depth, height: m.height },
        ...extra.map((p: any) => ({ id: p.id, name: p.name, glb_file_path: p.glb_file_path, width: p.width, depth: p.depth, height: p.height })),
      ].filter((p) => p.glb_file_path);
      return {
        id: m.id,
        name: m.name,
        price: m.base_price,
        thumbnail_path: m.thumbnail_path,
        artist_id: m.artist_id,
        parts,
      };
    }));

    res.json({ sets });
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

    // Increment view count (async, don't wait)
    if (model.status === 'published') {
      db.query('UPDATE models SET view_count = view_count + 1 WHERE id = $1', [id])
        .catch(err => logger.error('Failed to increment view count', { error: err }));
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
        `SELECT id, name, glb_file_path, width, depth, height, processing_status, display_order
         FROM model_parts WHERE model_id = $1 ORDER BY display_order ASC`,
        [id]
      )).rows;
    }

    // Taxonomy tags (facet terms) for the product page + cross-linking.
    const taxonomyTerms = await getModelTerms(id);

    // How many public tables feature this model ("Featured in N tables").
    const tablesCount = await db.query(
      `SELECT COUNT(*)::int AS c
       FROM table_models tm JOIN user_tables ut ON ut.id = tm.table_id
       WHERE tm.model_id = $1 AND ut.is_public = true`,
      [id]
    );

    res.json({
      model: {
        ...model,
        images: imagesResult.rows,
        recentReviews: reviewsResult.rows,
        parts,
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
      'name', 'description', 'category', 'tags', 'base_price',
      'supports_required', 'recommended_layer_height', 'recommended_infill'
    ];

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
// PUBLISH MODEL
// ============================================================================

router.post('/:id/publish',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verify model is complete enough to publish
    const modelResult = await db.query(
      `SELECT artist_id, name, description, thumbnail_path, base_price, status, published_at
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

    res.json({
      message: 'Model published successfully',
      modelId: id
    });
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
       LEFT JOIN order_items oi ON m.id = oi.model_id
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
    await db.query(
      `INSERT INTO favorites (user_id, model_id) VALUES ($1, $2)
       ON CONFLICT (user_id, model_id) DO NOTHING`,
      [userId, id]
    );
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
// DOWNLOAD PURCHASED STL (watermarked per buyer, streamed from R2)
// ============================================================================

router.get('/:id/download',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;

    const model = (await db.query(
      `SELECT id, artist_id, name, stl_file_path, fulfillment_type, processing_status, part_count
       FROM models WHERE id = $1`,
      [id]
    )).rows[0];
    if (!model) throw new NotFoundError('Model');
    if (model.processing_status && model.processing_status !== 'ready') {
      throw new ValidationError('This model is still processing');
    }
    if (!model.stl_file_path) throw new NotFoundError('STL file');
    if (!isR2Enabled()) throw new ValidationError('Downloads are not configured (R2 disabled)');

    // Entitlement: the artist, or a buyer with a succeeded order for this model.
    const isArtist = model.artist_id === userId;
    let orderId = WATERMARK_ZERO_ORDER;
    if (!isArtist) {
      const ent = (await db.query(
        `SELECT o.id FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE oi.model_id = $1 AND o.user_id = $2 AND o.payment_status = 'succeeded'
         ORDER BY o.created_at DESC LIMIT 1`,
        [id, userId]
      )).rows[0];
      if (!ent) throw new AuthorizationError('You have not purchased this model');
      orderId = ent.id;
    }

    const safeName = String(model.name || 'model').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60);
    const payload = { modelId: id, buyerId: userId, orderId } as WatermarkPayload;

    if ((model.part_count ?? 1) > 1) {
      // Multi-part "set": deliver every part as one watermarked ZIP.
      const parts = (await db.query(
        `SELECT name, stl_file_path FROM model_parts WHERE model_id = $1 ORDER BY display_order ASC`,
        [id]
      )).rows;
      const files: Array<{ name: string; key: string }> = [
        { name: `${safeName}-part-1.stl`, key: model.stl_file_path },
        ...parts.map((p: any, i: number) => ({
          name: `${String(p.name || `part-${i + 2}`).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60)}.stl`,
          key: p.stl_file_path as string,
        })),
      ];
      await streamWatermarkedZip(files, payload, safeName, res);
    } else {
      res.setHeader('Content-Type', 'model/stl');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.stl"`);
      await streamWatermarkedSTL(model.stl_file_path, payload, res);
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

async function processUploadedModel(modelId: string, rawKey: string, filename?: string): Promise<void> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-model-'));
  const ext = (path.extname(filename || rawKey) || '.stl').toLowerCase();
  const stlTmp = path.join(tmpDir, `model${ext}`);

  try {
    // 1. Pull the raw bytes from R2 to a temp file (processors work on paths).
    const buffer = await downloadObject(rawKey);
    await fsp.writeFile(stlTmp, buffer);

    // 2. Reject exact-duplicate uploads (by content hash), excluding this row.
    const fileHash = computeFileHash(buffer);
    const dup = await db.query('SELECT id, name FROM models WHERE file_hash = $1 AND id <> $2', [fileHash, modelId]);
    if (dup.rows.length > 0) {
      await markModelFailed(modelId, `This model file has already been uploaded (matches "${dup.rows[0].name}")`);
      await safeDeleteObject(rawKey);
      return;
    }

    // 3. Geometry fingerprint — catches re-uploads even if the file was
    //    re-exported/rotated/rescaled to dodge the exact-hash check above.
    const fingerprint = await computeGeometryFingerprint(stlTmp);
    const geoDup = await findGeometryDuplicate(fingerprint, modelId);
    if (geoDup) {
      await markModelFailed(modelId, `This model appears to be a copy of an existing model ("${geoDup.name}")`);
      await safeDeleteObject(rawKey);
      return;
    }

    // 4. Analyse geometry + generate the GLB preview.
    const stlData = await processSTL(stlTmp);
    const glbPath = await generateGLB(stlTmp);
    const glbStoragePath = await uploadToStorage(glbPath, 'previews');

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
         glb_file_path = $1,
         width = $2, depth = $3, height = $4,
         estimated_print_time = $5, estimated_material_cost = $6, supports_required = $7,
         recommended_layer_height = 0.2, recommended_infill = 20,
         file_hash = $8,
         geometry_fingerprint = $9,
         processing_status = $10, processing_error = NULL,
         updated_at = NOW()
       WHERE id = $11`,
      [
        glbStoragePath,
        stlData.dimensions.x, stlData.dimensions.y, stlData.dimensions.z,
        Math.round(printEstimate.estimated_time_hours * 60),
        Number(printEstimate.total_cost.toFixed(2)),
        stlData.needsSupports,
        fileHash,
        JSON.stringify(fingerprint),
        hasParts ? 'processing' : 'ready',
        modelId,
      ]
    );

    // 5. Extra STL parts (multi-part "set"). On success, flip the model to ready.
    if (hasParts) {
      await processModelParts(modelId);
      await db.query(
        `UPDATE models SET processing_status = 'ready', processing_error = NULL, updated_at = NOW()
         WHERE id = $1 AND processing_status = 'processing'`,
        [modelId]
      );
    }

    logger.info('Model processed successfully', { modelId, hasParts });
  } catch (error) {
    logger.error('Model processing failed', { error, modelId });
    await markModelFailed(modelId, (error as Error)?.message?.slice(0, 500) || 'Processing failed');
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Process every extra STL part of a multi-part ("set") model: dedup, per-part GLB
 * preview, dimensions + fingerprint. Throws (after marking the model failed) if any
 * part can't be processed, so the caller leaves the model in 'failed'.
 */
async function processModelParts(modelId: string): Promise<void> {
  const { rows: parts } = await db.query(
    `SELECT id, name, stl_file_path FROM model_parts WHERE model_id = $1 ORDER BY display_order ASC`,
    [modelId]
  );

  for (const part of parts) {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-part-'));
    const stlTmp = path.join(tmpDir, 'part.stl');
    try {
      const buffer = await downloadObject(part.stl_file_path);
      await fsp.writeFile(stlTmp, buffer);

      // Dedup each part against every other model + part (not this model's own).
      const fileHash = computeFileHash(buffer);
      const fingerprint = await computeGeometryFingerprint(stlTmp);
      const geoDup = await findGeometryDuplicate(fingerprint, modelId);
      if (geoDup) {
        const reason = `Part "${part.name}" appears to be a copy of an existing model ("${geoDup.name}")`;
        await db.query(`UPDATE model_parts SET processing_status='failed', processing_error=$1 WHERE id=$2`, [reason, part.id]);
        await markModelFailed(modelId, reason);
        await safeDeleteObject(part.stl_file_path);
        throw new Error(reason);
      }

      const stlData = await processSTL(stlTmp);
      const glbPath = await generateGLB(stlTmp);
      const glbStoragePath = await uploadToStorage(glbPath, 'previews');

      await db.query(
        `UPDATE model_parts SET
           glb_file_path = $1, width = $2, depth = $3, height = $4,
           file_hash = $5, geometry_fingerprint = $6,
           processing_status = 'ready', processing_error = NULL
         WHERE id = $7`,
        [glbStoragePath, stlData.dimensions.x, stlData.dimensions.y, stlData.dimensions.z, fileHash, JSON.stringify(fingerprint), part.id]
      );
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
async function findGeometryDuplicate(
  fingerprint: GeometryFingerprint,
  excludeId: string,
): Promise<{ id: string; name: string } | null> {
  // Scan both whole models and individual set parts (excluding the model being
  // processed and its own parts), so a stolen file re-uploaded as a "part" is
  // still caught.
  const { rows: modelRows } = await db.query(
    `SELECT id, name, geometry_fingerprint FROM models
     WHERE geometry_fingerprint IS NOT NULL AND id <> $1`,
    [excludeId]
  );
  const { rows: partRows } = await db.query(
    `SELECT mp.model_id AS id, COALESCE(m.name, mp.name) AS name, mp.geometry_fingerprint
     FROM model_parts mp JOIN models m ON m.id = mp.model_id
     WHERE mp.geometry_fingerprint IS NOT NULL AND mp.model_id <> $1`,
    [excludeId]
  );
  const rows = [...modelRows, ...partRows];
  let match: { id: string; name: string } | null = null;
  // Track the closest candidate so a false positive / near-miss is diagnosable
  // in the logs (compare against FINGERPRINT_MATCH_THRESHOLD).
  let best = { id: '', name: '', dist: Infinity };
  for (const row of rows) {
    const fp = row.geometry_fingerprint as GeometryFingerprint;
    const dist = fingerprintDistance(fingerprint, fp);
    if (dist < best.dist) best = { id: row.id, name: row.name, dist };
    if (!match && isLikelyDuplicate(fingerprint, fp)) {
      match = { id: row.id, name: row.name };
    }
  }
  logger.info('Geometry dedup check', {
    candidates: rows.length,
    closest: best.name || null,
    closestDistance: Number.isFinite(best.dist) ? Number(best.dist.toFixed(4)) : null,
    threshold: MATCH_THRESHOLD,
    matched: match?.name ?? null,
  });
  return match;
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

/** Stream a ZIP of watermarked STL parts (multi-part "set" download). */
async function streamWatermarkedZip(
  files: Array<{ name: string; key: string }>,
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
    const buf = await watermarkedSTLBuffer(f.key, payload);
    archive.append(buf, { name: f.name });
  }
  await archive.finalize();
}

async function markModelFailed(modelId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE models SET processing_status = 'failed', processing_error = $1, updated_at = NOW() WHERE id = $2`,
    [reason, modelId]
  ).catch((err) => logger.error('Failed to mark model as failed', { error: err, modelId }));
}

async function safeDeleteObject(key: string): Promise<void> {
  try { await deleteObject(key); } catch (err) { logger.warn('Failed to delete quarantined object', { error: err, key }); }
}

export default router;
