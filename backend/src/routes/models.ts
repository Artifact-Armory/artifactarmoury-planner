// backend/src/routes/models.ts
// Artist model management: upload, update, delete models

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import {
  authenticate,
  requireArtist,
  requireModelOwnership,
  optionalAuth,
  AuthRequest,
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
import { processSTL, generateGLB } from '../services/fileProcessor';
import { estimatePrintCost } from '../services/printEstimator';
import { uploadToStorage, deleteFromStorage } from '../services/storage';
import {
  MockModel,
  addMockModel,
  createMockModelId,
  findMockModel,
  updateMockModel,
  listMockModels,
} from '../mock/mockModels';

const router = Router();
const IS_MOCK_DB = process.env.DB_MOCK === 'true';

const DEFAULT_LICENSE = 'standard';

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

      if (IS_MOCK_DB) {
        const mockId = createMockModelId();
        const createdAt = new Date().toISOString();
        const mockEntry: MockModel = {
          id: mockId,
          name,
          description: description || null,
          category,
          tags: tagsArray,
          stlFilePath: stlStoragePath,
          glbFilePath: glbStoragePath,
          thumbnailPath: thumbnailStoragePath,
          license: DEFAULT_LICENSE,
          price,
          createdAt,
          status: 'draft',
          visibility: 'private',
          inLibrary: false,
        };

        const userId = (req as any).userId as string;
        addMockModel(userId, mockEntry);

        logger.info('Mock model created', {
          userId,
          modelId: mockId,
          name,
        });

        res.status(201).json({
          message: 'Model created successfully (mock mode)',
          model: {
            id: mockId,
            name,
            status: 'draft',
            createdAt,
          },
        });
        return;
      }

      // Create model in database
      const result = await db.query(
        `INSERT INTO models (
          artist_id, name, description, category, tags,
          stl_file_path, glb_file_path, thumbnail_path,
          width, depth, height,
          base_price, estimated_print_time, estimated_material_cost,
          supports_required, recommended_layer_height, recommended_infill,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'draft')
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
          0.2, // Default layer height
          20,  // Default infill
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
          artist_id: userId,
          name: model.name,
          description: model.description,
          category: model.category,
          tags: model.tags,
          thumbnail_path: model.thumbnailPath,
          glb_file_path: model.glbFilePath,
          base_price: model.price,
          status: model.status,
          visibility: model.visibility,
          in_library: model.inLibrary,
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
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: filtered.length,
          pages: Math.ceil(filtered.length / Number(limit)) || 1,
        },
      });
      return;
    }

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
        m.id, m.artist_id, m.name, m.description, m.category, m.tags,
        m.thumbnail_path, m.glb_file_path, m.base_price, m.status, m.visibility,
        m.in_library,
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

    if (IS_MOCK_DB) {
      const userId = (req as any).userId as string | undefined;
      const allModels = listMockModels();
      const model = allModels.find((m) => m.id === id);

      if (!model) {
        throw new NotFoundError('Model');
      }

      if (model.status !== 'published') {
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

    if (IS_MOCK_DB) {
      const lookup = findMockModel(id);
      if (!lookup) {
        throw new NotFoundError('Model');
      }

      const { model } = lookup;

      if (!model.thumbnailPath) {
        throw new ValidationError('Model must have a thumbnail before publishing');
      }

      if (!model.description || model.description.length < 20) {
        throw new ValidationError('Model must have a description (minimum 20 characters)');
      }

      updateMockModel(id, (draft) => {
        draft.status = 'published';
        draft.visibility = 'public';
      });

      logger.info('Mock model published', { userId: (req as any).userId, modelId: id });

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
      const updated = updateMockModel(id, (draft) => {
        draft.status = 'draft';
        draft.visibility = 'private';
        draft.inLibrary = false;
      });

      if (!updated) {
        throw new NotFoundError('Model');
      }

      logger.info('Mock model unpublished', { userId: (req as any).userId, modelId: id });

      res.json({
        message: 'Model unpublished successfully',
        modelId: id,
      });
      return;
    }

    await db.query(
      `UPDATE models 
       SET status = 'draft', visibility = 'private', in_library = false
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
// ADD MODEL TO BUILDER LIBRARY
// ============================================================================

router.post('/:id/library',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    if (IS_MOCK_DB) {
      const lookup = findMockModel(id);
      if (!lookup) {
        throw new NotFoundError('Model');
      }

      const { ownerId, model } = lookup;
      const isOwner = req.userId === ownerId;
      const isAdmin = req.user?.role === 'admin';
      const isPublished = model.status === 'published' && model.visibility === 'public';

      if (!isPublished && !isOwner && !isAdmin) {
        throw new AuthorizationError('This model is not available in the public catalogue.');
      }

      if (!model.glbFilePath) {
        throw new ValidationError('Generate a 3D preview before adding this model to the asset library');
      }

      if (model.inLibrary) {
        res.json({
          message: 'Model already available in the asset library',
          asset: {
            id: `mock-asset-${model.id}`,
            status: 'published',
            visibility: model.visibility,
          },
          alreadyInLibrary: true,
          inLibrary: true,
        });
        return;
      }

      updateMockModel(id, (draft) => {
        draft.inLibrary = true;
      });

      logger.info('Mock model added to asset library', {
        userId: req.userId,
        modelId: id,
      });

      res.status(200).json({
        message: 'Model added to asset library (mock mode)',
        asset: {
          id: `mock-asset-${model.id}`,
          status: 'published',
          visibility: model.visibility,
        },
        alreadyInLibrary: false,
        inLibrary: true,
      });
      return;
    }

    const result = await db.query(
      `SELECT 
         id,
         artist_id,
         name,
         description,
         category,
         tags,
         stl_file_path,
         glb_file_path,
         thumbnail_path,
         base_price,
         status,
         visibility,
         width,
         depth,
         height,
         published_at,
         in_library
       FROM models
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Model');
    }

    const model = result.rows[0];

    if (model.in_library) {
      res.json({
        message: 'Model already added to the asset library',
        asset: { id, modelId: id },
        alreadyInLibrary: true
      });
      return;
    }

    if (model.status !== 'published') {
      throw new ValidationError('Publish the model before adding it to the asset library');
    }

    if (model.visibility !== 'public') {
      throw new ValidationError('Model must be public to use it in the asset library');
    }

    if (!model.glb_file_path) {
      throw new ValidationError('Generate a 3D preview before adding this model to the asset library');
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const publishedAt = model.published_at ?? new Date();

      const assetResult = await client.query(
        `INSERT INTO assets (
           model_id,
           artist_id,
           name,
           description,
           category,
           tags,
           file_ref,
           glb_file_path,
           preview_url,
           thumbnail_path,
           base_price,
           width,
           depth,
           height,
           status,
           visibility,
           published_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'published', 'public', $15
         )
         ON CONFLICT (model_id) DO UPDATE SET
           artist_id = EXCLUDED.artist_id,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           tags = EXCLUDED.tags,
           file_ref = EXCLUDED.file_ref,
           glb_file_path = EXCLUDED.glb_file_path,
           preview_url = EXCLUDED.preview_url,
           thumbnail_path = EXCLUDED.thumbnail_path,
           base_price = EXCLUDED.base_price,
           width = EXCLUDED.width,
           depth = EXCLUDED.depth,
           height = EXCLUDED.height,
           status = EXCLUDED.status,
           visibility = EXCLUDED.visibility,
           published_at = EXCLUDED.published_at,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id, status, visibility`,
        [
          id,
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
          publishedAt,
        ]
      );

      const update = await client.query(
        `UPDATE models
         SET in_library = true,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING in_library`,
        [id]
      );

      await client.query('COMMIT');

      logger.info('Model added to asset library', {
        userId: req.userId,
        modelId: id,
        assetId: assetResult.rows[0].id,
      });

      res.status(200).json({
        message: 'Model added to asset library',
        asset: {
          id: assetResult.rows[0].id,
          modelId: id,
          status: assetResult.rows[0].status,
          visibility: assetResult.rows[0].visibility,
        },
        alreadyInLibrary: false,
        inLibrary: update.rows[0].in_library,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

export default router;
