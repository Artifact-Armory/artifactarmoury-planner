// backend/src/routes/notifications.ts
// In-app notification inbox for the signed-in user (migration 012).

import { Router } from 'express';
import { db } from '../db';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

const router = Router();

// List the user's notifications (most recent first).
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    const limit = Math.min(Number(req.query.limit) || 30, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await db.query(
      `SELECT n.id, n.type, n.title, n.body, n.link, n.actor_id, n.model_id, n.is_read, n.created_at,
              COALESCE(NULLIF(a.artist_name, ''), a.display_name) AS actor_name,
              a.artist_avatar_url AS actor_avatar
       FROM notifications n
       LEFT JOIN users a ON a.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    res.json({ notifications: result.rows, limit, offset });
  }),
);

// Unread count (drives the header badge).
router.get(
  '/unread-count',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    const result = await db.query(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId],
    );
    res.json({ count: parseInt(result.rows[0]?.c ?? '0', 10) || 0 });
  }),
);

// Mark one notification read.
router.post(
  '/:id/read',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    await db.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, userId],
    );
    res.json({ ok: true });
  }),
);

// Mark all read.
router.post(
  '/read-all',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = (req as any).userId;
    await db.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [userId],
    );
    res.json({ ok: true });
  }),
);

export default router;
