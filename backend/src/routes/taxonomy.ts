// backend/src/routes/taxonomy.ts
// Public read access to the faceted taxonomy (migration 011): the facet tree for
// the upload pickers + browse rail, and live per-term counts for the current
// filter context.

import { Router } from 'express';
import { db } from '../db';
import { asyncHandler } from '../middleware/error';
import { searchRateLimit } from '../middleware/security';
import { parseTermsParam, facetConditions, termSearchSql } from '../services/facetFilter';

const router = Router();

interface TermNode {
  id: string;
  slug: string;
  name: string;
  path: string;
  depth: number;
  synonyms: string[] | null;
  ratio: string | null;
  count?: number;
  children: TermNode[];
}

interface FacetNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  selectionUi: string;
  required: boolean;
  maxTerms: number | null;
  terms: TermNode[];
}

/** Load active facets + terms and assemble the per-facet trees. */
async function loadFacetTrees(): Promise<FacetNode[]> {
  const facetRes = await db.query(
    `SELECT id, slug, name, description, selection_ui, is_required, max_terms
       FROM facets WHERE is_active = true ORDER BY display_order, name`,
  );
  const termRes = await db.query(
    `SELECT id, facet_id, parent_id, slug, name, path, depth, synonyms, ratio
       FROM terms WHERE is_active = true ORDER BY facet_id, depth, display_order, name`,
  );

  const nodeById = new Map<string, TermNode>();
  const childrenByFacet = new Map<string, TermNode[]>();

  for (const row of termRes.rows) {
    nodeById.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.name,
      path: row.path,
      depth: row.depth,
      synonyms: row.synonyms ?? null,
      ratio: row.ratio ?? null,
      children: [],
    });
  }
  for (const row of termRes.rows) {
    const node = nodeById.get(row.id)!;
    if (row.parent_id && nodeById.has(row.parent_id)) {
      nodeById.get(row.parent_id)!.children.push(node);
    } else {
      const list = childrenByFacet.get(row.facet_id) ?? [];
      list.push(node);
      childrenByFacet.set(row.facet_id, list);
    }
  }

  return facetRes.rows.map((f: any) => ({
    id: f.id,
    slug: f.slug,
    name: f.name,
    description: f.description ?? null,
    selectionUi: f.selection_ui,
    required: f.is_required,
    maxTerms: f.max_terms ?? null,
    terms: childrenByFacet.get(f.id) ?? [],
  }));
}

// ============================================================================
// GET /  — the full facet tree (upload pickers + rail scaffold)
// ============================================================================
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const facets = await loadFacetTrees();
    res.json({ facets });
  }),
);

// ============================================================================
// GET /facets  — the facet tree WITH live per-term counts for a filter context.
// Query: terms, search, category, minPrice, maxPrice, hideZero.
// Counts are distinct-model, rolled up to ancestors, and exclude the term's own
// facet from the filter (so multi-select within a facet keeps siblings visible).
// ============================================================================
router.get(
  '/facets',
  searchRateLimit,
  asyncHandler(async (req, res) => {
    const { terms, search, category, minPrice, maxPrice, hideZero } = req.query;
    const groups = parseTermsParam(terms);
    const searchTrim =
      typeof search === 'string' && search.trim() ? search.trim() : null;

    // Fetch (facet, path, model_id) tuples under a filter. `exclude` drops one
    // facet's own selection; `onlyFacet` restricts to a single facet.
    async function fetchPairs(opts: { onlyFacet?: string; exclude?: string }) {
      const params: any[] = [];
      const push = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      const where = ["m.status = 'published'", "m.visibility = 'public'"];
      if (category) where.push(`m.category = ${push(category)}`);
      if (minPrice) where.push(`m.base_price >= ${push(Number(minPrice))}`);
      if (maxPrice) where.push(`m.base_price <= ${push(Number(maxPrice))}`);
      if (searchTrim) {
        const like = push(`%${searchTrim}%`);
        where.push(
          `(m.name ILIKE ${like} OR m.description ILIKE ${like} OR ` +
            `EXISTS (SELECT 1 FROM unnest(m.tags) tag WHERE tag ILIKE ${like}) OR ${termSearchSql(like)})`,
        );
      }
      for (const c of facetConditions(groups, push, { exclude: opts.exclude })) {
        where.push(c);
      }
      const onlyFacet = opts.onlyFacet ? ` AND ff.slug = ${push(opts.onlyFacet)}` : '';
      const sql = `SELECT ff.slug AS facet, tt.path AS path, m.id AS model_id
         FROM models m
         JOIN model_terms mt ON mt.model_id = m.id
         JOIN terms tt ON tt.id = mt.term_id
         JOIN facets ff ON ff.id = tt.facet_id
         WHERE ${where.join(' AND ')}${onlyFacet}`;
      const r = await db.query(sql, params);
      return r.rows as { facet: string; path: string; model_id: string }[];
    }

    // Base pass: all facets under the full filter (correct for unselected facets).
    // Then re-fetch each SELECTED facet with itself excluded (exclude-self).
    const pairs = await fetchPairs({});
    const bySelectedFacet = new Map<string, { facet: string; path: string; model_id: string }[]>();
    for (const facet of groups.keys()) {
      bySelectedFacet.set(facet, await fetchPairs({ onlyFacet: facet, exclude: facet }));
    }

    // Group model→paths per facet (selected facets use their exclude-self pairs).
    const modelsByFacet = new Map<string, Map<string, Set<string>>>(); // facet → model → paths
    const add = (facet: string, path: string, model: string) => {
      let mm = modelsByFacet.get(facet);
      if (!mm) modelsByFacet.set(facet, (mm = new Map()));
      let set = mm.get(model);
      if (!set) mm.set(model, (set = new Set()));
      set.add(path);
    };
    for (const row of pairs) {
      if (bySelectedFacet.has(row.facet)) continue; // replaced below
      add(row.facet, row.path, row.model_id);
    }
    for (const [facet, rows] of bySelectedFacet) {
      for (const row of rows) add(facet, row.path, row.model_id);
    }

    // Roll up to ancestors, distinct per model: count[facet][path] = # models whose
    // tag-closure (each tagged path + all its ancestors) includes that path.
    const counts = new Map<string, Map<string, number>>();
    const ancestors = (path: string): string[] => {
      const parts = path.split('/');
      const out: string[] = [];
      for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
      return out;
    };
    for (const [facet, mm] of modelsByFacet) {
      const c = new Map<string, number>();
      counts.set(facet, c);
      for (const paths of mm.values()) {
        const closure = new Set<string>();
        for (const p of paths) for (const a of ancestors(p)) closure.add(a);
        for (const node of closure) c.set(node, (c.get(node) ?? 0) + 1);
      }
    }

    // Attach counts to the tree; optionally prune zero-count terms.
    const prune = hideZero === '1' || hideZero === 'true';
    const facets = await loadFacetTrees();
    const attach = (facetSlug: string, nodes: TermNode[]): TermNode[] => {
      const c = counts.get(facetSlug);
      const out: TermNode[] = [];
      for (const node of nodes) {
        node.children = attach(facetSlug, node.children);
        node.count = c?.get(node.path) ?? 0;
        if (!prune || node.count > 0 || node.children.length > 0) out.push(node);
      }
      return out;
    };
    for (const facet of facets) facet.terms = attach(facet.slug, facet.terms);

    res.json({ facets });
  }),
);

export default router;
