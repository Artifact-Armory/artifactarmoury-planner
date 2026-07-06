// backend/src/services/analytics.ts
// Fire-and-forget event logging into analytics_events (migration 014). Every helper
// swallows its own errors — analytics must NEVER break the request that emitted it.

import { db } from '../db';
import logger from '../utils/logger';

const log = logger.child('ANALYTICS');

export type EventType = 'product_view' | 'search_query' | 'planner_placement' | 'wishlist_add';

export interface AnalyticsEvent {
  type: EventType;
  modelId?: string | null;
  artistId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  query?: string | null;
  resultCount?: number | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Insert one event. Best-effort, non-blocking (don't await in hot paths). */
export function logEvent(e: AnalyticsEvent): void {
  db.query(
    `INSERT INTO analytics_events
       (type, model_id, artist_id, user_id, session_id, query, result_count, source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      e.type,
      e.modelId ?? null,
      e.artistId ?? null,
      e.userId ?? null,
      e.sessionId ?? null,
      e.query ?? null,
      e.resultCount ?? null,
      e.source ?? null,
      e.metadata ? JSON.stringify(e.metadata) : null,
    ],
  ).catch((err) => log.error('logEvent failed', { error: err, type: e.type }));
}

export const logProductView = (
  modelId: string,
  artistId: string | null,
  opts: { userId?: string | null; sessionId?: string | null; source?: string | null } = {},
) => logEvent({ type: 'product_view', modelId, artistId, ...opts });

export const logSearch = (
  query: string,
  resultCount: number,
  opts: { userId?: string | null; sessionId?: string | null } = {},
) => logEvent({ type: 'search_query', query: query.slice(0, 200), resultCount, ...opts });

export const logPlannerPlacement = (
  modelId: string,
  artistId: string | null,
  opts: { userId?: string | null; sessionId?: string | null } = {},
) => logEvent({ type: 'planner_placement', modelId, artistId, source: 'planner', ...opts });

export const logWishlistAdd = (
  modelId: string,
  artistId: string | null,
  opts: { userId?: string | null } = {},
) => logEvent({ type: 'wishlist_add', modelId, artistId, ...opts });
