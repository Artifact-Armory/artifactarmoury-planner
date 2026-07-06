// backend/src/services/tableModels.ts
// Keep the table_models join table (migration 013) in sync with a table's layout.
// Best-effort: a sync failure must never break the table save.

import { db } from '../db';
import logger from '../utils/logger';

const log = logger.child('TABLE_MODELS');

/** Extract the distinct real model ids referenced by a layout (skips part refs). */
function modelIdsFromLayout(layoutData: any): string[] {
  const models = Array.isArray(layoutData?.models) ? layoutData.models : [];
  const ids = new Set<string>();
  for (const m of models) {
    const raw = String(m?.modelId ?? m?.assetId ?? '').trim();
    if (raw && !raw.startsWith('part:')) ids.add(raw);
  }
  return [...ids];
}

/** Replace the table's model links with those in `layoutData`. */
export async function syncTableModels(tableId: string, layoutData: any): Promise<void> {
  try {
    const ids = modelIdsFromLayout(layoutData);
    await db.query('DELETE FROM table_models WHERE table_id = $1', [tableId]);
    if (ids.length === 0) return;
    // id::text = ANY(text[]) tolerates any malformed/non-uuid id without a cast error.
    await db.query(
      `INSERT INTO table_models (table_id, model_id, artist_id)
       SELECT $1, m.id, m.artist_id
       FROM models m
       WHERE m.id::text = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [tableId, ids],
    );
  } catch (err) {
    log.error('syncTableModels failed', { error: err, tableId });
  }
}
