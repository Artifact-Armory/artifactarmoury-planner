// backend/src/services/notifications.ts
// In-app notifications (migration 012). Fire-and-forget helpers — callers should
// never let a notification failure break the primary action, so these swallow +
// log their own errors.

import { db } from '../db';
import logger from '../utils/logger';
import { sendNoticeEmail } from './email';
import { emailFollowersOfRelease, emailFollowersOfSale } from './followerEmails';

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

/**
 * Notification types that are ALSO emailed: money events the recipient shouldn't
 * miss. Deliberately NOT upload/preview failures — those live in the in-app bell
 * (and My Models) only. The bell row is written first, so a failed email never
 * loses the in-app copy.
 */
const EMAIL_MIRRORED: Record<string, { cta: string }> = {
  'payout_paid': { cta: 'View payouts' },
};

export async function createNotification(n: NotificationInput): Promise<void> {
  try {
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, link, actor_id, model_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [n.userId, n.type, n.title, n.body ?? null, n.link ?? null, n.actorId ?? null, n.modelId ?? null],
    );
  } catch (err) {
    log.error('createNotification failed', { error: err, type: n.type, userId: n.userId });
    return;
  }

  const mirror = EMAIL_MIRRORED[n.type];
  if (!mirror) return;
  try {
    const u = await db.query('SELECT email FROM users WHERE id = $1', [n.userId]);
    const to = u.rows[0]?.email;
    if (!to) return;
    await sendNoticeEmail({
      to,
      subject: n.title,
      heading: n.title,
      paragraphs: [n.body || n.title],
      cta: n.link ? { label: mirror.cta, path: n.link } : undefined,
    });
  } catch (err) {
    log.error('notification email failed', { error: err, type: n.type, userId: n.userId });
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
    await emailFollowersOfRelease({ artistId, artistName, modelId, modelName });
  } catch (err) {
    log.error('notifyFollowersOfRelease failed', { error: err, artistId, modelId });
  }
}

/**
 * Notify every follower of the artist that a sale has started. One INSERT … SELECT
 * fans out to all followers, like notifyFollowersOfRelease. Sales always start at
 * creation (routes/sales.ts inserts starts_at = NOW()), so this is called once from
 * there. Followers who already own the discounted model are skipped — telling them
 * about a discount on something they've bought is noise. Best-effort.
 */
export async function notifyFollowersOfSale(sale: {
  artist_id: string;
  scope: 'model' | 'bundle' | 'portfolio';
  target_id: string | null;
  discount_percent: number;
  ends_at: string | Date;
}): Promise<void> {
  try {
    const artist = await db.query(
      `SELECT COALESCE(NULLIF(artist_name, ''), display_name) AS name FROM users WHERE id = $1`,
      [sale.artist_id],
    );
    const artistName = artist.rows[0]?.name ?? 'An artist you follow';

    let what = 'their whole catalogue';
    let link = `/artists/${sale.artist_id}`;
    let modelId: string | null = null;
    if (sale.scope === 'model' && sale.target_id) {
      const m = await db.query('SELECT name FROM models WHERE id = $1', [sale.target_id]);
      what = `“${m.rows[0]?.name ?? 'a model'}”`;
      link = `/models/${sale.target_id}`;
      modelId = sale.target_id;
    } else if (sale.scope === 'bundle' && sale.target_id) {
      const b = await db.query('SELECT name FROM bundles WHERE id = $1', [sale.target_id]);
      what = `the “${b.rows[0]?.name ?? 'a'}” bundle`;
      link = `/bundles/${sale.target_id}`;
    }

    const endsOn = new Date(sale.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    const result = await db.query(
      `INSERT INTO notifications (user_id, type, title, body, link, actor_id, model_id)
       SELECT f.follower_id, 'new_sale', $2, $3, $4, $1, $5
       FROM follows f
       WHERE f.artist_id = $1
         AND ($5::uuid IS NULL OR NOT EXISTS (
               SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
               WHERE oi.model_id = $5 AND o.user_id = f.follower_id
                 AND o.payment_status = 'succeeded' AND oi.refunded_at IS NULL))`,
      [
        sale.artist_id,
        `${artistName} started a sale`,
        `${sale.discount_percent}% off ${what} — ends ${endsOn}.`,
        link,
        modelId,
      ],
    );
    log.info('Sale notifications fanned out', { artistId: sale.artist_id, scope: sale.scope, recipients: result.rowCount });
    await emailFollowersOfSale({
      artistId: sale.artist_id,
      artistName,
      what,
      percent: sale.discount_percent,
      endsOn,
      ctaPath: link,
      modelId,
    });
  } catch (err) {
    log.error('notifyFollowersOfSale failed', { error: err, artistId: sale.artist_id });
  }
}

/**
 * Notify everyone who owns `modelId` that the artist published an updated file
 * version — they can re-download the new version for free (entitlement is per
 * model, not per version). One INSERT … SELECT fans out to all distinct buyers
 * with a succeeded order. Best-effort.
 */
export async function notifyOwnersOfModelUpdate(
  modelId: string,
  version: number,
  notes?: string | null,
): Promise<void> {
  try {
    const model = await db.query('SELECT name FROM models WHERE id = $1', [modelId]);
    const modelName = model.rows[0]?.name ?? 'a model you own';
    const body = notes && notes.trim()
      ? `Version ${version}: ${notes.trim()}`
      : `Version ${version} is now available — re-download it free from your library.`;

    const result = await db.query(
      `INSERT INTO notifications (user_id, type, title, body, link, model_id)
       SELECT DISTINCT o.user_id, 'model_updated', $2, $3, $4, $1
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.model_id = $1
         AND o.payment_status = 'succeeded'
         AND o.user_id IS NOT NULL`,
      [modelId, `“${modelName}” has an updated file`, body, `/models/${modelId}`],
    );
    log.info('Model-update notifications fanned out', { modelId, version, recipients: result.rowCount });
  } catch (err) {
    log.error('notifyOwnersOfModelUpdate failed', { error: err, modelId });
  }
}

/**
 * Fan out an in-app notification to every admin user. Used for things an admin
 * should be aware of but that don't belong in a single user's inbox — e.g. an
 * artist overriding a serious mesh-QA warning to publish anyway.
 */
async function notifyAdmins(input: Omit<NotificationInput, 'userId'>): Promise<void> {
  try {
    const result = await db.query(
      `INSERT INTO notifications (user_id, type, title, body, link, actor_id, model_id)
       SELECT id, $1, $2, $3, $4, $5, $6
       FROM users WHERE role = 'admin'`,
      [input.type, input.title, input.body ?? null, input.link ?? null, input.actorId ?? null, input.modelId ?? null],
    );
    log.info('Admin notification fanned out', { type: input.type, recipients: result.rowCount });
  } catch (err) {
    log.error('notifyAdmins failed', { error: err, type: input.type });
  }
}

/**
 * Processing-queue alarm (services/queueAlarm.ts). Goes to the in-app admin bell
 * as well as email, because sendEmail() logs-and-swallows its failures by design
 * — if Resend is misconfigured the email channel fails silently, which is the
 * one thing an outage alarm must not do.
 */
export async function notifyAdminsOfQueueAlarm(title: string, body: string): Promise<void> {
  await notifyAdmins({
    type: 'admin.queue_alarm',
    title,
    body,
    link: '/admin/queues',
  })
}

/**
 * An artist chose to publish (or keep published) a model despite a serious mesh
 * QA warning (real open edges/holes) — let admins know so a pattern of ignored
 * warnings across a listing or an artist is visible, not silent.
 */
export async function notifyAdminsOfMeshOverride(
  modelId: string,
  artistId: string,
  openEdges: number,
): Promise<void> {
  try {
    const [artist, model] = await Promise.all([
      db.query(`SELECT COALESCE(NULLIF(artist_name, ''), display_name) AS name FROM users WHERE id = $1`, [artistId]),
      db.query('SELECT name FROM models WHERE id = $1', [modelId]),
    ]);
    const artistName = artist.rows[0]?.name ?? 'An artist';
    const modelName = model.rows[0]?.name ?? 'a model';
    await notifyAdmins({
      type: 'mesh_warning_overridden',
      title: `${artistName} overrode a mesh warning on "${modelName}"`,
      body: `${openEdges.toLocaleString()} open edge${openEdges === 1 ? '' : 's'} detected. The artist acknowledged the warning and chose to publish anyway.`,
      link: `/models/${modelId}`,
      actorId: artistId,
      modelId,
    });
  } catch (err) {
    log.error('notifyAdminsOfMeshOverride failed', { error: err, modelId, artistId });
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
