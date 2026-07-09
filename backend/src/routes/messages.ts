// backend/src/routes/messages.ts
// Messaging inbox for the signed-in user (migration 022).
//   - direct threads: buyer <-> artist (at least one side must be an artist/admin)
//   - system threads: site -> user (broadcast = one-way; support DM = repliable)
// Delivery is polled by the client (unread-count + list), matching notifications.

import { Router } from 'express';
import { db } from '../db';
import logger from '../utils/logger';
import { authenticate, AuthRequest, isAdmin } from '../middleware/auth';
import { asyncHandler, ValidationError, NotFoundError, AuthorizationError } from '../middleware/error';
import {
  getOrCreateDirectConversation,
  postMessage,
  isArtistLike,
  notifyDirectRecipients,
  SITE_SENDER_NAME,
} from '../services/messaging';
import { createNotification } from '../services/notifications';

const router = Router();

const MAX_BODY = 5000;

function senderDisplayName(user: AuthRequest['user']): string {
  return (user?.artist_name && user.artist_name.trim()) || user?.display_name || 'A user';
}

// ============================================================================
// UNREAD COUNT  (drives the header badge)
// ============================================================================

router.get(
  '/unread-count',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const result = await db.query(
      `SELECT COUNT(*) AS c
       FROM messages m
       JOIN conversation_participants p
         ON p.conversation_id = m.conversation_id AND p.user_id = $1
       WHERE p.archived = false
         AND m.created_at > p.last_read_at
         AND (m.sender_id IS NULL OR m.sender_id <> $1)`,
      [userId],
    );
    res.json({ count: parseInt(result.rows[0]?.c ?? '0', 10) || 0 });
  }),
);

// ============================================================================
// LIST CONVERSATIONS
// ============================================================================

router.get(
  '/',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const limit = Math.min(Number(req.query.limit) || 30, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const result = await db.query(
      `SELECT c.id, c.kind, c.subject, c.allow_replies,
              c.last_message_at, c.last_message_preview,
              other.id AS other_id, other.name AS other_name,
              other.avatar AS other_avatar, other.role AS other_role,
              (SELECT COUNT(*) FROM messages m
               WHERE m.conversation_id = c.id
                 AND m.created_at > p.last_read_at
                 AND (m.sender_id IS NULL OR m.sender_id <> $1)) AS unread
       FROM conversation_participants p
       JOIN conversations c ON c.id = p.conversation_id
       LEFT JOIN LATERAL (
         SELECT u.id, COALESCE(NULLIF(u.artist_name, ''), u.display_name) AS name,
                u.artist_avatar_url AS avatar, u.role
         FROM conversation_participants pp
         JOIN users u ON u.id = pp.user_id
         WHERE pp.conversation_id = c.id AND pp.user_id <> $1 AND c.kind = 'direct'
         LIMIT 1
       ) other ON true
       WHERE p.user_id = $1 AND p.archived = false
       ORDER BY c.last_message_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    res.json({ conversations: result.rows });
  }),
);

// ============================================================================
// START (or reuse) A DIRECT CONVERSATION WITH AN ARTIST
// ============================================================================

router.post(
  '/start',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const { recipientId, body } = req.body ?? {};

    if (!recipientId || typeof recipientId !== 'string') {
      throw new ValidationError('recipientId is required');
    }
    if (recipientId === userId) {
      throw new ValidationError('You cannot message yourself');
    }
    if (req.user?.shadow_banned) {
      throw new AuthorizationError('Your account is restricted from sending messages');
    }

    const recipient = await db.query(
      `SELECT id, role, account_status,
              COALESCE(NULLIF(artist_name, ''), display_name) AS name
       FROM users WHERE id = $1`,
      [recipientId],
    );
    if (recipient.rows.length === 0) throw new NotFoundError('User');
    const rcpt = recipient.rows[0];
    if (rcpt.account_status !== 'active') {
      throw new ValidationError('This user is not able to receive messages');
    }

    // Buyer <-> artist only: at least one side must be an artist/admin.
    if (!isArtistLike(req.user?.role) && !isArtistLike(rcpt.role)) {
      throw new AuthorizationError('You can only start a conversation with an artist');
    }

    const conversationId = await getOrCreateDirectConversation(userId, recipientId);

    // Optional opening message.
    if (typeof body === 'string' && body.trim()) {
      const trimmed = body.trim().slice(0, MAX_BODY);
      await postMessage({ conversationId, senderId: userId, body: trimmed });
      const name = senderDisplayName(req.user);
      const preview = trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
      notifyDirectRecipients(conversationId, userId, name, preview);
    }

    res.status(201).json({ conversationId });
  }),
);

// ============================================================================
// GET ONE CONVERSATION (messages) + mark read
// ============================================================================

router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const conversationId = req.params.id;

    const convResult = await db.query(
      `SELECT c.id, c.kind, c.subject, c.allow_replies, c.created_at,
              other.id AS other_id, other.name AS other_name,
              other.avatar AS other_avatar, other.role AS other_role
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT u.id, COALESCE(NULLIF(u.artist_name, ''), u.display_name) AS name,
                u.artist_avatar_url AS avatar, u.role
         FROM conversation_participants pp
         JOIN users u ON u.id = pp.user_id
         WHERE pp.conversation_id = c.id AND pp.user_id <> $2 AND c.kind = 'direct'
         LIMIT 1
       ) other ON true
       WHERE c.id = $1`,
      [conversationId, userId],
    );
    if (convResult.rows.length === 0) throw new NotFoundError('Conversation');
    const conv = convResult.rows[0];

    const participant = await db.query(
      `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    const isParticipant = participant.rows.length > 0;
    // Admins may read any conversation (support management); otherwise must be in it.
    if (!isParticipant && !isAdmin(req)) {
      throw new AuthorizationError('You are not a participant in this conversation');
    }

    const messages = await db.query(
      `SELECT m.id, m.sender_id, m.is_system, m.body, m.created_at,
              CASE WHEN m.is_system THEN NULL
                   ELSE COALESCE(NULLIF(u.artist_name, ''), u.display_name) END AS sender_name,
              CASE WHEN m.is_system THEN NULL ELSE u.artist_avatar_url END AS sender_avatar
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId],
    );

    // Mark read for participants (opening the thread clears its badge).
    if (isParticipant) {
      await db.query(
        `UPDATE conversation_participants SET last_read_at = CURRENT_TIMESTAMP
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, userId],
      );
    }

    res.json({ conversation: conv, messages: messages.rows });
  }),
);

// ============================================================================
// SEND A MESSAGE IN A CONVERSATION
// ============================================================================

router.post(
  '/:id/messages',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const conversationId = req.params.id;
    const { body } = req.body ?? {};

    if (!body || typeof body !== 'string' || !body.trim()) {
      throw new ValidationError('Message body is required');
    }
    const trimmed = body.trim().slice(0, MAX_BODY);

    const convResult = await db.query(
      `SELECT id, kind, allow_replies FROM conversations WHERE id = $1`,
      [conversationId],
    );
    if (convResult.rows.length === 0) throw new NotFoundError('Conversation');
    const conv = convResult.rows[0];

    const participant = await db.query(
      `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    const isParticipant = participant.rows.length > 0;

    let asSystem = false;
    if (isParticipant) {
      if (conv.kind === 'system' && !conv.allow_replies) {
        throw new AuthorizationError('You cannot reply to this announcement');
      }
      if (req.user?.shadow_banned) {
        throw new AuthorizationError('Your account is restricted from sending messages');
      }
    } else if (isAdmin(req) && conv.kind === 'system') {
      // Admin responding to a support thread they don't participate in → speak as the site.
      asSystem = true;
    } else {
      throw new AuthorizationError('You are not a participant in this conversation');
    }

    const message = await postMessage({
      conversationId,
      senderId: userId,
      body: trimmed,
      isSystem: asSystem,
    });

    // Notify the other participant(s). System (site) messages show as Artifact Armoury.
    const preview = trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
    const name = asSystem ? SITE_SENDER_NAME : senderDisplayName(req.user);
    try {
      const recipients = await db.query(
        `SELECT user_id FROM conversation_participants
         WHERE conversation_id = $1 AND user_id <> $2`,
        [conversationId, userId],
      );
      for (const r of recipients.rows) {
        await createNotification({
          userId: r.user_id,
          type: 'message',
          title: `New message from ${name}`,
          body: preview,
          link: `/dashboard/messages?c=${conversationId}`,
          actorId: asSystem ? null : userId,
        });
      }
    } catch (err) {
      logger.error('message notify failed', { error: err, conversationId });
    }

    res.status(201).json({ message: { ...message, sender_name: asSystem ? null : name } });
  }),
);

// ============================================================================
// MARK READ / ARCHIVE
// ============================================================================

router.post(
  '/:id/read',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    await db.query(
      `UPDATE conversation_participants SET last_read_at = CURRENT_TIMESTAMP
       WHERE conversation_id = $1 AND user_id = $2`,
      [req.params.id, req.userId!],
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/archive',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    await db.query(
      `UPDATE conversation_participants SET archived = true
       WHERE conversation_id = $1 AND user_id = $2`,
      [req.params.id, req.userId!],
    );
    res.json({ ok: true });
  }),
);

export default router;
