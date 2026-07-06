// backend/src/services/notifications.ts
// In-app notifications (migration 012). Fire-and-forget helpers — callers should
// never let a notification failure break the primary action, so these swallow +
// log their own errors.

import { db } from '../db';
import logger from '../utils/logger';

const log = logger.child('NOTIFY');

interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId?: string | null;
  modelId?: string | null;
}

export async function createNotification(n: NotificationInput): Promise<void> {
  try {
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, link, actor_id, model_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [n.userId, n.type, n.title, n.body ?? null, n.link ?? null, n.actorId ?? null, n.modelId ?? null],
    );
  } catch (err) {
    log.error('createNotification failed', { error: err, type: n.type, userId: n.userId });
  }
}

/**
 * Notify every follower of `artistId` that they published `modelId`. One INSERT …
 * SELECT fans out to all followers (the retention loop). Best-effort.
 */
export async function notifyFollowersOfRelease(artistId: string, modelId: string): Promise<void> {
  try {
    const artist = await db.query(
      `SELECT COALESCE(NULLIF(artist_name, ''), display_name) AS name FROM users WHERE id = $1`,
      [artistId],
    );
    const model = await db.query('SELECT name FROM models WHERE id = $1', [modelId]);
    const artistName = artist.rows[0]?.name ?? 'An artist you follow';
    const modelName = model.rows[0]?.name ?? 'a new model';

    const result = await db.query(
      `INSERT INTO notifications (user_id, type, title, body, link, actor_id, model_id)
       SELECT f.follower_id, 'new_release', $2, $3, $4, $1, $5
       FROM follows f
       WHERE f.artist_id = $1`,
      [
        artistId,
        `${artistName} released a new model`,
        modelName,
        `/models/${modelId}`,
        modelId,
      ],
    );
    log.info('Release notifications fanned out', { artistId, modelId, recipients: result.rowCount });
  } catch (err) {
    log.error('notifyFollowersOfRelease failed', { error: err, artistId, modelId });
  }
}

/** Notify an artist that a user followed them. Best-effort. */
export async function notifyNewFollower(artistId: string, followerId: string): Promise<void> {
  try {
    const follower = await db.query(
      `SELECT COALESCE(NULLIF(artist_name, ''), display_name) AS name FROM users WHERE id = $1`,
      [followerId],
    );
    await createNotification({
      userId: artistId,
      type: 'new_follower',
      title: `${follower.rows[0]?.name ?? 'Someone'} followed you`,
      link: `/artists/${followerId}`,
      actorId: followerId,
    });
  } catch (err) {
    log.error('notifyNewFollower failed', { error: err, artistId, followerId });
  }
}
