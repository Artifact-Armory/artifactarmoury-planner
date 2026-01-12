// backend/src/routes/browse.ts
// Public browsing, search, and filtering of models

import { Router } from 'express';
import { db } from '../db';
import { optionalAuth } from '../middleware/auth';
import { searchRateLimit } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { listMockModels, MockModel, findMockModel } from '../mock/mockModels';

const router = Router();
const IS_MOCK_DB = process.env.DB_MOCK === 'true';

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

const mapMockModelToResponse = (model: MockModel) => ({
  id: model.id,
  name: model.name,
  description: model.description,
  category: model.category,
  tags: model.tags,
  thumbnail_path: model.thumbnailPath,
  base_price: model.price,
  license: model.license,
  width: null,
  height: null,
  depth: null,
  view_count: 0,
  sale_count: 0,
  published_at: model.status === 'published' ? model.createdAt : null,
  status: model.status,
  visibility: model.visibility,
  glb_file_path: model.glbFilePath,
  artist_name: 'Mock Artist',
  artist_url: null,
  creator_verified: true,
  verification_badge: 'Mock',
  review_count: 0,
  average_rating: 0,
  is_favorited: false,
  in_library: model.inLibrary,
  asset_id: model.inLibrary ? `mock-asset-${model.id}` : null,
});

const getPublishedMockModels = () =>
  listMockModels().filter(
    (model) => model.status === 'published' && model.visibility === 'public'
  );

const sortMockModels = (models: MockModel[], sortBy: string) => {
  const sorted = [...models];
  const byDateDesc = (a: MockModel, b: MockModel) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  switch (sortBy) {
    case 'recent':
    case 'trending':
      sorted.sort(byDateDesc);
      break;
    case 'price_low':
      sorted.sort((a, b) => a.price - b.price);
      break;
    case 'price_high':
      sorted.sort((a, b) => b.price - a.price);
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    default:
      sorted.sort(byDateDesc);
      break;
  }

  return sorted;
};

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

    if (IS_MOCK_DB) {
      const pageNumber = Number(page) || 1;
      const limitNumber = Number(limit) || 24;

      const categoryValue = Array.isArray(category)
        ? toStringValue(category[0])
        : toStringValue(category);

      const toNumber = (value: unknown): number | undefined => {
        const raw = Array.isArray(value) ? value[0] : value;
        if (raw === undefined || raw === null) return undefined;
        const stringValue = toStringValue(raw);
        if (stringValue === undefined || stringValue.trim() === '') return undefined;
        const parsed = Number(stringValue);
        return Number.isNaN(parsed) ? undefined : parsed;
      };

      const min = toNumber(minPrice);
      const max = toNumber(maxPrice);

      const searchValue = Array.isArray(search)
        ? toStringValue(search[0]) ?? ''
        : toStringValue(search) ?? '';
      const searchTerm = searchValue.trim().toLowerCase();

      const tagFilters: string[] = (() => {
        const raw = tags;
        if (Array.isArray(raw)) {
          return raw
            .map((tag) => toStringValue(tag))
            .filter((tag): tag is string => Boolean(tag))
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        }
        const tagString = toStringValue(raw);
        if (tagString) {
          return tagString
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        }
        return [];
      })();

      const filtered = getPublishedMockModels().filter((model) => {
        if (categoryValue && model.category !== categoryValue) {
          return false;
        }

        if (tagFilters.length) {
          const modelTags = model.tags.map((tag) => tag.toLowerCase());
          const matchesAll = tagFilters.every((tag) =>
            modelTags.includes(tag.toLowerCase())
          );
          if (!matchesAll) {
            return false;
          }
        }

        if (min !== undefined && model.price < min) {
          return false;
        }
        if (max !== undefined && model.price > max) {
          return false;
        }

        if (searchTerm) {
          const inName = model.name.toLowerCase().includes(searchTerm);
          const inDescription = (model.description ?? '').toLowerCase().includes(searchTerm);
          const inTags = model.tags.some((tag) =>
            tag.toLowerCase().includes(searchTerm)
          );
          if (!inName && !inDescription && !inTags) {
            return false;
          }
        }

        return true;
      });

      const sorted = sortMockModels(filtered, String(sortBy));
      const start = (pageNumber - 1) * limitNumber;
      const paged = sorted.slice(start, start + limitNumber);

      res.json({
        models: paged.map(mapMockModelToResponse),
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total: filtered.length,
          pages: Math.ceil(filtered.length / limitNumber) || 1,
        },
        filters: {
          category: categoryValue ?? null,
          tags: tagFilters.length ? tagFilters : null,
          minPrice: min ?? null,
          maxPrice: max ?? null,
          search: searchTerm || null,
          sortBy,
        },
      });
      return;
    }

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
        m.thumbnail_path, m.base_price, m.glb_file_path,
        m.width, m.height, m.depth,
        m.view_count, m.sale_count,
        m.published_at,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        EXISTS(
          SELECT 1 FROM favorites f
          WHERE f.model_id = m.id AND f.user_id = $${paramIndex}
        ) as is_favorited,
        EXISTS(
          SELECT 1 FROM assets a
          WHERE a.file_ref = m.stl_file_path
        ) as in_library,
        a.id as asset_id
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       LEFT JOIN assets a ON a.file_ref = m.stl_file_path
       WHERE ${whereClause}
       GROUP BY m.id, m.glb_file_path, u.artist_name, u.artist_url, a.id
       ORDER BY ${orderBy}
       LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
      [...params, (req as any).userId || null, Number(limit), offset]
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

    if (IS_MOCK_DB) {
      const suggestionLimit = Number(limit) || 10;
      const published = getPublishedMockModels();
      const lowered = searchTerm.toLowerCase();

      const nameSuggestions = published
        .filter((model) => model.name.toLowerCase().includes(lowered))
        .slice(0, Math.min(5, suggestionLimit))
        .map((model) => ({ suggestion: model.name, type: 'model' as const }));

      const tagCounts = new Map<string, number>();
      for (const model of published) {
        for (const tag of model.tags) {
          if (tag.toLowerCase().includes(lowered)) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        }
      }

      const tagSuggestions = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, Math.max(0, suggestionLimit - nameSuggestions.length))
        .map(([tag]) => ({ suggestion: tag, type: 'tag' as const }));

      res.json({
        suggestions: [...nameSuggestions, ...tagSuggestions].slice(0, suggestionLimit),
      });
      return;
    }

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

    if (IS_MOCK_DB) {
      const limitNumber = Number(limit) || 12;
      const models = sortMockModels(getPublishedMockModels(), 'recent')
        .slice(0, limitNumber)
        .map(mapMockModelToResponse);

      res.json({ featured: models });
      return;
    }

    // Featured models = highest rated + most sales in last 30 days
    const result = await db.query(
      `SELECT
        m.id, m.name, m.description, m.category,
        m.thumbnail_path, m.base_price, m.glb_file_path,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        m.sale_count,
        EXISTS(
          SELECT 1 FROM favorites f
          WHERE f.model_id = m.id AND f.user_id = $1
        ) as is_favorited,
        EXISTS(
          SELECT 1 FROM assets a
          WHERE a.file_ref = m.stl_file_path
        ) as in_library,
        a.id as asset_id
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       LEFT JOIN assets a ON a.file_ref = m.stl_file_path
       WHERE m.status = 'published'
         AND m.visibility = 'public'
         AND m.published_at > CURRENT_DATE - INTERVAL '90 days'
       GROUP BY m.id, m.glb_file_path, u.artist_name, u.artist_url, a.id
       HAVING COUNT(DISTINCT r.id) >= 3 AND AVG(r.rating) >= 4.0
       ORDER BY (AVG(r.rating) * 0.6 + (m.sale_count / 100.0) * 0.4) DESC
       LIMIT $2`,
      [(req as any).userId || null, Number(limit)]
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

    if (IS_MOCK_DB) {
      const limitNumber = Number(limit) || 12;
      const models = sortMockModels(getPublishedMockModels(), 'recent')
        .slice(0, limitNumber)
        .map(mapMockModelToResponse);

      res.json({ newArrivals: models });
      return;
    }

    const result = await db.query(
      `SELECT
        m.id, m.name, m.description, m.category,
        m.thumbnail_path, m.base_price, m.glb_file_path,
        m.published_at,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        EXISTS(
          SELECT 1 FROM favorites f
          WHERE f.model_id = m.id AND f.user_id = $1
        ) as is_favorited,
        EXISTS(
          SELECT 1 FROM assets a
          WHERE a.file_ref = m.stl_file_path
        ) as in_library,
        a.id as asset_id
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       LEFT JOIN assets a ON a.file_ref = m.stl_file_path
       WHERE m.status = 'published' AND m.visibility = 'public'
       GROUP BY m.id, m.glb_file_path, u.artist_name, u.artist_url, a.id
       ORDER BY m.published_at DESC
       LIMIT $2`,
      [(req as any).userId || null, Number(limit)]
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

    if (IS_MOCK_DB) {
      const limitNumber = Number(limit) || 12;
      const models = sortMockModels(getPublishedMockModels(), 'trending')
        .slice(0, limitNumber)
        .map(mapMockModelToResponse);

      res.json({ trending: models });
      return;
    }

    // Trending = most views in last 7 days
    const result = await db.query(
      `SELECT
        m.id, m.name, m.description, m.category,
        m.thumbnail_path, m.base_price, m.glb_file_path,
        m.view_count, m.sale_count,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        EXISTS(
          SELECT 1 FROM favorites f
          WHERE f.model_id = m.id AND f.user_id = $1
        ) as is_favorited,
        EXISTS(
          SELECT 1 FROM assets a
          WHERE a.file_ref = m.stl_file_path
        ) as in_library,
        a.id as asset_id
       FROM models m
       JOIN users u ON m.artist_id = u.id
       LEFT JOIN reviews r ON m.id = r.model_id AND r.is_visible = true
       LEFT JOIN assets a ON a.file_ref = m.stl_file_path
       WHERE m.status = 'published'
         AND m.visibility = 'public'
         AND m.published_at > CURRENT_DATE - INTERVAL '30 days'
       GROUP BY m.id, m.glb_file_path, u.artist_name, u.artist_url, a.id
       ORDER BY m.view_count DESC
       LIMIT $2`,
      [(req as any).userId || null, Number(limit)]
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
    if (IS_MOCK_DB) {
      const counts = new Map<string, number>();
      for (const model of getPublishedMockModels()) {
        counts.set(model.category, (counts.get(model.category) ?? 0) + 1);
      }

      const categories = Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, count]) => ({
          category,
          model_count: count,
        }));

      res.json({ categories });
      return;
    }

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

    if (IS_MOCK_DB) {
      const limitNumber = Number(limit) || 50;
      const counts = new Map<string, number>();
      for (const model of getPublishedMockModels()) {
        for (const tag of model.tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }

      const tags = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limitNumber)
        .map(([tag, usage]) => ({
          tag,
          usage_count: usage,
        }));

      res.json({ tags });
      return;
    }

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

    if (IS_MOCK_DB) {
      const lookup = findMockModel(id);
      if (!lookup) {
        res.json({ related: [] });
        return;
      }

      const baseModel = lookup.model;
      const limitNumber = Number(limit) || 6;
      const baseTags = new Set(baseModel.tags.map((tag) => tag.toLowerCase()));

      const candidates = getPublishedMockModels().filter((model) => model.id !== id);

      const scored = candidates
        .map((model) => {
          const sameCategory = model.category === baseModel.category ? 2 : 0;
          const sharedTags = model.tags.some((tag) => baseTags.has(tag.toLowerCase())) ? 1 : 0;
          const score = sameCategory + sharedTags;
          return { model, score };
        })
        .filter(({ score }) => score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            new Date(b.model.createdAt).getTime() - new Date(a.model.createdAt).getTime()
        )
        .slice(0, limitNumber)
        .map(({ model }) => mapMockModelToResponse(model));

      res.json({ related: scored });
      return;
    }

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
        m.thumbnail_path, m.base_price, m.glb_file_path,
        u.artist_name, u.artist_url,
        COUNT(DISTINCT r.id) as review_count,
        COALESCE(AVG(r.rating), 0) as average_rating,
        EXISTS(
          SELECT 1 FROM favorites f
          WHERE f.model_id = m.id AND f.user_id = $1
        ) as is_favorited,
        EXISTS(
          SELECT 1 FROM assets a
          WHERE a.file_ref = m.stl_file_path
        ) as in_library,
        a.id as asset_id,
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
       LEFT JOIN assets a ON a.file_ref = m.stl_file_path
       WHERE m.status = 'published'
         AND m.visibility = 'public'
         AND m.id != $4
         AND (m.category = $2 OR m.tags && $3::text[])
       GROUP BY m.id, m.glb_file_path, u.artist_name, u.artist_url, a.id
       ORDER BY relevance_score DESC, m.view_count DESC
       LIMIT $5`,
      [(req as any).userId || null, category, tags || [], id, Number(limit)]
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
    if (IS_MOCK_DB) {
      const published = getPublishedMockModels();
      if (!published.length) {
        res.json({
          priceRange: { min: 0, max: 0, avg: 0 },
        });
        return;
      }

      const prices = published.map((model) => model.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;

      res.json({
        priceRange: {
          min,
          max,
          avg,
        },
      });
      return;
    }

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
    if (IS_MOCK_DB) {
      const published = getPublishedMockModels();
      const categories = new Set(published.map((model) => model.category));

      res.json({
        stats: {
          total_models: published.length,
          total_artists: published.length ? 1 : 0,
          total_categories: categories.size,
          total_sales: 0,
        },
      });
      return;
    }

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
