// backend/src/routes/admin.ts
// Admin panel: user management, moderation, invite codes, analytics

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { authenticate, requireAdmin, requireSuperAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ValidationError, NotFoundError } from '../middleware/error';
import crypto from 'crypto';
import { deleteFromStorage } from '../services/storage';
import { reverseEarningsForModel } from '../services/earnings';
import { createRefund } from '../services/stripe';
import { createNotification } from '../services/notifications';
import { createBroadcast, sendSupportMessage } from '../services/messaging';
import { runPayoutCycle } from '../services/payouts';
import { publicUrl } from '../services/r2';

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

    // Preview bake queue depth (the proxy-bake worker). Guarded so the dashboard
    // still loads if the bake pipeline/table isn't present in this environment.
    let previewQueue = { queued: 0, running: 0, failed: 0 };
    try {
      const bake = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'queued')  AS queued,
          COUNT(*) FILTER (WHERE status = 'running') AS running,
          COUNT(*) FILTER (WHERE status = 'failed')  AS failed
        FROM proxy_bake_jobs
      `);
      const r = bake.rows[0] || {};
      previewQueue = {
        queued: Number(r.queued || 0),
        running: Number(r.running || 0),
        failed: Number(r.failed || 0),
      };
    } catch {
      /* proxy_bake_jobs missing (pipeline off) — leave zeros */
    }

    // Platform revenue is owner-only. Regular admins see everything else.
    const stats = statsResult.rows[0];
    if (!(req as any).user?.is_super_admin) {
      delete stats.total_revenue;
    }

    res.json({
      stats,
      previewQueue,
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

    await db.query('DELETE FROM models WHERE id = $1', [id]);

    logger.warn('Model deleted by admin', {
      adminId: (req as any).userId,
      modelId: id
    });

    res.json({ message: 'Model deleted successfully' });
  })
);

// Delete all models
router.delete('/models',
  asyncHandler(async (req, res) => {
    const client = await db.connect();

    let modelRows: Array<{
      stl_file_path: string | null;
      glb_file_path: string | null;
      thumbnail_path: string | null;
    }> = [];
    let imageRows: Array<{ image_path: string | null }> = [];

    try {
      await client.query('BEGIN');

      const modelsResult = await client.query(
        `SELECT stl_file_path, glb_file_path, thumbnail_path FROM models`
      );
      const imagesResult = await client.query(
        `SELECT image_path FROM model_images`
      );

      modelRows = modelsResult.rows;
      imageRows = imagesResult.rows;

      await client.query('DELETE FROM models');

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const filePaths = new Set<string>();

    for (const model of modelRows) {
      if (model.stl_file_path) filePaths.add(model.stl_file_path);
      if (model.glb_file_path) filePaths.add(model.glb_file_path);
      if (model.thumbnail_path) filePaths.add(model.thumbnail_path);
    }

    for (const image of imageRows) {
      if (image.image_path) filePaths.add(image.image_path);
    }

    if (filePaths.size > 0) {
      const deleteResults = await Promise.allSettled(
        Array.from(filePaths).map(filePath => deleteFromStorage(filePath))
      );

      const failed = deleteResults.filter(result => result.status === 'rejected');
      if (failed.length > 0) {
        logger.warn('Some model files failed to delete during bulk removal', {
          totalFiles: filePaths.size,
          failedCount: failed.length
        });
      }
    }

    logger.warn('All models purged by admin', {
      adminId: (req as any).userId,
      deletedCount: modelRows.length
    });

    res.json({
      message: 'All models deleted successfully',
      deletedCount: modelRows.length
    });
  })
);

// ============================================================================
// MODERATION — MODEL REPORTS
// ============================================================================

const REASON_LABELS: Record<string, string> = {
  copyright: 'Copyright infringement',
  offensive: 'Offensive / inappropriate',
  not_as_advertised: 'Not as advertised',
  no_printed_photo: 'No photo of a printed model',
  broken_file: 'Broken / unprintable file',
  other: 'Other',
};

// The moderation queue: report tiles, newest first, filterable by status.
router.get('/reports',
  asyncHandler(async (req, res) => {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions: string[] = [];
    const params: any[] = [];
    if (status) { conditions.push(`r.status = $${params.length + 1}`); params.push(status); }
    // Default view hides resolved reports unless explicitly asked for.
    else conditions.push(`r.status IN ('open', 'under_review', 'awaiting_info')`);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM model_reports r ${whereClause}`, params);
    const totalCount = parseInt(countResult.rows[0].count);

    const result = await db.query(
      `SELECT r.id, r.reason, r.status, r.created_at, r.detail,
              r.model_id, m.name AS model_name, m.thumbnail_path, m.status AS model_status,
              r.artist_id, au.artist_name, au.display_name AS artist_display_name,
              r.reporter_id, ru.display_name AS reporter_name,
              (SELECT COUNT(*) FROM model_report_attachments a WHERE a.report_id = r.id) AS attachment_count
       FROM model_reports r
       LEFT JOIN models m ON r.model_id = m.id
       LEFT JOIN users au ON r.artist_id = au.id
       LEFT JOIN users ru ON r.reporter_id = ru.id
       ${whereClause}
       ORDER BY
         CASE r.status WHEN 'open' THEN 0 WHEN 'under_review' THEN 1 WHEN 'awaiting_info' THEN 2 ELSE 3 END,
         r.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), offset],
    );

    // Also surface open-count for the nav badge.
    const openResult = await db.query(
      `SELECT COUNT(*) FROM model_reports WHERE status IN ('open','under_review','awaiting_info')`,
    );

    res.json({
      reports: result.rows.map((r: any) => ({ ...r, reason_label: REASON_LABELS[r.reason] || r.reason })),
      openCount: parseInt(openResult.rows[0].count),
      pagination: { page: Number(page), limit: Number(limit), total: totalCount, pages: Math.ceil(totalCount / Number(limit)) },
    });
  }),
);

// Full report detail for the moderation drill-down.
router.get('/reports/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const reportResult = await db.query(
      `SELECT r.*,
              m.name AS model_name, m.thumbnail_path, m.status AS model_status,
              m.description AS model_description, m.category AS model_category,
              au.artist_name, au.email AS artist_email, au.display_name AS artist_display_name,
              au.account_status AS artist_account_status, au.shadow_banned AS artist_shadow_banned,
              ru.display_name AS reporter_name, ru.email AS reporter_email,
              ru.shadow_banned AS reporter_shadow_banned,
              resu.display_name AS resolved_by_name
       FROM model_reports r
       LEFT JOIN models m ON r.model_id = m.id
       LEFT JOIN users au ON r.artist_id = au.id
       LEFT JOIN users ru ON r.reporter_id = ru.id
       LEFT JOIN users resu ON r.resolved_by = resu.id
       WHERE r.id = $1`,
      [id],
    );
    if (reportResult.rows.length === 0) throw new NotFoundError('Report');
    const report = reportResult.rows[0];

    const attachmentsResult = await db.query(
      `SELECT id, file_path, file_name, content_type, created_at
       FROM model_report_attachments WHERE report_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    // Context: how many other reports on this model / against this artist.
    const historyResult = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM model_reports x WHERE x.model_id = $1 AND x.id <> $3) AS other_reports_on_model,
        (SELECT COUNT(*) FROM model_reports x WHERE x.artist_id = $2 AND x.id <> $3) AS other_reports_on_artist,
        (SELECT COUNT(*) FROM models WHERE artist_id = $2) AS artist_model_count`,
      [report.model_id, report.artist_id, id],
    );

    // Mark an untouched report as under_review the moment an admin opens it.
    if (report.status === 'open') {
      await db.query(`UPDATE model_reports SET status = 'under_review', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
      report.status = 'under_review';
    }

    res.json({
      report: { ...report, reason_label: REASON_LABELS[report.reason] || report.reason },
      attachments: attachmentsResult.rows.map((a: any) => ({ ...a, url: publicUrl(a.file_path) })),
      context: historyResult.rows[0],
    });
  }),
);

// Resolve a report: apply an action, record findings, notify reporter + artist.
router.post('/reports/:id/resolve',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { action, summary, targetUserId } = req.body;
    const adminId = (req as any).userId;

    const VALID_ACTIONS = [
      'dismiss', 'request_info', 'warn_artist', 'unpublish_model', 'flag_model',
      'remove_model', 'refund_buyers', 'suspend_artist', 'ban_artist',
      'shadow_ban_user', 'reinstate_model',
    ];
    if (!action || !VALID_ACTIONS.includes(action)) {
      throw new ValidationError('A valid action is required');
    }
    if (!summary || typeof summary !== 'string' || summary.trim().length < 5) {
      throw new ValidationError('Please write a short findings summary (this is shown to the reporter and artist)');
    }

    const reportResult = await db.query(
      `SELECT r.*, m.name AS model_name FROM model_reports r
       LEFT JOIN models m ON r.model_id = m.id WHERE r.id = $1`,
      [id],
    );
    if (reportResult.rows.length === 0) throw new NotFoundError('Report');
    const report = reportResult.rows[0];
    const modelId = report.model_id;
    const artistId = report.artist_id;

    let newStatus = 'resolved_upheld';
    const notes: string[] = [];

    switch (action) {
      case 'dismiss':
        newStatus = 'resolved_dismissed';
        break;

      case 'request_info':
        newStatus = 'awaiting_info';
        break;

      case 'warn_artist':
        // Formal warning — recorded via notification + activity log below.
        break;

      case 'unpublish_model':
        if (modelId) await db.query(`UPDATE models SET status = 'draft', moderated_by = $1, moderated_at = CURRENT_TIMESTAMP WHERE id = $2`, [adminId, modelId]);
        break;

      case 'flag_model':
        if (modelId) await db.query(`UPDATE models SET status = 'flagged', flagged_reason = $1, moderated_by = $2, moderated_at = CURRENT_TIMESTAMP WHERE id = $3`, [summary, adminId, modelId]);
        break;

      case 'remove_model':
        // Archive (not hard-delete) so evidence + purchase history survive; the download
        // route blocks buyers on archived models, and we void the artist's un-paid earnings.
        if (modelId) {
          await db.query(`UPDATE models SET status = 'archived', flagged_reason = $1, moderated_by = $2, moderated_at = CURRENT_TIMESTAMP WHERE id = $3`, [summary, adminId, modelId]);
          const { reversed, alreadyPaid } = await reverseEarningsForModel(modelId, `Model removed: report ${id}`);
          notes.push(`voided ${reversed} un-paid earning(s)${alreadyPaid ? `, ${alreadyPaid} already paid`: ''}`);
        }
        break;

      case 'refund_buyers': {
        if (modelId) {
          // Refund each buyer the amount they paid for this model, then void artist earnings
          // and archive the model so downloads stop.
          const affected = await db.query(
            `SELECT o.id AS order_id, o.payment_intent_id, o.user_id,
                    SUM(oi.total_price) AS amount
             FROM orders o JOIN order_items oi ON oi.order_id = o.id
             WHERE oi.model_id = $1 AND o.payment_status = 'succeeded'
             GROUP BY o.id, o.payment_intent_id, o.user_id`,
            [modelId],
          );
          let refundCount = 0;
          for (const row of affected.rows) {
            if (!row.payment_intent_id) continue;
            try {
              await createRefund(row.payment_intent_id, Number(row.amount), 'requested_by_customer');
              refundCount++;
              if (row.user_id) {
                createNotification({
                  userId: row.user_id,
                  type: 'refund_issued',
                  title: `Refund issued for "${report.model_name}"`,
                  body: `We've refunded £${Number(row.amount).toFixed(2)} for this model following a moderation review.`,
                  link: '/dashboard/purchases',
                });
              }
            } catch (err) {
              logger.error('Refund failed during moderation', { error: err, orderId: row.order_id, modelId });
            }
          }
          await db.query(`UPDATE models SET status = 'archived', flagged_reason = $1, moderated_by = $2, moderated_at = CURRENT_TIMESTAMP WHERE id = $3`, [summary, adminId, modelId]);
          await reverseEarningsForModel(modelId, `Buyers refunded: report ${id}`);
          notes.push(`refunded ${refundCount} buyer(s)`);
        }
        break;
      }

      case 'suspend_artist':
        if (artistId) await db.query(`UPDATE users SET account_status = 'suspended' WHERE id = $1`, [artistId]);
        break;

      case 'ban_artist':
        if (artistId) await db.query(`UPDATE users SET account_status = 'banned' WHERE id = $1`, [artistId]);
        break;

      case 'shadow_ban_user': {
        // Defaults to the reporter (abusive reporting); admin may target another user.
        const target = targetUserId || report.reporter_id;
        if (target) await db.query(`UPDATE users SET shadow_banned = true WHERE id = $1`, [target]);
        notes.push(`shadow-banned user ${target}`);
        break;
      }

      case 'reinstate_model':
        if (modelId) await db.query(`UPDATE models SET status = 'published', flagged_reason = NULL, moderated_by = $1, moderated_at = CURRENT_TIMESTAMP WHERE id = $2`, [adminId, modelId]);
        newStatus = 'resolved_dismissed';
        break;
    }

    // "awaiting_info" isn't a final resolution, so it has no resolved_at. Compute this
    // in JS rather than a SQL CASE that reuses $1 (Postgres can't always infer the
    // param's type across `status = $1` + `$1 = 'awaiting_info'`, which 500s as a
    // generic DB error).
    const resolvedAt = newStatus === 'awaiting_info' ? null : new Date();
    await db.query(
      `UPDATE model_reports
       SET status = $1, resolution_action = $2, resolution_summary = $3,
           resolved_by = $4, resolved_at = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [newStatus, action, summary, adminId, resolvedAt, id],
    );

    // Notify both parties of the outcome (except pure "request more info", which pings
    // the reporter only).
    if (report.reporter_id) {
      createNotification({
        userId: report.reporter_id,
        type: 'report_resolved',
        title: action === 'request_info' ? 'We need more information about your report' : `Update on your report of "${report.model_name || 'a model'}"`,
        body: summary,
        link: '/dashboard',
      });
    }
    if (artistId && action !== 'request_info') {
      createNotification({
        userId: artistId,
        type: 'moderation_decision',
        title: `Moderation decision on "${report.model_name || 'your model'}"`,
        body: summary,
        link: '/artist/reports',
      });
    }

    logger.warn('Report resolved by admin', { adminId, reportId: id, action, notes });
    res.json({ message: 'Report resolved', action, status: newStatus, notes });
  }),
);

// Directly toggle a user's shadow-ban (from the Users admin page).
router.patch('/users/:id/shadow-ban',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { shadowBanned } = req.body;
    await db.query(`UPDATE users SET shadow_banned = $1 WHERE id = $2`, [!!shadowBanned, id]);
    logger.warn('User shadow-ban toggled by admin', { adminId: (req as any).userId, targetUserId: id, shadowBanned: !!shadowBanned });
    res.json({ message: 'Shadow-ban updated', shadowBanned: !!shadowBanned });
  }),
);

// Manually trigger a payout cycle (clear matured earnings + pay eligible artists).
router.post('/payouts/run',
  asyncHandler(async (req, res) => {
    const result = await runPayoutCycle();
    logger.info('Payout cycle run manually by admin', { adminId: (req as any).userId, ...result });
    res.json({ message: 'Payout cycle complete', ...result });
  }),
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
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
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
      updates.push(`tracking_number = $${paramIndex}`);
      values.push(trackingNumber);
      paramIndex++;
    }

    if (trackingUrl) {
      updates.push(`tracking_url = $${paramIndex}`);
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
       WHERE id = $${paramIndex}`,
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

// Owner-only KPI overview: revenue (gross + platform cut), catalogue/user counts,
// view & visitor analytics, and a peak-hours histogram. One round-trip.
router.get('/analytics/overview',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const days = Math.max(1, Math.min(365, Number(req.query.period) || 30));

    const [
      revenue,
      counts,
      views,
      active,
      viewsByHour,
      viewsByDay,
    ] = await Promise.all([
      // Gross revenue + platform's cut (total_price minus the artist's share).
      db.query(`
        SELECT
          COALESCE(SUM(o.total), 0) AS total_revenue,
          COALESCE(SUM(oi.total_price - oi.artist_commission_amount), 0) AS site_revenue,
          COUNT(DISTINCT o.id) AS paid_orders
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.payment_status = 'succeeded'
      `),
      // Headline catalogue / user counts (all-time).
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM users) AS total_users,
          (SELECT COUNT(*) FROM users WHERE role = 'artist') AS total_artists,
          (SELECT COUNT(*) FROM users WHERE role = 'customer') AS total_customers,
          (SELECT COUNT(*) FROM models) AS total_models,
          (SELECT COUNT(*) FROM models WHERE status = 'published') AS published_models,
          (SELECT COUNT(*) FROM orders) AS total_orders,
          (SELECT COALESCE(SUM(view_count), 0) FROM models) AS total_views
      `),
      // Windowed view + unique-visitor counts (timestamped events).
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS views_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')  AS views_7d,
          COUNT(DISTINCT COALESCE(session_id, user_id::text))
            FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS visitors_24h,
          COUNT(DISTINCT COALESCE(session_id, user_id::text))
            FILTER (WHERE created_at > NOW() - INTERVAL '7 days')  AS visitors_7d
        FROM analytics_events
        WHERE type = 'product_view'
      `),
      // Active (logged-in) users by recency of any logged action.
      db.query(`
        SELECT
          COUNT(DISTINCT user_id) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS active_24h,
          COUNT(DISTINCT user_id) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')  AS active_30d
        FROM activity_log
      `),
      // Peak-times histogram: views bucketed by hour-of-day in UK local time
      // (Europe/London handles BST/GMT automatically) over the window.
      db.query(`
        SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Europe/London')::int AS hour, COUNT(*) AS views
        FROM analytics_events
        WHERE type = 'product_view'
          AND created_at > NOW() - INTERVAL '${days} days'
        GROUP BY hour
        ORDER BY hour
      `),
      // Daily view trend over the window (UK-local day boundaries).
      db.query(`
        SELECT DATE(created_at AT TIME ZONE 'Europe/London') AS date, COUNT(*) AS views
        FROM analytics_events
        WHERE type = 'product_view'
          AND created_at > NOW() - INTERVAL '${days} days'
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    // Fill every hour 0–23 so the chart has no gaps.
    const hourMap = new Map<number, number>(
      viewsByHour.rows.map((r: any) => [Number(r.hour), Number(r.views)])
    );
    const viewsByHourOfDay = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      views: hourMap.get(h) ?? 0,
    }));

    res.json({
      periodDays: days,
      totals: {
        totalRevenue: Number(revenue.rows[0].total_revenue),
        siteRevenue: Number(revenue.rows[0].site_revenue),
        paidOrders: Number(revenue.rows[0].paid_orders),
        totalOrders: Number(counts.rows[0].total_orders),
        totalUsers: Number(counts.rows[0].total_users),
        totalArtists: Number(counts.rows[0].total_artists),
        totalCustomers: Number(counts.rows[0].total_customers),
        totalModels: Number(counts.rows[0].total_models),
        publishedModels: Number(counts.rows[0].published_models),
        totalViews: Number(counts.rows[0].total_views),
        views24h: Number(views.rows[0].views_24h),
        views7d: Number(views.rows[0].views_7d),
        visitors24h: Number(views.rows[0].visitors_24h),
        visitors7d: Number(views.rows[0].visitors_7d),
        activeUsers24h: Number(active.rows[0].active_24h),
        activeUsers30d: Number(active.rows[0].active_30d),
      },
      viewsByHourOfDay,
      viewsByDay: viewsByDay.rows.map((r: any) => ({
        date: r.date,
        views: Number(r.views),
      })),
    });
  })
);

router.get('/analytics/revenue',
  requireSuperAdmin,
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
  requireSuperAdmin,
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
      conditions.push(`action = $${paramIndex}`);
      params.push(action);
      paramIndex++;
    }

    if (userId) {
      conditions.push(`user_id = $${paramIndex}`);
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
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
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
// SITE MESSAGING (migration 022): broadcasts + one-to-one support DMs
// ============================================================================

// Broadcast an announcement to an audience. One-way (recipients can't reply).
router.post('/messages/broadcast',
  asyncHandler(async (req, res) => {
    const adminId = (req as any).userId as string;
    const { subject, body, audience } = req.body ?? {};
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      throw new ValidationError('A subject is required');
    }
    if (!body || typeof body !== 'string' || !body.trim()) {
      throw new ValidationError('A message body is required');
    }
    const aud = ['all', 'customers', 'artists'].includes(audience) ? audience : 'all';
    const result = await createBroadcast({
      subject: subject.trim().slice(0, 255),
      body: body.trim().slice(0, 5000),
      createdBy: adminId,
      audience: aud,
    });
    logger.info('Admin broadcast sent', { adminId, audience: aud, recipients: result.recipients });
    res.status(201).json({ message: 'Broadcast sent', ...result });
  })
);

// Send a one-to-one support message to a user (by id or email). Repliable.
router.post('/messages/dm',
  asyncHandler(async (req, res) => {
    const adminId = (req as any).userId as string;
    const { userId, email, body, subject } = req.body ?? {};
    if (!body || typeof body !== 'string' || !body.trim()) {
      throw new ValidationError('A message body is required');
    }
    let targetId: string | undefined = typeof userId === 'string' ? userId : undefined;
    if (!targetId && typeof email === 'string' && email.trim()) {
      const found = await db.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email.trim()]);
      if (found.rows.length === 0) throw new NotFoundError('User');
      targetId = found.rows[0].id;
    }
    if (!targetId) throw new ValidationError('A target userId or email is required');

    const conversationId = await sendSupportMessage(
      targetId,
      body.trim().slice(0, 5000),
      adminId,
      typeof subject === 'string' ? subject.trim().slice(0, 255) : undefined,
    );
    logger.info('Admin support DM sent', { adminId, targetId });
    res.status(201).json({ message: 'Message sent', conversationId });
  })
);

// List support threads (repliable system conversations) for the admin desk, newest
// activity first, flagging those whose last message came from the user (needs a reply).
router.get('/messages/threads',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const result = await db.query(
      `SELECT c.id, c.subject, c.last_message_at, c.last_message_preview,
              u.id AS user_id, u.email AS user_email,
              COALESCE(NULLIF(u.artist_name, ''), u.display_name) AS user_name,
              lm.sender_id AS last_sender_id,
              (lm.sender_id IS NOT NULL) AS awaiting_reply
       FROM conversations c
       JOIN conversation_participants p ON p.conversation_id = c.id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN LATERAL (
         SELECT sender_id FROM messages m
         WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       WHERE c.kind = 'system' AND c.allow_replies = true
       ORDER BY c.last_message_at DESC
       LIMIT $1`,
      [limit],
    );
    res.json({ threads: result.rows });
  })
);

// ============================================================================
// CONVERSATION REPORTS (migration 023): review reported message threads
// ============================================================================

// Queue: open/under-review first, newest first. Optional ?status= filter.
router.get('/conversation-reports',
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params: any[] = [];
    let where = '';
    if (status && typeof status === 'string') {
      params.push(status);
      where = `WHERE r.status = $1`;
    }
    const result = await db.query(
      `SELECT r.id, r.reason, r.status, r.detail, r.created_at, r.resolved_at,
              r.resolution_action, r.resolution_summary, r.conversation_id,
              r.reporter_id, COALESCE(NULLIF(rep.artist_name, ''), rep.display_name) AS reporter_name,
              r.reported_user_id, COALESCE(NULLIF(ru.artist_name, ''), ru.display_name) AS reported_user_name,
              ru.account_status AS reported_account_status, ru.shadow_banned AS reported_shadow_banned,
              jsonb_array_length(r.snapshot -> 'messages') AS message_count
       FROM conversation_reports r
       LEFT JOIN users rep ON rep.id = r.reporter_id
       LEFT JOIN users ru ON ru.id = r.reported_user_id
       ${where}
       ORDER BY (r.status IN ('open', 'under_review')) DESC, r.created_at DESC
       LIMIT 200`,
      params,
    );
    const openCountResult = await db.query(
      `SELECT COUNT(*) AS c FROM conversation_reports WHERE status IN ('open', 'under_review')`,
    );
    res.json({ reports: result.rows, openCount: parseInt(openCountResult.rows[0]?.c ?? '0', 10) || 0 });
  })
);

// One report with its captured snapshot.
router.get('/conversation-reports/:id',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT r.*,
              COALESCE(NULLIF(rep.artist_name, ''), rep.display_name) AS reporter_name,
              rep.email AS reporter_email,
              COALESCE(NULLIF(ru.artist_name, ''), ru.display_name) AS reported_user_name,
              ru.email AS reported_user_email,
              ru.account_status AS reported_account_status,
              ru.shadow_banned AS reported_shadow_banned,
              rb.display_name AS resolved_by_name
       FROM conversation_reports r
       LEFT JOIN users rep ON rep.id = r.reporter_id
       LEFT JOIN users ru ON ru.id = r.reported_user_id
       LEFT JOIN users rb ON rb.id = r.resolved_by
       WHERE r.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) throw new NotFoundError('Report');

    // Mark an unreviewed report as under_review when an admin opens it.
    if (result.rows[0].status === 'open') {
      await db.query(
        `UPDATE conversation_reports SET status = 'under_review', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id],
      );
      result.rows[0].status = 'under_review';
    }
    res.json({ report: result.rows[0] });
  })
);

// Resolve: dismiss, or uphold and act on the reported user.
router.post('/conversation-reports/:id/resolve',
  asyncHandler(async (req, res) => {
    const adminId = (req as any).userId as string;
    const { id } = req.params;
    const { action, summary } = req.body ?? {};

    const VALID = ['dismiss', 'warn_user', 'shadow_ban_user', 'suspend_user', 'ban_user'];
    if (!action || !VALID.includes(action)) throw new ValidationError('A valid action is required');
    if (!summary || typeof summary !== 'string' || !summary.trim()) {
      throw new ValidationError('A resolution summary is required');
    }

    const r = await db.query(`SELECT * FROM conversation_reports WHERE id = $1`, [id]);
    if (r.rows.length === 0) throw new NotFoundError('Report');
    const report = r.rows[0];
    const target = report.reported_user_id;

    const notes: string[] = [];
    switch (action) {
      case 'shadow_ban_user':
        if (target) { await db.query(`UPDATE users SET shadow_banned = true WHERE id = $1`, [target]); notes.push('shadow-banned reported user'); }
        break;
      case 'suspend_user':
        if (target) { await db.query(`UPDATE users SET account_status = 'suspended' WHERE id = $1`, [target]); notes.push('suspended reported user'); }
        break;
      case 'ban_user':
        if (target) { await db.query(`UPDATE users SET account_status = 'banned' WHERE id = $1`, [target]); notes.push('banned reported user'); }
        break;
      case 'warn_user':
        if (target) {
          createNotification({
            userId: target,
            type: 'moderation_warning',
            title: 'Warning about your conduct',
            body: summary.trim(),
            link: '/dashboard/messages',
          });
          notes.push('warned reported user');
        }
        break;
    }

    const newStatus = action === 'dismiss' ? 'resolved_dismissed' : 'resolved_upheld';
    await db.query(
      `UPDATE conversation_reports
       SET status = $1, resolution_action = $2, resolution_summary = $3,
           resolved_by = $4, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [newStatus, action, summary.trim(), adminId, id],
    );

    if (report.reporter_id) {
      createNotification({
        userId: report.reporter_id,
        type: 'report_resolved',
        title: 'Update on the conversation you reported',
        body: summary.trim(),
        link: '/dashboard/messages',
      });
    }

    logger.warn('Conversation report resolved', { adminId, reportId: id, action, notes });
    res.json({ message: 'Report resolved', action, status: newStatus, notes });
  })
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export default router;
