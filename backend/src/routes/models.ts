// backend/src/routes/models.ts
// Artist model management: upload, update, delete models

import { Router } from 'express';
import { db } from '../db';
import { logger } from '../utils/logger';
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
import { processSTL, generateGLB } from '../services/fileProcessor';
import { estimatePrintCost } from '../services/printEstimator';
import { uploadToStorage, deleteFromStorage } from '../services/storage';

const router = Router();

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
      logger.info('Processing STL file', { userId: req.userId, filename: modelFile.filename });
      const stlData = await processSTL(modelFile.path);

      // Generate GLB for 3D preview
      logger.info('Generating GLB preview', { userId: req.userId });
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
        volume: stlData.volume,
        surfaceArea: stlData.surfaceArea,
        dimensions: stlData.dimensions
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
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'draft')
        RETURNING id, name, created_at`,
        [
          req.userId,
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
          printEstimate.estimatedTime,
          printEstimate.estimatedCost,
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
        [req.userId, model.id, JSON.stringify({ name: model.name })]
      );

      logger.info('Model created', { 
        userId: req.userId, 
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
      
      logger.error('Failed to create model', { error, userId: req.userId });
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

    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = 'WHERE artist_id = $1';
    const params: any[] = [req.userId];

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
      if (!req.userId || (req.userId !== model.artist_id && req.user?.role !== 'admin')) {
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

    logger.info('Model updated', { userId: req.userId, modelId: id });

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

    logger.info('Model published', { userId: req.userId, modelId: id });

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

    logger.info('Model unpublished', { userId: req.userId, modelId: id });

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

    logger.info('Model deleted', { userId: req.userId, modelId: id });

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
        userId: req.userId, 
        modelId: id, 
        count: files.length 
      });

      res.status(201).json({
        message: 'Images uploaded successfully',
        images: uploadedImages
      });

    } catch (error) {
      logger.error('Failed to upload model images', { error, userId: req.userId });
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