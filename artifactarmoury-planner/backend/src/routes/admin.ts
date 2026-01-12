// backend/src/routes/admin.ts
// Admin panel: user management, moderation, invite codes, analytics

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ValidationError, NotFoundError } from '../middleware/error';
import { deleteFromStorage } from '../services/storage';
import crypto from 'crypto';

const router = Router();

// All admin routes require authentication and admin role
router.use(authenticate, requireAdmin);

// ============================================================================
// DASHBOARD STATS
// ============================================================================

router.get('/dashboard',
  asyncHandler(async (req, res) => {
    // Overview stats
    const statsResult = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'customer') as customer_count,
        (SELECT COUNT(*) FROM users WHERE role = 'artist') as artist_count,
        (SELECT COUNT(*) FROM models WHERE status = 'published') as published_models,
        (SELECT COUNT(*) FROM orders) as total_orders,
        (SELECT SUM(total) FROM orders WHERE payment_status = 'succeeded') as total_revenue,
        (SELECT COUNT(*) FROM orders WHERE created_at > CURRENT_DATE - INTERVAL '7 days') as orders_last_7_days,
        (SELECT COUNT(*) FROM models WHERE created_at > CURRENT_DATE - INTERVAL '7 days') as models_last_7_days
    `);

    // Recent activity
    const activityResult = await db.query(
      `SELECT action, resource_type, resource_id, metadata, created_at, user_id, u.display_name
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       ORDER BY created_at DESC
       LIMIT 20`
    );

    // Pending reviews
    const flaggedResult = await db.query(
      `SELECT m.id, m.name, m.flagged_reason, m.created_at, u.artist_name
       FROM models m
       JOIN users u ON m.artist_id = u.id
       WHERE m.status = 'flagged'
       ORDER BY m.created_at DESC
       LIMIT 10`
    );

    res.json({
      stats: statsResult.rows[0],
      recentActivity: activityResult.rows,
      flaggedModels: flaggedResult.rows
    });
  })
);

// ============================================================================
// USER MANAGEMENT
// ============================================================================

// Get all users
router.get('/users',
  asyncHandler(async (req, res) => {
    const { role, status, search, page = 1, limit = 50 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (role) {
      conditions.push(`role = $${paramIndex}`);
      params.push(role);
      paramIndex++;
    }

    if (status) {
      conditions.push(`account_status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (search && typeof search === 'string') {
      conditions.push(`(email ILIKE $${paramIndex} OR display_name ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM users ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);

    // Get users
    const result = await db.query(
      `SELECT 
        u.id, u.email, u.display_name, u.role, u.account_status,
        u.artist_name, u.created_at, u.last_login,
        COUNT(DISTINCT m.id) as model_count,
        COUNT(DISTINCT o.id) as order_count
       FROM users u
       LEFT JOIN models m ON u.id = m.artist_id
       LEFT JOIN orders o ON u.id = o.user_id
       ${whereClause}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, Number(limit), offset]
    );

    res.json({
      users: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / Number(limit))
      }
    });
  })
);

// Get single user details
router.get('/users/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const userResult = await db.query(
      `SELECT 
        u.*,
        COUNT(DISTINCT m.id) as model_count,
        COUNT(DISTINCT o.id) as order_count,
        SUM(o.total) as total_spent
       FROM users u
       LEFT JOIN models m ON u.id = m.artist_id
       LEFT JOIN orders o ON u.id = o.user_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [id]
    );

    if (userResult.rows.length === 0) {
      throw new NotFoundError('User');
    }

    // Get recent activity
    const activityResult = await db.query(
      `SELECT action, resource_type, resource_id, metadata, created_at
       FROM activity_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    res.json({
      user: userResult.rows[0],
      recentActivity: activityResult.rows
    });
  })
);

// Update user status
router.patch('/users/:id/status',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['active', 'suspended', 'banned'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError('Invalid status');
    }

    await db.query(
      `UPDATE users SET account_status = $1 WHERE id = $2`,
      [status, id]
    );

    logger.warn('User status changed by admin', {
      adminId: (req as any).userId,
      targetUserId: id,
      newStatus: status
    });

    res.json({ message: 'User status updated successfully' });
  })
);

// Delete user
router.delete('/users/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (id === (req as any).userId) {
      throw new ValidationError('Cannot delete your own account');
    }

    await db.query('DELETE FROM users WHERE id = $1', [id]);

    logger.warn('User deleted by admin', {
      adminId: (req as any).userId,
      deletedUserId: id
    });

    res.json({ message: 'User deleted successfully' });
  })
);

// ============================================================================
// MODEL MODERATION
// ============================================================================

// Get flagged models
router.get('/models/flagged',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT 
        m.*, u.artist_name, u.email as artist_email
       FROM models m
       JOIN users u ON m.artist_id = u.id
       WHERE m.status = 'flagged'
       ORDER BY m.created_at DESC`
    );

    res.json({
      flaggedModels: result.rows
    });
  })
);

// Flag model
router.post('/models/:id/flag',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      throw new ValidationError('Reason is required');
    }

    await db.query(
      `UPDATE models 
       SET status = 'flagged', 
           flagged_reason = $1,
           moderated_by = $2,
           moderated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [reason, (req as any).userId, id]
    );

    logger.warn('Model flagged by admin', {
      adminId: (req as any).userId,
      modelId: id,
      reason
    });

    res.json({ message: 'Model flagged successfully' });
  })
);

// Approve model
router.post('/models/:id/approve',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    await db.query(
      `UPDATE models 
       SET status = 'published',
           flagged_reason = NULL,
           moderated_by = $1,
           moderated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [(req as any).userId, id]
    );

    logger.info('Model approved by admin', {
      adminId: (req as any).userId,
      modelId: id
    });

    res.json({ message: 'Model approved successfully' });
  })
);

// Delete model
router.delete('/models/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get model file paths for cleanup
    const result = await db.query(
      `SELECT stl_file_path, glb_file_path, thumbnail_path
       FROM models WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Model not found' });
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

    logger.warn('Model deleted by admin', {
      adminId: (req as any).userId,
      modelId: id
    });

    res.json({ message: 'Model deleted successfully' });
  })
);

// ============================================================================
// INVITE CODE MANAGEMENT
// ============================================================================

// Get all invite codes
router.get('/invites',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT 
        ic.*,
        u1.display_name as created_by_name,
        u2.display_name as used_by_name,
        u2.email as used_by_email
       FROM invite_codes ic
       LEFT JOIN users u1 ON ic.created_by = u1.id
       LEFT JOIN users u2 ON ic.used_by = u2.id
       ORDER BY ic.created_at DESC`
    );

    res.json({
      invites: result.rows
    });
  })
);

// Create invite code
router.post('/invites',
  asyncHandler(async (req, res) => {
    const { maxUses = 1, expiresInDays } = req.body;

    // Generate random code
    const code = generateInviteCode();

    // Calculate expiry
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + Number(expiresInDays));
    }

    const result = await db.query(
      `INSERT INTO invite_codes (code, created_by, max_uses, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [code, (req as any).userId, maxUses, expiresAt]
    );

    logger.info('Invite code created', {
      adminId: (req as any).userId,
      code,
      maxUses,
      expiresAt
    });

    res.status(201).json({
      message: 'Invite code created successfully',
      invite: result.rows[0]
    });
  })
);

// Delete invite code
router.delete('/invites/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    await db.query('DELETE FROM invite_codes WHERE id = $1', [id]);

    logger.info('Invite code deleted', {
      adminId: (req as any).userId,
      inviteId: id
    });

    res.json({ message: 'Invite code deleted successfully' });
  })
);

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================

// Get all orders
router.get('/orders',
  asyncHandler(async (req, res) => {
    const { status, page = 1, limit = 50 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = '';
    const params: any[] = [];

    if (status) {
      whereClause = 'WHERE o.fulfillment_status = $1';
      params.push(status);
    }

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM orders o ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);

    // Get orders
    const result = await db.query(
      `SELECT 
        o.id, o.order_number, o.customer_email, o.total,
        o.payment_status, o.fulfillment_status,
        o.created_at, o.paid_at, o.shipped_at,
        u.display_name as customer_name,
        COUNT(oi.id) as item_count
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       ${whereClause}
       GROUP BY o.id, u.display_name
       ORDER BY o.created_at DESC
       LIMIT ${params.length + 1} OFFSET ${params.length + 2}`,
      [...params, Number(limit), offset]
    );

    res.json({
      orders: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / Number(limit))
      }
    });
  })
);

// Get single order details
router.get('/orders/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const orderResult = await db.query(
      `SELECT o.*, u.display_name as customer_name
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = $1`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      throw new NotFoundError('Order');
    }

    // Get order items
    const itemsResult = await db.query(
      `SELECT oi.*, m.thumbnail_path
       FROM order_items oi
       LEFT JOIN models m ON oi.model_id = m.id
       WHERE oi.order_id = $1`,
      [id]
    );

    res.json({
      order: orderResult.rows[0],
      items: itemsResult.rows
    });
  })
);

// Update order fulfillment status
router.patch('/orders/:id/fulfillment',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, trackingNumber, trackingUrl } = req.body;

    const validStatuses = ['pending', 'processing', 'printing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError('Invalid fulfillment status');
    }

    const updates: string[] = ['fulfillment_status = $1'];
    const values: any[] = [status];
    let paramIndex = 2;

    if (trackingNumber) {
      updates.push(`tracking_number = ${paramIndex}`);
      values.push(trackingNumber);
      paramIndex++;
    }

    if (trackingUrl) {
      updates.push(`tracking_url = ${paramIndex}`);
      values.push(trackingUrl);
      paramIndex++;
    }

    if (status === 'shipped') {
      updates.push(`shipped_at = CURRENT_TIMESTAMP`);
    }

    values.push(id);

    await db.query(
      `UPDATE orders 
       SET ${updates.join(', ')}
       WHERE id = ${paramIndex}`,
      values
    );

    logger.info('Order fulfillment updated by admin', {
      adminId: (req as any).userId,
      orderId: id,
      status
    });

    res.json({ message: 'Order fulfillment updated successfully' });
  })
);

// ============================================================================
// ANALYTICS
// ============================================================================

router.get('/analytics/revenue',
  asyncHandler(async (req, res) => {
    const { period = '30' } = req.query;

    const days = Number(period);

    // Revenue by day
    const revenueResult = await db.query(
      `SELECT 
        DATE(paid_at) as date,
        COUNT(*) as order_count,
        SUM(total) as revenue
       FROM orders
       WHERE paid_at > CURRENT_DATE - INTERVAL '${days} days'
         AND payment_status = 'succeeded'
       GROUP BY DATE(paid_at)
       ORDER BY date DESC`
    );

    // Revenue by category
    const categoryResult = await db.query(
      `SELECT 
        m.category,
        COUNT(DISTINCT oi.id) as sales_count,
        SUM(oi.total_price) as revenue
       FROM order_items oi
       JOIN models m ON oi.model_id = m.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.paid_at > CURRENT_DATE - INTERVAL '${days} days'
         AND o.payment_status = 'succeeded'
       GROUP BY m.category
       ORDER BY revenue DESC`
    );

    // Top selling models
    const topModelsResult = await db.query(
      `SELECT 
        m.id, m.name, m.thumbnail_path,
        COUNT(oi.id) as sales_count,
        SUM(oi.total_price) as revenue,
        u.artist_name
       FROM order_items oi
       JOIN models m ON oi.model_id = m.id
       JOIN users u ON m.artist_id = u.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.paid_at > CURRENT_DATE - INTERVAL '${days} days'
         AND o.payment_status = 'succeeded'
       GROUP BY m.id, u.artist_name
       ORDER BY sales_count DESC
       LIMIT 10`
    );

    // Top artists
    const topArtistsResult = await db.query(
      `SELECT 
        u.id, u.artist_name,
        COUNT(DISTINCT oi.id) as sales_count,
        SUM(oi.artist_commission_amount) as earnings
       FROM order_items oi
       JOIN users u ON oi.artist_id = u.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.paid_at > CURRENT_DATE - INTERVAL '${days} days'
         AND o.payment_status = 'succeeded'
       GROUP BY u.id
       ORDER BY sales_count DESC
       LIMIT 10`
    );

    res.json({
      revenueByDay: revenueResult.rows,
      revenueByCategory: categoryResult.rows,
      topModels: topModelsResult.rows,
      topArtists: topArtistsResult.rows
    });
  })
);

router.get('/analytics/users',
  asyncHandler(async (req, res) => {
    const { period = '30' } = req.query;

    const days = Number(period);

    // User growth
    const growthResult = await db.query(
      `SELECT 
        DATE(created_at) as date,
        role,
        COUNT(*) as new_users
       FROM users
       WHERE created_at > CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY DATE(created_at), role
       ORDER BY date DESC`
    );

    // Active users
    const activeResult = await db.query(
      `SELECT 
        COUNT(DISTINCT user_id) as active_users
       FROM activity_log
       WHERE created_at > CURRENT_DATE - INTERVAL '${days} days'`
    );

    res.json({
      userGrowth: growthResult.rows,
      activeUsers: activeResult.rows[0]
    });
  })
);

// ============================================================================
// SYSTEM SETTINGS
// ============================================================================

router.get('/settings',
  asyncHandler(async (req, res) => {
    // In a real app, these would come from a settings table
    const settings = {
      siteName: 'Terrain Builder',
      maintenanceMode: false,
      registrationEnabled: true,
      artistRegistrationEnabled: true,
      maxUploadSize: 100, // MB
      commissionRate: 15, // Default %
      shippingEnabled: true
    };

    res.json({ settings });
  })
);

// ============================================================================
// ACTIVITY LOG
// ============================================================================

router.get('/activity',
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 100, action, userId } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (action) {
      conditions.push(`action = ${paramIndex}`);
      params.push(action);
      paramIndex++;
    }

    if (userId) {
      conditions.push(`user_id = ${paramIndex}`);
      params.push(userId);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM activity_log ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].count);

    // Get activity
    const result = await db.query(
      `SELECT 
        al.*,
        u.display_name, u.email
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ${paramIndex} OFFSET ${paramIndex + 1}`,
      [...params, Number(limit), offset]
    );

    res.json({
      activity: result.rows,
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
// HELPER FUNCTIONS
// ============================================================================

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export default router;
