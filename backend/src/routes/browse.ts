// backend/src/routes/browse.ts
// Public browsing, search, and filtering of models

import { Router } from 'express';
import { db } from '../db';
import { logger } from '../utils/logger';
import { optionalAuth } from '../middleware/auth';
import { searchRateLimit } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { ValidationError } from '../middleware/error';

const router = Router();

// ============================================================================
// BROWSE MODELS (Main catalog)
// ============================================================================

router.get('/',
  optionalAuth,
  searchRateLimit,
  asyncHandler(async (req, res) => {
    const {
      category,
      tags,
      minPrice,
      maxPrice,
      sortBy = 'recent',
      page = 1,
      limit = 24,
      search
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    
    // Build WHERE clause
    const conditions: string[] = ["m.status = 'published'", "m.visibility = 'public'"];
    const params: any[] = [];
    let paramIndex = 1;

    // Category filter
    if (category) {
      conditions.push(`m.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    // Tags filter (any of the provided tags)
    if (tags) {
      const tagsArray = typeof tags === 'string' ? tags.split(',') : tags;
      conditions.push(`m.tags && $${paramIndex}::text[]`);
      params.push(tagsArray);
      paramIndex++;
    }

    // Price range
    if (minPrice) {
      conditions.push(`m.base_price >= $${paramIndex}`);
      params.push(Number(minPrice));
      paramIndex++;
    }
    if (maxPrice) {
      conditions.push(`m.base_price <= $${paramIndex}`);
      params.push(Number(maxPrice));
      paramIndex++;
    }

    // Search query (name, description, tags)
    if (search && typeof search === 'string' && search.trim()) {
      conditions.push(`(
        m.name ILIKE $${paramIndex} OR 
        m.description ILIKE $${paramIndex} OR
        EXISTS (SELECT 1 FROM unnest(m.tags) tag WHERE tag ILIKE $${paramIndex})
      )`);
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Determine ORDER BY clause
    let orderBy = 'm.created_at DESC';
    switch (sortBy) {
      case 'recent':
        orderBy = 'm.published_at DESC, m.created_at DESC';
        break;
      case 'popular':
        orderBy = 'm.view_count DESC';
        break;
      case 'sales':
        orderBy = 'm.sale_count DESC';
        break;
      case 'rating':
        orderBy = 'average_rating DESC NULLS LAST';
        break;
      case 'price_low':
        orderBy = 'm.base_price ASC';
        break;
      case 'price_high':
        orderBy = 'm.base_price DESC';
        break;
      case 'name':
        orderBy = 'm.name ASC';
        break;
    }

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(DISTINCT m.id) 
       FROM models m
       WHERE ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);

    // Get models with artist info
    const result = await db.query(
      `SELECT 
        m.id, m.name, m.description, m.category, m.tags,
        m.thumbnail_path, m.base_price,
        m.width, m.height, m.depth,
        m.view_count, m.sale_count,
        m.published_at,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        EXISTS(
          SELECT 1 FROM favorites f 
          WHERE f.model_id = m.id AND f.user_id = $${paramIndex}
        ) as is_favorited
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       WHERE ${whereClause}
       GROUP BY m.id, u.artist_name, u.artist_url
       ORDER BY ${orderBy}
       LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
      [...params, req.userId || null, Number(limit), offset]
    );

    res.json({
      models: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / Number(limit))
      },
      filters: {
        category: category || null,
        tags: tags || null,
        minPrice: minPrice || null,
        maxPrice: maxPrice || null,
        search: search || null,
        sortBy
      }
    });
  })
);

// ============================================================================
// SEARCH SUGGESTIONS (Autocomplete)
// ============================================================================

router.get('/suggestions',
  searchRateLimit,
  asyncHandler(async (req, res) => {
    const { q, limit = 10 } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    const searchTerm = q.trim();

    // Get matching model names and popular tags
    const result = await db.query(
      `(
        SELECT DISTINCT name as suggestion, 'model' as type
        FROM models
        WHERE status = 'published' 
          AND visibility = 'public'
          AND name ILIKE $1
        LIMIT 5
      )
      UNION ALL
      (
        SELECT DISTINCT unnest(tags) as suggestion, 'tag' as type
        FROM models
        WHERE status = 'published' 
          AND visibility = 'public'
          AND EXISTS (
            SELECT 1 FROM unnest(tags) tag WHERE tag ILIKE $1
          )
        LIMIT 5
      )
      LIMIT $2`,
      [`%${searchTerm}%`, Number(limit)]
    );

    res.json({
      suggestions: result.rows
    });
  })
);

// ============================================================================
// GET FEATURED MODELS
// ============================================================================

router.get('/featured',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit = 12 } = req.query;

    // Featured models = highest rated + most sales in last 30 days
    const result = await db.query(
      `SELECT 
        m.id, m.name, m.description, m.category,
        m.thumbnail_path, m.base_price,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        m.sale_count,
        EXISTS(
          SELECT 1 FROM favorites f 
          WHERE f.model_id = m.id AND f.user_id = $1
        ) as is_favorited
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       WHERE m.status = 'published' 
         AND m.visibility = 'public'
         AND m.published_at > CURRENT_DATE - INTERVAL '90 days'
       GROUP BY m.id, u.artist_name, u.artist_url
       HAVING COUNT(DISTINCT r.id) >= 3 AND AVG(r.rating) >= 4.0
       ORDER BY (AVG(r.rating) * 0.6 + (m.sale_count / 100.0) * 0.4) DESC
       LIMIT $2`,
      [req.userId || null, Number(limit)]
    );

    res.json({
      featured: result.rows
    });
  })
);

// ============================================================================
// GET NEW ARRIVALS
// ============================================================================

router.get('/new',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit = 12 } = req.query;

    const result = await db.query(
      `SELECT 
        m.id, m.name, m.description, m.category,
        m.thumbnail_path, m.base_price,
        m.published_at,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        EXISTS(
          SELECT 1 FROM favorites f 
          WHERE f.model_id = m.id AND f.user_id = $1
        ) as is_favorited
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       WHERE m.status = 'published' AND m.visibility = 'public'
       GROUP BY m.id, u.artist_name, u.artist_url
       ORDER BY m.published_at DESC
       LIMIT $2`,
      [req.userId || null, Number(limit)]
    );

    res.json({
      newArrivals: result.rows
    });
  })
);

// ============================================================================
// GET TRENDING MODELS
// ============================================================================

router.get('/trending',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit = 12 } = req.query;

    // Trending = most views in last 7 days
    const result = await db.query(
      `SELECT 
        m.id, m.name, m.description, m.category,
        m.thumbnail_path, m.base_price,
        m.view_count, m.sale_count,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        EXISTS(
          SELECT 1 FROM favorites f 
          WHERE f.model_id = m.id AND f.user_id = $1
        ) as is_favorited
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       WHERE m.status = 'published' 
         AND m.visibility = 'public'
         AND m.published_at > CURRENT_DATE - INTERVAL '30 days'
       GROUP BY m.id, u.artist_name, u.artist_url
       ORDER BY m.view_count DESC
       LIMIT $2`,
      [req.userId || null, Number(limit)]
    );

    res.json({
      trending: result.rows
    });
  })
);

// ============================================================================
// GET CATEGORIES WITH COUNTS
// ============================================================================

router.get('/categories',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT 
        category,
        COUNT(*) as model_count
       FROM models
       WHERE status = 'published' AND visibility = 'public'
       GROUP BY category
       ORDER BY category`
    );

    res.json({
      categories: result.rows
    });
  })
);

// ============================================================================
// GET POPULAR TAGS
// ============================================================================

router.get('/tags',
  asyncHandler(async (req, res) => {
    const { limit = 50 } = req.query;

    const result = await db.query(
      `SELECT 
        unnest(tags) as tag,
        COUNT(*) as usage_count
       FROM models
       WHERE status = 'published' 
         AND visibility = 'public'
         AND tags IS NOT NULL
       GROUP BY tag
       HAVING COUNT(*) >= 3
       ORDER BY usage_count DESC, tag ASC
       LIMIT $1`,
      [Number(limit)]
    );

    res.json({
      tags: result.rows
    });
  })
);

// ============================================================================
// GET RELATED MODELS
// ============================================================================

router.get('/:id/related',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { limit = 6 } = req.query;

    // Get the current model's category and tags
    const modelResult = await db.query(
      `SELECT category, tags FROM models WHERE id = $1`,
      [id]
    );

    if (modelResult.rows.length === 0) {
      res.json({ related: [] });
      return;
    }

    const { category, tags } = modelResult.rows[0];

    // Find related models by category and overlapping tags
    const result = await db.query(
      `SELECT 
        m.id, m.name, m.description, m.category,
        m.thumbnail_path, m.base_price,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        EXISTS(
          SELECT 1 FROM favorites f 
          WHERE f.model_id = m.id AND f.user_id = $1
        ) as is_favorited,
        CASE 
          WHEN m.category = $2 THEN 2
          ELSE 0
        END +
        CASE 
          WHEN m.tags && $3::text[] THEN 1
          ELSE 0
        END as relevance_score
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       WHERE m.status = 'published' 
         AND m.visibility = 'public'
         AND m.id != $4
         AND (m.category = $2 OR m.tags && $3::text[])
       GROUP BY m.id, u.artist_name, u.artist_url
       ORDER BY relevance_score DESC, m.view_count DESC
       LIMIT $5`,
      [req.userId || null, category, tags || [], id, Number(limit)]
    );

    res.json({
      related: result.rows
    });
  })
);

// ============================================================================
// GET PRICE RANGE (For filter UI)
// ============================================================================

router.get('/price-range',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT 
        MIN(base_price) as min_price,
        MAX(base_price) as max_price,
        AVG(base_price) as avg_price
       FROM models
       WHERE status = 'published' AND visibility = 'public'`
    );

    res.json({
      priceRange: {
        min: parseFloat(result.rows[0].min_price || 0),
        max: parseFloat(result.rows[0].max_price || 100),
        avg: parseFloat(result.rows[0].avg_price || 20)
      }
    });
  })
);

// ============================================================================
// CATALOG STATS (For homepage)
// ============================================================================

router.get('/stats',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT 
        COUNT(DISTINCT m.id) as total_models,
        COUNT(DISTINCT m.artist_id) as total_artists,
        COUNT(DISTINCT c.category) as total_categories,
        SUM(m.sale_count) as total_sales
       FROM models m
       CROSS JOIN (SELECT DISTINCT category FROM models WHERE status = 'published') c
       WHERE m.status = 'published' AND m.visibility = 'public'`
    );

    res.json({
      stats: result.rows[0]
    });
  })
);

export default router;