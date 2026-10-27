// backend/src/services/artistSlug.ts
// Artist pages are linked as /artists/<slug> (migration 086), but old links use
// the user id and renamed artists keep their old slug as an alias. This turns
// any of those into the artist's user id.
import { Request, Response, NextFunction } from 'express';
import { db } from '../db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Never matches a row, so an unknown slug gives the normal "not found" result
// instead of a uuid cast error.
const NO_ARTIST = '00000000-0000-0000-0000-000000000000';

export async function resolveArtistId(idOrSlug: string): Promise<string | null> {
  if (UUID_RE.test(idOrSlug)) return idOrSlug;
  const slug = idOrSlug.toLowerCase();
  const result = await db.query(
    `SELECT id FROM users WHERE artist_slug = $1
     UNION ALL
     SELECT user_id AS id FROM artist_slug_aliases WHERE slug = $1
     LIMIT 1`,
    [slug]
  );
  return result.rows[0]?.id ?? null;
}

// router.param handler: swaps a slug in req.params[name] for the artist's id.
export function artistIdParam(name: string) {
  return async (req: Request, _res: Response, next: NextFunction, value: string) => {
    try {
      req.params[name] = (await resolveArtistId(String(value))) ?? NO_ARTIST;
      next();
    } catch (err) {
      next(err);
    }
  };
}
