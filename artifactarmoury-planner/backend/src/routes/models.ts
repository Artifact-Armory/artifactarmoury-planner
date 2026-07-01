// backend/src/routes/models.ts
// Artist model management: upload, update, delete models

import { Router } from 'express';
import path from 'path';
import { db } from '../db';
import logger from '../utils/logger';
import { 
  authenticate, 
  requireArtist, 
  requireModelOwnership,
  optionalAuth,
  requireAdmin
} from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
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
import { ValidationError, NotFoundError, AuthorizationError, ConflictError } from '../middleware/error';
import { processSTL, generateGLB, parseSTL, calculateAABB, calculateFootprint, calculatePrintStats, convertGLBtoSTL } from '../services/fileProcessor';
import { estimatePrintCost } from '../services/printEstimator';
import { uploadToStorage, deleteFromStorage } from '../services/storage';
import {
  buildWatermarkPayload,
  embedStlWatermark,
  stampGlbMetadata,
  watermarkPreviewImage,
  buildMeshFeatureVector,
  deriveFingerprintSignature,
} from '../services/watermark';
import { findSimilarModels } from '../services/modelSimilarity';
import {
  MockModel,
  addMockModel,
  createMockModelId,
  findMockModel,
  updateMockModel,
  listMockModels,
  deleteMockModel,
  addMockWatermark,
  findMockWatermark,
} from '../mock/mockModels';

const router = Router();
const IS_MOCK_DB = process.env.DB_MOCK === 'true';

const VALID_LICENSES = [
  'cc0',
  'cc-by',
  'cc-by-sa',
  'cc-by-nd',
  'cc-by-nc',
  'standard-commercial',
  'personal-use',
] as const;

type LicenseCode = (typeof VALID_LICENSES)[number];

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

    const { name, description, category, tags, basePrice, license, decimationLevel } = req.body;

    // Validate required fields
    if (!name || !category || !basePrice || !license) {
      // Cleanup uploaded files
      await deleteUploadedFile(modelFile.path);
      if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);

      throw new ValidationError('Name, category, base price, and license are required');
    }

    // Validate decimationLevel if provided (0-90, default 0)
    let decimation = 0;
    if (decimationLevel !== undefined) {
      const level = parseInt(decimationLevel, 10);
      if (isNaN(level) || level < 0 || level > 90) {
        await deleteUploadedFile(modelFile.path);
        if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
        throw new ValidationError('decimationLevel must be between 0 and 90');
      }
      decimation = level;
    }

    if (!thumbnailFile) {
      await deleteUploadedFile(modelFile.path);
      throw new ValidationError('Please upload at least one image for your model.');
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

    const normalizedLicense = String(license).toLowerCase();
    if (!VALID_LICENSES.includes(normalizedLicense as LicenseCode)) {
      await deleteUploadedFile(modelFile.path);
      if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
      throw new ValidationError('Invalid license selection');
    }

    const tempArtefacts: string[] = [];

    try {
      const watermarkPayload = buildWatermarkPayload({
        artistId: (req as any).userId,
        platformId: 'artifact-armoury-planner',
        uploadIp: req.ip,
      });

      const originalStl = await parseSTL(modelFile.path);
      const originalAABB = calculateAABB(originalStl);
      const originalFootprint = calculateFootprint(originalAABB);
      const originalStats = calculatePrintStats(originalStl, originalAABB);
      const originalFeatureVector = buildMeshFeatureVector(
        originalStats.volume_mm3 ?? 0,
        originalStats.surface_area_mm2 ?? 0,
        {
          x: originalFootprint.width,
          y: originalFootprint.depth,
          z: originalFootprint.height,
        },
        originalStl.triangleCount,
      );

      const fingerprintSignature = deriveFingerprintSignature(originalFeatureVector);

      // Check for duplicates (mock or real database)
      let existingModelId: string | undefined;

      if (IS_MOCK_DB) {
        existingModelId = findMockWatermark(fingerprintSignature);
      } else {
        const duplicateModel = await db.query(
          `SELECT model_id FROM model_watermarks WHERE hash_signature = $1`,
          [fingerprintSignature]
        );
        if (duplicateModel.rows.length > 0) {
          existingModelId = duplicateModel.rows[0].model_id;
        }
      }

      if (existingModelId) {
        logger.warn('Duplicate model detected', {
          userId: (req as any).userId,
          hashSignature: fingerprintSignature,
          existingModelId,
        });
        throw new ConflictError('This model has already been uploaded to Artifact Armoury.');
      }

      logger.info('Duplicate check passed', {
        userId: (req as any).userId,
        hashSignature: fingerprintSignature,
      });

      const { triangleCount } = await embedStlWatermark(modelFile.path, watermarkPayload);

      // Process STL file
      logger.info('Processing STL file', { userId: (req as any).userId, filename: modelFile.filename });
      const stlData = await processSTL(modelFile.path);

      // Generate GLB for 3D preview with compression
      logger.info('Generating GLB preview with compression', {
        userId: (req as any).userId,
        decimationLevel: decimation,
      });
      const glbPath = await generateGLB(modelFile.path, {
        enableDraco: true,
        dracoLevel: 7, // High compression
      });
      await stampGlbMetadata(glbPath, watermarkPayload);

      // Upload files to storage
      // Note: We only store the GLB file (which is already compressed with Draco)
      // The original STL is not stored to save disk space (38MB -> 19MB savings)
      // The GLB contains all the geometry data needed for 3D preview and printing
      const glbStoragePath = await uploadToStorage(glbPath, 'previews');
      // Use GLB path for both STL and GLB references (GLB is the canonical format)
      const stlStoragePath = glbStoragePath;

      let thumbnailStoragePath = null;
      if (thumbnailFile) {
        await watermarkPreviewImage(thumbnailFile.path, watermarkPayload);
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

      if (IS_MOCK_DB) {
        const mockId = createMockModelId();
        const mockEntry: MockModel = {
          id: mockId,
          name,
          description: description || null,
          category,
          tags: tagsArray,
          stlFilePath: stlStoragePath,
          glbFilePath: glbStoragePath,
          thumbnailPath: thumbnailStoragePath,
          license: normalizedLicense,
          price,
          createdAt: new Date().toISOString(),
          status: 'draft',
          visibility: 'private',
          inLibrary: false,
        };

        const userId = (req as any).userId as string;
        addMockModel(userId, mockEntry);

        // Store watermark for duplicate detection
        addMockWatermark(fingerprintSignature, mockId);

        logger.info('Mock model created (DB_MOCK)', {
          userId,
          modelId: mockId,
          name,
          hashSignature: fingerprintSignature,
        });

        res.status(201).json({
          message: 'Model processed successfully (mock mode)',
          model: {
            ...mockEntry,
          },
        });
        return;
      }

      // Create model in database
      const result = await db.query(
        `INSERT INTO models (
          artist_id, name, description, category, tags,
          stl_file_path, glb_file_path, thumbnail_path, license,
          width, depth, height,
          base_price, estimated_print_time, estimated_material_cost,
          supports_required, recommended_layer_height, recommended_infill,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'draft')
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
          normalizedLicense,
          stlData.dimensions.x,
          stlData.dimensions.y,
          stlData.dimensions.z,
          price,
          Math.round(printEstimate.estimated_time_hours * 60),
          Number(printEstimate.total_cost.toFixed(2)),
          stlData.needsSupports,
          0.2, // Default layer height
          20,  // Default infill
        ]
      );

      const model = result.rows[0];

      const featureVector = originalFeatureVector;

      await db.query(
        `INSERT INTO model_watermarks (
          model_id,
          artist_id,
          watermark_token,
          metadata,
          hash_signature
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          model.id,
          (req as any).userId,
          watermarkPayload.watermarkId,
          JSON.stringify({
            embeddedAt: watermarkPayload.embeddedAt,
            platformId: watermarkPayload.platformId,
            featureVector,
            triangleCount,
            volume: stlData.volume,
            surfaceArea: stlData.surfaceArea,
            fingerprintSignature,
          }),
          fingerprintSignature,
        ]
      );

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
          createdAt: model.created_at,
          license: normalizedLicense,
        }
      });

    } catch (error) {
      // Cleanup uploaded files on error
      await deleteUploadedFile(modelFile.path);
      if (thumbnailFile) await deleteUploadedFile(thumbnailFile.path);
      for (const tempPath of tempArtefacts) {
        await deleteUploadedFile(tempPath);
      }

      if (error instanceof ConflictError || (error as any)?.code === '23505') {
        logger.warn('Duplicate model upload detected after processing', {
          userId: (req as any).userId,
        });
        throw new ConflictError('This model has already been uploaded to Artifact Armoury.');
      }

      logger.error('Failed to create model', { error, userId: (req as any).userId });
      throw error;
    }
  }),
  cleanupOnError
);

// ============================================================================
// GET MY MODELS (Artist's own models)
// ============================================================================

router.get('/my-models',
  authenticate,
  requireArtist,
  asyncHandler(async (req, res) => {
    const { status, page = 1, limit = 20 } = req.query;

    if (IS_MOCK_DB) {
      const userId = (req as any).userId as string;
      const allModels = listMockModels(userId);

      const filtered = typeof status === 'string'
        ? allModels.filter((model) => model.status === status)
        : allModels;

      const start = (Number(page) - 1) * Number(limit);
      const paged = filtered.slice(start, start + Number(limit));

      res.json({
       models: paged.map((model) => ({
         id: model.id,
         name: model.name,
         description: model.description,
         category: model.category,
         tags: model.tags,
         thumbnail_path: model.thumbnailPath,
         base_price: model.price,
         license: model.license,
         status: model.status,
         visibility: model.visibility,
          stl_file_path: model.stlFilePath,
          glb_file_path: model.glbFilePath,
          view_count: 0,
          download_count: 0,
          sale_count: 0,
          width: null,
          height: null,
          depth: null,
          created_at: model.createdAt,
          updated_at: model.createdAt,
          published_at: model.status === 'published' ? model.createdAt : null,
          review_count: 0,
          average_rating: 0,
          in_library: model.inLibrary,
          asset_id: null,
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: filtered.length,
          pages: Math.ceil(filtered.length / Number(limit)),
        }
      });
      return;
    }

    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE m.artist_id = $1';
    const params: any[] = [(req as any).userId];

    if (status) {
      whereClause += ' AND m.status = $2';
      params.push(status);
    }

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM models m ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);

    // Get models
    const result = await db.query(
      `SELECT
        m.id, m.name, m.description, m.category, m.tags,
        m.thumbnail_path, m.base_price, m.license, m.status, m.visibility,
        EXISTS (
          SELECT 1 FROM assets a
          WHERE a.file_ref = m.stl_file_path
        ) AS in_library,
        a.id AS asset_id,
        m.view_count, m.download_count, m.sale_count,
        m.width, m.height, m.depth,
        m.created_at, m.updated_at, m.published_at,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating
       FROM models m
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       LEFT JOIN assets a ON a.file_ref = m.stl_file_path
       ${whereClause}
       GROUP BY m.id, a.id
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
// DOWNLOAD MODEL (For customers who purchased)
// ============================================================================

router.get('/:id/download',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;

    // Check if user has purchased this model
    const purchaseResult = await db.query(
      `SELECT DISTINCT m.id, m.name, m.stl_file_path
       FROM models m
       JOIN order_items oi ON m.id = oi.model_id
       JOIN orders o ON oi.order_id = o.id
       WHERE m.id = $1 AND o.user_id = $2 AND o.payment_status = 'succeeded'
       LIMIT 1`,
      [id, userId]
    );

    if (purchaseResult.rows.length === 0) {
      throw new AuthorizationError('You have not purchased this model');
    }

    const model = purchaseResult.rows[0];

    if (!model.stl_file_path) {
      throw new ValidationError('Model does not have a file available for download');
    }

    try {
      // Get full path to original STL file
      const stlFullPath = path.isAbsolute(model.stl_file_path)
        ? model.stl_file_path
        : path.join(process.cwd(), 'uploads', model.stl_file_path);

      // Generate download filename
      const downloadFilename = `${model.name.replace(/[^a-z0-9]/gi, '_')}.stl`;

      logger.info('Serving STL file for download', { stlFullPath, modelId: id });

      // Send file
      res.download(stlFullPath, downloadFilename, (err) => {
        if (err) {
          logger.error('Download error', { error: err, modelId: id });
        } else {
          logger.info('Model downloaded successfully', { modelId: id });
          // Increment download count
          db.query('UPDATE models SET download_count = download_count + 1 WHERE id = $1', [id])
            .catch(err => logger.error('Failed to increment download count', { error: err }));
        }
      });
    } catch (error) {
      logger.error('Failed to serve model download', { error, modelId: id });
      throw new Error('Failed to prepare model for download');
    }
  })
);

// ============================================================================
// GET SINGLE MODEL (Detailed view)
// ============================================================================

router.get('/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (IS_MOCK_DB) {
      const userId = (req as any).userId as string | undefined;
      const allModels = listMockModels();
      const model = allModels.find((m) => m.id === id);

      if (!model) {
        throw new NotFoundError('Model');
      }

      if (model.status !== 'published') {
        // Allow owner or admin to view drafts
        if (!userId) {
          throw new NotFoundError('Model');
        }
        const owned = listMockModels(userId).some((m) => m.id === id);
        const isAdmin = (req as any).user?.role === 'admin';
        if (!owned && !isAdmin) {
          throw new NotFoundError('Model');
        }
      }

      res.json({
        model: {
          ...model,
          stl_file_path: model.stlFilePath,
          glb_file_path: model.glbFilePath,
          thumbnail_path: model.thumbnailPath,
          license: model.license,
          visibility: model.visibility,
          in_library: model.inLibrary,
          images: [],
          recentReviews: [],
          artist_name: 'Mock Artist',
          artist_bio: null,
          artist_url: null,
          creator_verified: true,
          verification_badge: 'Mock',
          review_count: 0,
          average_rating: 0,
        },
      });
      return;
    }

    const result = await db.query(
      `SELECT 
        m.*,
        u.artist_name, u.artist_bio, u.artist_url,
        u.creator_verified, u.verification_badge,
        EXISTS (
          SELECT 1 FROM assets a WHERE a.file_ref = m.stl_file_path
        ) AS in_library,
        a.id AS asset_id,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       LEFT JOIN assets a ON a.file_ref = m.stl_file_path
       WHERE m.id = $1
       GROUP BY m.id, u.artist_name, u.artist_bio, u.artist_url, u.creator_verified, u.verification_badge, a.id`,
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
// FIND SIMILAR MODELS (Admin tooling)
// ============================================================================

router.get('/:id/similar',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const watermarkResult = await db.query(
      `SELECT watermark_token, hash_signature, metadata
       FROM model_watermarks
       WHERE model_id = $1`,
      [id]
    );

    if (watermarkResult.rows.length === 0) {
      throw new NotFoundError('Watermark metadata');
    }

    const watermarkRow = watermarkResult.rows[0];
    const metadata = watermarkRow.metadata || {};
    const vector = Array.isArray(metadata?.featureVector) ? metadata.featureVector : null;

    if (!vector) {
      logger.warn('Watermark metadata missing feature vector', { modelId: id });
      return res.json({
        modelId: id,
        watermark: {
          watermarkToken: watermarkRow.watermark_token,
          hashSignature: watermarkRow.hash_signature,
          metadata,
        },
        matches: [],
      });
    }

    const matches = await findSimilarModels(vector, {
      excludeModelId: id,
      limit: 15,
      minSimilarity: 0.93,
    });

    res.json({
      modelId: id,
      watermark: {
        watermarkToken: watermarkRow.watermark_token,
        hashSignature: watermarkRow.hash_signature,
        metadata,
      },
      matches,
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

    if (updates.license !== undefined) {
      const normalized = String(updates.license).toLowerCase();
      if (!VALID_LICENSES.includes(normalized as LicenseCode)) {
        throw new ValidationError('Invalid license selection');
      }
      updates.license = normalized;
    }

    const allowedFields = [
      'name', 'description', 'category', 'tags', 'base_price',
      'supports_required', 'recommended_layer_height', 'recommended_infill', 'license'
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

    if (IS_MOCK_DB) {
      const userId = (req as any).userId as string;
      const models = listMockModels(userId);
      const target = models.find((model) => model.id === id);

      if (!target) {
        throw new NotFoundError('Model');
      }

      if (!target.thumbnailPath) {
        throw new ValidationError('Model must have a thumbnail before publishing');
      }

      if (!target.description || target.description.length < 20) {
        throw new ValidationError('Model must have a description (minimum 20 characters)');
      }

      if (target.status === 'published') {
        res.json({ message: 'Model published successfully', modelId: id });
        return;
      }

      updateMockModel(id, (model) => {
        model.status = 'published';
        model.visibility = 'public';
      });

      logger.info('Mock model published', { userId, modelId: id });

      res.json({
        message: 'Model published successfully',
        modelId: id,
      });
      return;
    }

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

    if (IS_MOCK_DB) {
      const userId = (req as any).userId as string;
      const models = listMockModels(userId);
      const target = models.find((model) => model.id === id);

      if (!target) {
        throw new NotFoundError('Model');
      }

      updateMockModel(id, (model) => {
        model.status = 'draft';
        model.visibility = 'private';
      });

      logger.info('Mock model unpublished', { userId, modelId: id });

      res.json({
        message: 'Model unpublished successfully',
        modelId: id,
      });
      return;
    }

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
// ADD MODEL TO ASSET LIBRARY
// ============================================================================

router.post('/:id/library',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params

    if (IS_MOCK_DB) {
      const lookup = findMockModel(id);
      if (!lookup) {
        throw new NotFoundError('Model');
      }

      const isOwner = req.userId === lookup.ownerId;
      const isAdmin = req.user?.role === 'admin';
      const isPublished = lookup.model.status === 'published' && lookup.model.visibility === 'public';

      if (!isPublished && !isOwner && !isAdmin) {
        throw new AuthorizationError('This model is not available in the public catalogue.');
      }

      if (!lookup.model.glbFilePath) {
        throw new ValidationError('This model does not have a preview file available yet.');
      }

      if (lookup.model.inLibrary) {
        res.json({
          message: 'Model already available in the asset library',
          asset: {
            id: `mock-asset-${lookup.model.id}`,
            status: 'published',
            visibility: lookup.model.visibility,
          },
          alreadyExists: true,
        });
        return;
      }

      updateMockModel(id, (model) => {
        model.inLibrary = true;
      });

      res.json({
        message: 'Model added to asset library (mock mode)',
        asset: {
          id: `mock-asset-${lookup.model.id}`,
          status: 'published',
          visibility: lookup.model.visibility,
        },
        alreadyExists: false,
      });
      return;
    }

    const modelResult = await db.query(
      `SELECT id, artist_id, name, description, category, tags,
              stl_file_path, glb_file_path, thumbnail_path,
              base_price, status, visibility, width, depth, height
       FROM models
       WHERE id = $1`,
      [id]
    )

    if (modelResult.rows.length === 0) {
      throw new NotFoundError('Model')
    }

    const model = modelResult.rows[0]

    const isOwner = req.userId === model.artist_id
    const isAdmin = req.user?.role === 'admin'
    const isPublished = model.status === 'published' && model.visibility === 'public'

    if (!isPublished && !isOwner && !isAdmin) {
      throw new AuthorizationError('This model is not available in the public catalogue.')
    }

    if (!model.glb_file_path) {
      throw new ValidationError('This model does not have a preview file available yet.')
    }

    const existingAsset = await db.query(
      `SELECT id, status, visibility FROM assets WHERE file_ref = $1`,
      [model.stl_file_path]
    )

    if (existingAsset.rows.length > 0) {
      const asset = existingAsset.rows[0]
      await db.query(
        `UPDATE models
         SET in_library = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id],
      )
      res.status(200).json({
        message: 'Model already available in the asset library',
        asset: {
          id: asset.id,
          status: asset.status,
          visibility: asset.visibility,
        },
        alreadyExists: true,
      })
      return
    }

    const assetResult = await db.query(
      `INSERT INTO assets (
         artist_id, name, description, category, tags,
         file_ref, glb_file_path, preview_url, thumbnail_path,
         base_price, status, visibility, width, depth, height
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'published', 'public', $11, $12, $13)
       RETURNING id, name, status, visibility, created_at`,
      [
        model.artist_id,
        model.name,
        model.description,
        model.category,
        model.tags,
        model.stl_file_path,
        model.glb_file_path,
        model.glb_file_path,
        model.thumbnail_path,
        model.base_price,
        model.width,
        model.depth,
        model.height,
      ]
    )

    await db.query(
      `UPDATE models
       SET in_library = TRUE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id],
    )

    logger.info('Model added to asset library', {
      userId: (req as any).userId,
      modelId: id,
      assetId: assetResult.rows[0].id,
    })

    res.status(201).json({
      message: 'Model added to asset library',
      asset: assetResult.rows[0],
      alreadyExists: false,
    })
  })
)

// ============================================================================
// DELETE MODEL
// ============================================================================

router.delete('/:id',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (IS_MOCK_DB) {
      const deleted = deleteMockModel(id);

      if (!deleted) {
        throw new NotFoundError('Model');
      }

      logger.info('Mock model deleted', { userId: (req as any).userId, modelId: id });

      res.json({
        message: 'Model deleted successfully',
        modelId: id
      });
      return;
    }

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

    // Delete watermark first (explicitly, before model deletion)
    const watermarkResult = await db.query(
      'DELETE FROM model_watermarks WHERE model_id = $1 RETURNING hash_signature',
      [id]
    );

    if (watermarkResult.rows.length > 0) {
      logger.info('Deleted model watermark', {
        modelId: id,
        hashSignature: watermarkResult.rows[0].hash_signature
      });
    }

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

export default router;
