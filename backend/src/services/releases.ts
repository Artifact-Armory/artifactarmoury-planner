// backend/src/services/releases.ts
// Scheduled releases ("drops"): publish an artist's models/bundles/tables together
// at a chosen time. Shared publish + validation logic, plus the in-process scheduler.

import { db } from '../db';
import logger from '../utils/logger';
import { assertRequiredTermsPresent } from './modelTerms';
import { notifyFollowersOfRelease } from './notifications';

const releasesLogger = logger.child('RELEASES');

export type ReleaseItemType = 'model' | 'bundle' | 'table';

interface ReleaseRow {
  id: string;
  artist_id: string;
  name: string;
  status: string;
  scheduled_at: string | null;
}

// ============================================================================
// PER-ITEM PUBLISHABILITY
// ============================================================================

/**
 * Return a human-readable reason this item can't be published yet, or null if it
 * is ready. Used both to block scheduling up-front and to guard the actual publish.
 */
export async function itemPublishBlocker(
  type: ReleaseItemType,
  itemId: string,
  artistId: string,
): Promise<string | null> {
  if (type === 'model') {
    const m = (await db.query(
      `SELECT name, thumbnail_path, processing_status FROM models WHERE id = $1 AND artist_id = $2`,
      [itemId, artistId],
    )).rows[0];
    if (!m) return 'A model in this release no longer exists';
    if (m.processing_status && m.processing_status !== 'ready') return `"${m.name}" is still processing`;
    if (!m.thumbnail_path) return `"${m.name}" needs a thumbnail`;
    try {
      await assertRequiredTermsPresent(itemId);
    } catch (err) {
      return `"${m.name}": ${(err as Error).message}`;
    }
    return null;
  }
  if (type === 'bundle') {
    const b = (await db.query(
      `SELECT b.name, b.description, b.price, b.thumbnail_path, COUNT(bi.model_id) AS model_count
       FROM bundles b LEFT JOIN bundle_items bi ON bi.bundle_id = b.id
       WHERE b.id = $1 AND b.artist_id = $2 GROUP BY b.id`,
      [itemId, artistId],
    )).rows[0];
    if (!b) return 'A bundle in this release no longer exists';
    if (!b.thumbnail_path) return `Bundle "${b.name}" needs a thumbnail`;
    if (!b.description || b.description.length < 20) return `Bundle "${b.name}" needs a 20+ character description`;
    if (parseFloat(b.price) <= 0) return `Bundle "${b.name}" needs a price above 0`;
    if (Number(b.model_count) < 2) return `Bundle "${b.name}" needs at least 2 models`;
    return null;
  }
  // table
  const t = (await db.query(
    `SELECT ut.name FROM user_tables ut JOIN users u ON u.email = ut.user_email
     WHERE ut.id = $1 AND u.id = $2`,
    [itemId, artistId],
  )).rows[0];
  if (!t) return 'A table in this release no longer exists';
  return null;
}

/** Publish one item (idempotent). Throws if it can't be published. */
async function publishItem(type: ReleaseItemType, itemId: string, artistId: string): Promise<void> {
  const blocker = await itemPublishBlocker(type, itemId, artistId);
  if (blocker) throw new Error(blocker);

  if (type === 'model') {
    const first = (await db.query(`SELECT published_at FROM models WHERE id = $1`, [itemId])).rows[0];
    await db.query(
      `UPDATE models SET status = 'published', visibility = 'public',
         published_at = COALESCE(published_at, CURRENT_TIMESTAMP) WHERE id = $1`,
      [itemId],
    );
    if (first && !first.published_at) notifyFollowersOfRelease(artistId, itemId);
    return;
  }
  if (type === 'bundle') {
    await db.query(
      `UPDATE bundles SET status = 'published', visibility = 'public',
         published_at = COALESCE(published_at, CURRENT_TIMESTAMP) WHERE id = $1`,
      [itemId],
    );
    return;
  }
  await db.query(`UPDATE user_tables SET is_public = true, updated_at = NOW() WHERE id = $1`, [itemId]);
}

// ============================================================================
// RELEASE-LEVEL VALIDATION + PUBLISH
// ============================================================================

/** All the reasons a release can't be scheduled/published yet (empty = good to go). */
export async function releaseBlockers(releaseId: string, artistId: string): Promise<string[]> {
  const items = (await db.query(
    `SELECT item_type, item_id FROM release_items WHERE release_id = $1`,
    [releaseId],
  )).rows;
  if (items.length === 0) return ['Add at least one model, bundle, or table to the release'];
  const blockers: string[] = [];
  for (const it of items) {
    const b = await itemPublishBlocker(it.item_type, it.item_id, artistId);
    if (b) blockers.push(b);
  }
  return blockers;
}

/**
 * Publish an entire release now. Claims the release (status → published) atomically
 * so overlapping scheduler ticks can't double-run it, then publishes each item
 * best-effort, recording per-item failures without aborting the rest.
 */
export async function publishRelease(releaseId: string): Promise<void> {
  const claim = await db.query(
    `UPDATE releases SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = NOW()
     WHERE id = $1 AND status IN ('scheduled', 'draft')
     RETURNING id, artist_id, name`,
    [releaseId],
  );
  if (claim.rows.length === 0) return; // already published/cancelled or claimed elsewhere
  const release = claim.rows[0] as ReleaseRow;

  const items = (await db.query(
    `SELECT id, item_type, item_id FROM release_items WHERE release_id = $1`,
    [releaseId],
  )).rows;

  const failures: string[] = [];
  for (const it of items) {
    try {
      await publishItem(it.item_type, it.item_id, release.artist_id);
      await db.query(`UPDATE release_items SET published = true, publish_error = NULL WHERE id = $1`, [it.id]);
    } catch (err) {
      const msg = (err as Error).message || 'Publish failed';
      failures.push(msg);
      await db.query(`UPDATE release_items SET published = false, publish_error = $1 WHERE id = $2`, [msg, it.id]);
    }
  }

  await db.query(
    `UPDATE releases SET publish_error = $1, updated_at = NOW() WHERE id = $2`,
    [failures.length ? failures.join('; ').slice(0, 1000) : null, releaseId],
  );

  releasesLogger.info('Release published', {
    releaseId,
    name: release.name,
    items: items.length,
    failures: failures.length,
  });
}

// ============================================================================
// SCHEDULER (in-process, like the temp-file cleanup jobs)
// ============================================================================

let started = false;

/**
 * Start the release scheduler: a catch-up sweep shortly after boot (in case the
 * process was down when a release was due) and then a poll every 60s. Runs in the
 * single Railway service; move to a real queue if this ever needs multiple workers.
 */
export function startReleaseScheduler(): void {
  if (started) return;
  if (process.env.DB_MOCK === 'true') return; // no DB in mock/dev
  started = true;

  const tick = async () => {
    try {
      const due = await db.query(
        `SELECT id FROM releases
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= now()`,
      );
      for (const r of due.rows) {
        await publishRelease(r.id).catch((err) =>
          releasesLogger.error('Scheduled release failed to publish', { error: err, releaseId: r.id }),
        );
      }
    } catch (err) {
      releasesLogger.error('Release scheduler tick failed', { error: err });
    }
  };

  setTimeout(tick, 5000);
  setInterval(tick, 60_000);
  releasesLogger.info('Release scheduler started');
}
