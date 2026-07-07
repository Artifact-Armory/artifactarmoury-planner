// backend/src/routes/collaborations.ts
// The model owner's (B's) side of cross-artist showcase collaboration (migration
// 018): list requests addressed to me, and accept (all or a subset) / decline.

import { Router } from 'express';
import { db } from '../db';
import { authenticate, requireArtist, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { createNotification } from '../services/notifications';
import logger from '../utils/logger';

const router = Router();
const log = logger.child('COLLAB');

// Incoming requests for the signed-in artist, each with the requester, the table,
// and the specific models of theirs on that table (with current approval state).
router.get(
  '/incoming',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const me = req.user!.id;
    const result = await db.query(
      `SELECT c.id,
              c.table_id AS "tableId",
              c.status,
              c.approve_all AS "approveAll",
              t.name AS "tableName",
              ru.id AS "requesterId",
              COALESCE(NULLIF(ru.artist_name, ''), ru.display_name, 'An artist') AS "requesterName",
              c.created_at AS "createdAt",
              COALESCE(mods.models, '[]'::json) AS models
       FROM table_collaborations c
       JOIN user_tables t ON t.id = c.table_id
       JOIN users ru ON ru.id = c.requester_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'id', m.id, 'name', m.name, 'thumbnail', m.thumbnail_path,
                  'approved', EXISTS (
                    SELECT 1 FROM table_collaboration_models cm
                    WHERE cm.collaboration_id = c.id AND cm.model_id = m.id
                  )
                ) ORDER BY m.name) AS models
         FROM table_models tm
         JOIN models m ON m.id = tm.model_id
         WHERE tm.table_id = c.table_id AND tm.artist_id = $1
       ) mods ON true
       WHERE c.collaborator_id = $1
       ORDER BY (c.status = 'pending') DESC, c.created_at DESC`,
      [me],
    );
    res.json({ requests: result.rows });
  }),
);

// Respond to a request. Only the addressed collaborator may respond.
router.post(
  '/:id/respond',
  authenticate,
  requireArtist,
  asyncHandler(async (req: AuthRequest, res) => {
    const me = req.user!.id;
    const { id } = req.params;
    const { decision, approveAll, modelIds } = req.body as {
      decision?: 'accept' | 'decline';
      approveAll?: boolean;
      modelIds?: string[];
    };

    if (decision !== 'accept' && decision !== 'decline') {
      return res.status(400).json({ error: 'decision must be "accept" or "decline"' });
    }

    const found = await db.query(
      'SELECT id, table_id, requester_id, collaborator_id FROM table_collaborations WHERE id = $1',
      [id],
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const collab = found.rows[0];
    if (collab.collaborator_id !== me) return res.status(403).json({ error: 'Forbidden' });

    if (decision === 'decline') {
      await db.query(
        `UPDATE table_collaborations SET status = 'declined', approve_all = false, responded_at = NOW() WHERE id = $1`,
        [id],
      );
      await db.query('DELETE FROM table_collaboration_models WHERE collaboration_id = $1', [id]);
      await notifyResponse(collab.requester_id, me, collab.table_id, false);
      return res.json({ ok: true, status: 'declined' });
    }

    // accept
    const all = approveAll === true;
    if (!all && (!Array.isArray(modelIds) || modelIds.length === 0)) {
      return res.status(400).json({ error: 'Select at least one model, or approve all' });
    }

    await db.query(
      `UPDATE table_collaborations SET status = 'accepted', approve_all = $2, responded_at = NOW() WHERE id = $1`,
      [id, all],
    );
    await db.query('DELETE FROM table_collaboration_models WHERE collaboration_id = $1', [id]);
    if (!all) {
      // Only persist ids that are genuinely this artist's models (defensive).
      await db.query(
        `INSERT INTO table_collaboration_models (collaboration_id, model_id)
         SELECT $1, m.id FROM models m
         WHERE m.id::text = ANY($2::text[]) AND m.artist_id = $3
         ON CONFLICT DO NOTHING`,
        [id, modelIds, me],
      );
    }
    await notifyResponse(collab.requester_id, me, collab.table_id, true);
    res.json({ ok: true, status: 'accepted', approveAll: all });
  }),
);

/** Tell the requester (A) that B accepted/declined their collaboration request. */
async function notifyResponse(requesterId: string, responderId: string, tableId: string, accepted: boolean): Promise<void> {
  try {
    const [responder, table] = await Promise.all([
      db.query(`SELECT COALESCE(NULLIF(artist_name, ''), display_name, 'An artist') AS name FROM users WHERE id = $1`, [responderId]),
      db.query('SELECT name FROM user_tables WHERE id = $1', [tableId]),
    ]);
    const who = responder.rows[0]?.name ?? 'An artist';
    const tbl = table.rows[0]?.name ?? 'your showcase';
    await createNotification({
      userId: requesterId,
      type: accepted ? 'collab_accepted' : 'collab_declined',
      title: accepted ? `${who} accepted your collaboration` : `${who} declined your collaboration`,
      body: accepted ? `You can now publish "${tbl}"` : `You'll need to remove their models to publish "${tbl}"`,
      link: '/artist/showcases',
      actorId: responderId,
    });
  } catch (err) {
    log.error('notifyResponse failed', { error: err, requesterId, tableId });
  }
}

export default router;
