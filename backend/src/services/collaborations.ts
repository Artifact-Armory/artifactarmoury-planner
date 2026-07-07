// backend/src/services/collaborations.ts
// Cross-artist collaboration on showcase tables (migration 018).
//
// When artist A places artist B's model on a showcase, B must consent before A can
// publish. Consent is per-table: one request per foreign owner, which B accepts for
// ALL their models on the table or a chosen subset. These helpers are called from
// the table save/update routes (to raise requests) and the publish route (to gate).
// All best-effort work swallows + logs so it never breaks the primary action.

import { db } from '../db';
import logger from '../utils/logger';
import { createNotification } from './notifications';

const log = logger.child('COLLAB');

/** Distinct real model ids referenced by a layout (skips set part refs). */
function modelIdsFromLayout(layoutData: any): string[] {
  const models = Array.isArray(layoutData?.models) ? layoutData.models : [];
  const ids = new Set<string>();
  for (const m of models) {
    const raw = String(m?.modelId ?? m?.assetId ?? '').trim();
    if (raw && !raw.startsWith('part:')) ids.add(raw);
  }
  return [...ids];
}

export interface ForeignModel {
  id: string;
  name: string;
  thumbnail: string | null;
}
export interface ForeignArtist {
  collaboratorId: string;
  name: string;
  models: ForeignModel[];
}

/**
 * The models on a table owned by a DIFFERENT artist than the table owner,
 * grouped by that artist. `requesterId` is the table owner's user id.
 */
export async function foreignArtistModels(
  layoutData: any,
  requesterId: string,
): Promise<ForeignArtist[]> {
  const ids = modelIdsFromLayout(layoutData);
  if (ids.length === 0) return [];
  const result = await db.query(
    `SELECT m.id, m.name, m.thumbnail_path AS thumbnail,
            m.artist_id AS collaborator_id,
            COALESCE(NULLIF(u.artist_name, ''), u.display_name, 'Artist') AS artist_name
     FROM models m
     JOIN users u ON u.id = m.artist_id
     WHERE m.id::text = ANY($1::text[])
       AND m.artist_id IS NOT NULL
       AND m.artist_id <> $2`,
    [ids, requesterId],
  );
  const byArtist = new Map<string, ForeignArtist>();
  for (const r of result.rows) {
    let a = byArtist.get(r.collaborator_id);
    if (!a) {
      a = { collaboratorId: r.collaborator_id, name: r.artist_name, models: [] };
      byArtist.set(r.collaborator_id, a);
    }
    a.models.push({ id: r.id, name: r.name, thumbnail: r.thumbnail });
  }
  return [...byArtist.values()];
}

interface CollabRow {
  id: string;
  collaborator_id: string;
  status: 'pending' | 'accepted' | 'declined';
  approve_all: boolean;
  approved: string[]; // approved model ids (subset) when approve_all = false
}

/** Existing collaboration rows for a table, keyed by collaborator id. */
async function existingCollaborations(tableId: string): Promise<Map<string, CollabRow>> {
  const result = await db.query(
    `SELECT c.id, c.collaborator_id, c.status, c.approve_all,
            COALESCE(array_agg(cm.model_id::text) FILTER (WHERE cm.model_id IS NOT NULL), '{}') AS approved
     FROM table_collaborations c
     LEFT JOIN table_collaboration_models cm ON cm.collaboration_id = c.id
     WHERE c.table_id = $1
     GROUP BY c.id`,
    [tableId],
  );
  return new Map(result.rows.map((r: any) => [r.collaborator_id, r as CollabRow]));
}

/** Notify collaborator B that A wants to feature their models on a table. */
async function notifyRequest(collaboratorId: string, requesterId: string, tableId: string): Promise<void> {
  const [requester, table] = await Promise.all([
    db.query(`SELECT COALESCE(NULLIF(artist_name, ''), display_name, 'An artist') AS name FROM users WHERE id = $1`, [requesterId]),
    db.query('SELECT name FROM user_tables WHERE id = $1', [tableId]),
  ]);
  await createNotification({
    userId: collaboratorId,
    type: 'collab_request',
    title: `${requester.rows[0]?.name ?? 'An artist'} wants to feature your models`,
    body: `In the showcase "${table.rows[0]?.name ?? 'a table'}"`,
    link: '/artist/collaborations',
    actorId: requesterId,
  });
}

/**
 * After a save/update, ensure a collaboration request exists for every foreign
 * artist whose model is on the table and isn't already covered by an acceptance.
 * Creates pending rows (and re-notifies) as needed. Best-effort.
 */
export async function reconcileCollaborations(
  tableId: string,
  requesterId: string,
  layoutData: any,
): Promise<void> {
  try {
    const foreign = await foreignArtistModels(layoutData, requesterId);
    if (foreign.length === 0) return;
    const existing = await existingCollaborations(tableId);

    for (const fa of foreign) {
      const row = existing.get(fa.collaboratorId);
      if (!row) {
        // Brand-new collaborator → raise a pending request + notify.
        const inserted = await db.query(
          `INSERT INTO table_collaborations (table_id, requester_id, collaborator_id, status)
           VALUES ($1, $2, $3, 'pending')
           ON CONFLICT (table_id, collaborator_id) DO NOTHING
           RETURNING id`,
          [tableId, requesterId, fa.collaboratorId],
        );
        if (inserted.rows.length > 0) await notifyRequest(fa.collaboratorId, requesterId, tableId);
      } else if (row.status === 'accepted' && !row.approve_all) {
        // Subset accepted — a newly-added model may fall outside the approved set.
        const approved = new Set((row.approved || []).map(String));
        const hasUnapproved = fa.models.some((m) => !approved.has(String(m.id)));
        if (hasUnapproved) {
          await db.query(
            `UPDATE table_collaborations SET status = 'pending', responded_at = NULL WHERE id = $1`,
            [row.id],
          );
          await notifyRequest(fa.collaboratorId, requesterId, tableId);
        }
      }
      // pending → still waiting; declined → stays blocked until A removes the models.
    }
  } catch (err) {
    log.error('reconcileCollaborations failed', { error: err, tableId });
  }
}

export interface PublishBlocker {
  collaboratorId: string;
  name: string;
  reason: 'pending' | 'declined' | 'unapproved-models';
  modelNames: string[];
}

/**
 * Pure gate decision: given the foreign artists on a table and the existing
 * collaboration rows, return the reasons publishing is blocked. No acceptance →
 * pending; declined → declined; accepted-subset not covering every model on the
 * table → unapproved-models. Extracted so it can be unit-tested without a DB.
 */
export function computeBlockers(
  foreign: ForeignArtist[],
  existing: Map<string, Pick<CollabRow, 'status' | 'approve_all' | 'approved'>>,
): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  for (const fa of foreign) {
    const row = existing.get(fa.collaboratorId);
    if (!row || row.status === 'pending') {
      blockers.push({ collaboratorId: fa.collaboratorId, name: fa.name, reason: 'pending', modelNames: fa.models.map((m) => m.name) });
      continue;
    }
    if (row.status === 'declined') {
      blockers.push({ collaboratorId: fa.collaboratorId, name: fa.name, reason: 'declined', modelNames: fa.models.map((m) => m.name) });
      continue;
    }
    // accepted
    if (!row.approve_all) {
      const approved = new Set((row.approved || []).map(String));
      const unapproved = fa.models.filter((m) => !approved.has(String(m.id)));
      if (unapproved.length > 0) {
        blockers.push({ collaboratorId: fa.collaboratorId, name: fa.name, reason: 'unapproved-models', modelNames: unapproved.map((m) => m.name) });
      }
    }
  }
  return blockers;
}

/**
 * Reasons the table cannot be made public. Empty array = safe to publish.
 */
export async function publishBlockers(
  tableId: string,
  requesterId: string,
  layoutData: any,
): Promise<PublishBlocker[]> {
  const foreign = await foreignArtistModels(layoutData, requesterId);
  if (foreign.length === 0) return [];
  const existing = await existingCollaborations(tableId);
  return computeBlockers(foreign, existing);
}
