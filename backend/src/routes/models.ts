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
import type { Response } from 'express';

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

    const { rawKey, filename, name, description, category, tags, basePrice, thumbnailKey } = req.body ?? {};

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

    // Digital STL sales only for now — fulfilment is always 'stl'.
    const userId = (req as any).userId;

    const result = await db.query(
      `INSERT INTO models (
        artist_id, name, description, category, tags,
        stl_file_path, thumbnail_path, base_price, fulfillment_type, status, processing_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'stl', 'draft', 'processing')
      RETURNING id, name, created_at`,
      [userId, name, description || null, category, parseTags(tags), rawKey, thumbnailKey || null, price]
    );
    const model = result.rows[0];

    await db.query(
      `INSERT INTO activity_log (user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'model.created', 'model', $2, $3)`,
      [userId, model.id, JSON.stringify({ name: model.name, via: 'direct-upload' })]
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
        m.processing_status, m.processing_error,
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
        COALESCE(AVG(r.rating), 0) as average_rating
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       WHERE m.id = $1
       GROUP BY m.id, u.artist_name, u.artist_bio, u.artist_url`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Model');
    }

    const model = result.rows[0];

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

    res.json({
      model: {
        ...model,
        images: imagesResult.rows,
        recentReviews: reviewsResult.rows
      }
    });
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

    if (updateFields.length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    updateValues.push(id);

    const result = await db.query(
      `UPDATE models 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramIndex}
       RETURNING id, name, updated_at`,
      updateValues
    );

    logger.info('Model updated', { userId: (req as any).userId, modelId: id });

    res.json({
      message: 'Model updated successfully',
      model: result.rows[0]
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
      `SELECT name, description, thumbnail_path, base_price, status
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

    if (!model.description || model.description.length < 20) {
      throw new ValidationError('Model must have a description (minimum 20 characters)');
    }

    // Publish model
    await db.query(
      `UPDATE models 
       SET status = 'published', 
           visibility = 'public',
           published_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    logger.info('Model published', { userId: (req as any).userId, modelId: id });

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
// DOWNLOAD PURCHASED STL (watermarked per buyer, streamed from R2)
// ============================================================================

router.get('/:id/download',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;

    const model = (await db.query(
      `SELECT id, artist_id, name, stl_file_path, fulfillment_type, processing_status
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
    res.setHeader('Content-Type', 'model/stl');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.stl"`);

    await streamWatermarkedSTL(model.stl_file_path, { modelId: id, buyerId: userId, orderId }, res);

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

    // 4. Fill in the derived fields and flip to ready (still 'draft' for moderation).
    await db.query(
      `UPDATE models SET
         glb_file_path = $1,
         width = $2, depth = $3, height = $4,
         estimated_print_time = $5, estimated_material_cost = $6, supports_required = $7,
         recommended_layer_height = 0.2, recommended_infill = 20,
         file_hash = $8,
         geometry_fingerprint = $9,
         processing_status = 'ready', processing_error = NULL,
         updated_at = NOW()
       WHERE id = $10`,
      [
        glbStoragePath,
        stlData.dimensions.x, stlData.dimensions.y, stlData.dimensions.z,
        Math.round(printEstimate.estimated_time_hours * 60),
        Number(printEstimate.total_cost.toFixed(2)),
        stlData.needsSupports,
        fileHash,
        JSON.stringify(fingerprint),
        modelId,
      ]
    );

    logger.info('Model processed successfully', { modelId });
  } catch (error) {
    logger.error('Model processing failed', { error, modelId });
    await markModelFailed(modelId, (error as Error)?.message?.slice(0, 500) || 'Processing failed');
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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
  const { rows } = await db.query(
    `SELECT id, name, geometry_fingerprint FROM models
     WHERE geometry_fingerprint IS NOT NULL AND id <> $1`,
    [excludeId]
  );
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
