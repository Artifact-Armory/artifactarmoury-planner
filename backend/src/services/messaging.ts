// backend/src/services/messaging.ts
// Messaging core (migration 022). Two conversation kinds:
//   - 'direct'  : exactly two users (buyer <-> artist), de-duped by canonical pair_key.
//   - 'system'  : site -> user(s). sender_id NULL renders as "Artifact Armoury".
//                 allow_replies=true for support DMs, false for broadcasts.
//
// Notifications are best-effort (see services/notifications.ts) so a notify failure
// never blocks the message write.

import { db } from '../db';
import logger from '../utils/logger';
import { createNotification } from './notifications';

const log = logger.child('MSG');

export const SITE_SENDER_NAME = 'Artifact Armoury';

/** Canonical two-user key so (A,B) and (B,A) map to the same direct thread. */
export function directPairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** A direct thread is only allowed when at least one side is an artist/admin. */
export function isArtistLike(role?: string | null): boolean {
  return role === 'artist' || role === 'admin';
}

interface PostMessageInput {
  conversationId: string;
  senderId: string | null; // NULL = site/system
  body: string;
  isSystem?: boolean;
}

/**
 * Insert a message and bump the conversation's last_message_* fields in one
 * transaction. Returns the created message row. Does NOT notify — callers decide
 * (direct/support notify the recipient; large broadcasts skip per-user notifies).
 */
export async function postMessage(input: PostMessageInput): Promise<any> {
  const { conversationId, senderId, body, isSystem = false } = input;
  const preview = body.length > 140 ? `${body.slice(0, 137)}...` : body;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, is_system, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id, sender_id, is_system, body, created_at`,
      [conversationId, senderId, isSystem, body],
    );
    await client.query(
      `UPDATE conversations
       SET last_message_at = CURRENT_TIMESTAMP, last_message_preview = $2
       WHERE id = $1`,
      [conversationId, preview],
    );
    // The sender has, by definition, seen their own message.
    if (senderId) {
      await client.query(
        `UPDATE conversation_participants
         SET last_read_at = CURRENT_TIMESTAMP, archived = false
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, senderId],
      );
    }
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Return the id of the direct conversation between two users, creating it (plus both
 * participant rows) if it doesn't exist yet. Race-safe via the pair_key unique index.
 */
export async function getOrCreateDirectConversation(
  initiatorId: string,
  otherUserId: string,
): Promise<string> {
  const pairKey = directPairKey(initiatorId, otherUserId);

  const existing = await db.query(
    `SELECT id FROM conversations WHERE pair_key = $1`,
    [pairKey],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const conv = await client.query(
      `INSERT INTO conversations (kind, pair_key, allow_replies, created_by)
       VALUES ('direct', $1, true, $2)
       ON CONFLICT (pair_key) WHERE pair_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [pairKey, initiatorId],
    );

    // Lost the race: someone else created it between our SELECT and INSERT.
    if (conv.rows.length === 0) {
      await client.query('ROLLBACK');
      const again = await db.query(`SELECT id FROM conversations WHERE pair_key = $1`, [pairKey]);
      return again.rows[0].id;
    }

    const conversationId = conv.rows[0].id;
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id)
       VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
      [conversationId, initiatorId, otherUserId],
    );
    await client.query('COMMIT');
    return conversationId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Notify the OTHER participant(s) of a direct thread that a new message arrived. */
export async function notifyDirectRecipients(
  conversationId: string,
  senderId: string,
  senderName: string,
  preview: string,
): Promise<void> {
  try {
    const recipients = await db.query(
      `SELECT user_id FROM conversation_participants
       WHERE conversation_id = $1 AND user_id <> $2`,
      [conversationId, senderId],
    );
    for (const r of recipients.rows) {
      await createNotification({
        userId: r.user_id,
        type: 'message',
        title: `New message from ${senderName}`,
        body: preview,
        link: `/dashboard/messages?c=${conversationId}`,
        actorId: senderId,
      });
    }
  } catch (err) {
    log.error('notifyDirectRecipients failed', { error: err, conversationId });
  }
}

interface BroadcastInput {
  subject: string;
  body: string;
  createdBy: string;
  audience: 'all' | 'customers' | 'artists';
}

/**
 * Create a one-way system conversation and fan every targeted user in as a
 * participant. Returns { conversationId, recipients }.
 */
export async function createBroadcast(input: BroadcastInput): Promise<{ conversationId: string; recipients: number }> {
  const { subject, body, createdBy, audience } = input;
  const preview = body.length > 140 ? `${body.slice(0, 137)}...` : body;

  const roleFilter =
    audience === 'customers'
      ? `AND role = 'customer'`
      : audience === 'artists'
      ? `AND role IN ('artist', 'admin')`
      : '';

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const conv = await client.query(
      `INSERT INTO conversations (kind, subject, allow_replies, created_by, last_message_preview)
       VALUES ('system', $1, false, $2, $3)
       RETURNING id`,
      [subject, createdBy, preview],
    );
    const conversationId = conv.rows[0].id;

    // Fan out participants to every active targeted user.
    const parts = await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id)
       SELECT $1, id FROM users
       WHERE account_status = 'active' ${roleFilter}`,
      [conversationId],
    );

    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, is_system, body)
       VALUES ($1, NULL, true, $2)`,
      [conversationId, body],
    );
    await client.query('COMMIT');
    log.info('Broadcast sent', { conversationId, audience, recipients: parts.rowCount });
    return { conversationId, recipients: parts.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get (or create) the site's support conversation with a single user, then post a
 * system message into it. Support threads are repliable. Returns the conversation id.
 */
export async function sendSupportMessage(
  targetUserId: string,
  body: string,
  adminId: string,
  subject?: string,
): Promise<string> {
  // One reusable support thread per user: reuse the most recent repliable system
  // conversation the user participates in, else create one.
  const existing = await db.query(
    `SELECT c.id
     FROM conversations c
     JOIN conversation_participants p ON p.conversation_id = c.id
     WHERE c.kind = 'system' AND c.allow_replies = true AND p.user_id = $1
     ORDER BY c.created_at ASC
     LIMIT 1`,
    [targetUserId],
  );

  let conversationId: string;
  if (existing.rows.length > 0) {
    conversationId = existing.rows[0].id;
  } else {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const conv = await client.query(
        `INSERT INTO conversations (kind, subject, allow_replies, created_by)
         VALUES ('system', $1, true, $2)
         RETURNING id`,
        [subject || 'Message from Artifact Armoury', adminId],
      );
      conversationId = conv.rows[0].id;
      await client.query(
        `INSERT INTO conversation_participants (conversation_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [conversationId, targetUserId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw err;
    }
    client.release();
  }

  await postMessage({ conversationId, senderId: adminId, body, isSystem: true });

  const preview = body.length > 140 ? `${body.slice(0, 137)}...` : body;
  createNotification({
    userId: targetUserId,
    type: 'message',
    title: `New message from ${SITE_SENDER_NAME}`,
    body: preview,
    link: `/dashboard/messages?c=${conversationId}`,
  });

  return conversationId;
}
