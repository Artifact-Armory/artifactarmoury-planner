// backend/src/middleware/session.ts
// Session management for anonymous builders and asset library usage

import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { AuthRequest } from './auth';

export const SESSION_HEADER = 'x-session-id';
const DEFAULT_TABLE_LIMIT = 3;

export interface SessionInfo {
  id: string;
  isAnonymous: boolean;
  tableLimit: number;
}

function isUuid(value?: string | null): value is string {
  if (!value) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function upsertAnonymousSession(token: string): Promise<number> {
  const result = await db.query(
    `
      INSERT INTO anonymous_sessions (session_token)
      VALUES ($1)
      ON CONFLICT (session_token)
      DO UPDATE SET last_seen = CURRENT_TIMESTAMP
      RETURNING table_limit
    `,
    [token],
  );

  const limit = result.rows[0]?.table_limit;
  return typeof limit === 'number' && Number.isFinite(limit) ? limit : DEFAULT_TABLE_LIMIT;
}

const sessionRouter = Router();

sessionRouter.use(async (req: AuthRequest, res, next) => {
  try {
    if (req.userId) {
      req.session = {
        id: req.userId,
        isAnonymous: false,
        tableLimit: Number.POSITIVE_INFINITY,
      };
      return next();
    }

    let sessionId: string | undefined;
    const headerId = req.headers[SESSION_HEADER] as string | undefined;
    if (isUuid(headerId)) {
      sessionId = headerId;
    }

    if (!sessionId && typeof req.query.session === 'string' && isUuid(req.query.session)) {
      sessionId = req.query.session;
    }

    if (!sessionId) {
      sessionId = crypto.randomUUID();
    }

    const tableLimit = await upsertAnonymousSession(sessionId);
    res.setHeader(SESSION_HEADER, sessionId);

    req.session = {
      id: sessionId,
      isAnonymous: true,
      tableLimit,
    };

    next();
  } catch (error) {
    next(error);
  }
});

export default sessionRouter;
