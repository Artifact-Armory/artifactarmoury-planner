// backend/src/services/modelTerms.ts
//
// Write + read the taxonomy tags on a model (model_terms, migration 011).
// Enforces the tagging guardrails from the taxonomy spec: per-facet caps
// (facets.max_terms) on write, and required-facet presence at publish time.
//
// Wire format for a selection is an array of "facetSlug:termPath" tokens — the
// same tokens the browse filter uses — e.g. "terrain-type:buildings/residential".

import { db } from '../db';
import { ValidationError } from '../middleware/error';

export interface ResolvedTerm {
  id: string;
  facetSlug: string;
  facetName: string;
  path: string;
  name: string;
}

interface ParsedToken {
  facet: string;
  path: string;
}

function parseTokens(tokens: unknown): ParsedToken[] {
  if (!Array.isArray(tokens)) return [];
  const out: ParsedToken[] = [];
  for (const raw of tokens) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const facet = trimmed.slice(0, idx).trim();
    const path = trimmed.slice(idx + 1).trim().replace(/^\/+|\/+$/g, '');
    if (facet && path) out.push({ facet, path });
  }
  // de-dupe
  const seen = new Set<string>();
  return out.filter((tk) => {
    const key = `${tk.facet}:${tk.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Resolve "facetSlug:path" tokens to term rows and validate them:
 *  - every token must resolve to an active term (else 400 with the offenders)
 *  - each facet's selection must be within facets.max_terms
 * Read-only — call before creating/persisting so a bad payload never half-writes.
 */
export async function validateAndResolveTerms(tokens: unknown): Promise<ResolvedTerm[]> {
  const parsed = parseTokens(tokens);
  if (parsed.length === 0) return [];

  const slugs = parsed.map((p) => p.facet);
  const paths = parsed.map((p) => p.path);

  const result = await db.query(
    `SELECT t.id, f.slug AS facet_slug, f.name AS facet_name, t.path, t.name,
            f.max_terms
       FROM unnest($1::text[], $2::text[]) AS u(slug, path)
       JOIN facets f ON f.slug = u.slug AND f.is_active = true
       JOIN terms t ON t.facet_id = f.id AND t.path = u.path AND t.is_active = true`,
    [slugs, paths],
  );

  const resolved: ResolvedTerm[] = result.rows.map((r: any) => ({
    id: r.id,
    facetSlug: r.facet_slug,
    facetName: r.facet_name,
    path: r.path,
    name: r.name,
  }));

  // Detect tokens that didn't resolve (unknown facet/path).
  if (resolved.length !== parsed.length) {
    const found = new Set(resolved.map((r) => `${r.facetSlug}:${r.path}`));
    const missing = parsed.filter((p) => !found.has(`${p.facet}:${p.path}`));
    throw new ValidationError(
      `Unknown taxonomy term(s): ${missing.map((m) => `${m.facet}:${m.path}`).join(', ')}`,
    );
  }

  // Per-facet cap.
  const byFacet = new Map<string, { count: number; max: number | null; name: string }>();
  for (const row of result.rows) {
    const cur = byFacet.get(row.facet_slug) ?? { count: 0, max: row.max_terms ?? null, name: row.facet_name };
    cur.count += 1;
    byFacet.set(row.facet_slug, cur);
  }
  for (const [, info] of byFacet) {
    if (info.max != null && info.count > info.max) {
      throw new ValidationError(`Too many ${info.name} tags — choose at most ${info.max}.`);
    }
  }

  return resolved;
}

/** Replace a model's taxonomy tags with the given resolved terms. */
export async function writeModelTerms(modelId: string, resolved: ResolvedTerm[]): Promise<void> {
  await db.query('DELETE FROM model_terms WHERE model_id = $1', [modelId]);
  if (resolved.length === 0) return;
  const values = resolved.map((_, i) => `($1, $${i + 2})`).join(', ');
  await db.query(
    `INSERT INTO model_terms (model_id, term_id) VALUES ${values} ON CONFLICT DO NOTHING`,
    [modelId, ...resolved.map((r) => r.id)],
  );
}

/** Validate + replace a model's tags in one call (used by PATCH). */
export async function setModelTerms(modelId: string, tokens: unknown): Promise<ResolvedTerm[]> {
  const resolved = await validateAndResolveTerms(tokens);
  await writeModelTerms(modelId, resolved);
  return resolved;
}

/** Throw if any required facet has no tag on this model (publish guardrail). */
export async function assertRequiredTermsPresent(modelId: string): Promise<void> {
  const result = await db.query(
    `SELECT f.name
       FROM facets f
      WHERE f.is_active = true AND f.is_required = true
        AND NOT EXISTS (
          SELECT 1 FROM model_terms mt
          JOIN terms t ON t.id = mt.term_id
          WHERE mt.model_id = $1 AND t.facet_id = f.id
        )
      ORDER BY f.display_order`,
    [modelId],
  );
  if (result.rows.length > 0) {
    throw new ValidationError(
      `Add at least one tag for: ${result.rows.map((r: any) => r.name).join(', ')}.`,
    );
  }
}

/** The model's tags, grouped-friendly (ordered by facet then term). */
export async function getModelTerms(modelId: string): Promise<
  Array<{ facetSlug: string; facetName: string; termId: string; path: string; name: string }>
> {
  const result = await db.query(
    `SELECT f.slug AS facet_slug, f.name AS facet_name, t.id AS term_id, t.path, t.name
       FROM model_terms mt
       JOIN terms t ON t.id = mt.term_id
       JOIN facets f ON f.id = t.facet_id
      WHERE mt.model_id = $1 AND t.is_active = true
      ORDER BY f.display_order, t.depth, t.display_order, t.name`,
    [modelId],
  );
  return result.rows.map((r: any) => ({
    facetSlug: r.facet_slug,
    facetName: r.facet_name,
    termId: r.term_id,
    path: r.path,
    name: r.name,
  }));
}
