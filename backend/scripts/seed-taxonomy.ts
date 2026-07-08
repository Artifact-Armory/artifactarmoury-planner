// backend/scripts/seed-taxonomy.ts
//
// Seed / sync the faceted taxonomy (facets + terms) from src/data/taxonomy.ts
// into the DB created by migration 011. Idempotent: upserts by slug/path, so it's
// safe to re-run after adding terms to the source file — new terms are inserted,
// existing ones have their display name/synonyms/order refreshed, and nothing is
// deleted (retiring a term is a deliberate is_active=false, not a source removal).
//
// Slugs/paths are IMMUTABLE identifiers — renaming a term's `name` in the source
// is fine; moving it in the tree (which changes its path) mints a new term.
//
// Run against production (linked to the Postgres service so DATABASE_PUBLIC_URL
// is injected):
//   railway run npm run seed:taxonomy
// Or explicitly:
//   DATABASE_PUBLIC_URL="postgresql://…" npm run seed:taxonomy

import 'dotenv/config'
import pg from 'pg'
import { TAXONOMY, slugify, type TermSeed } from '../src/data/taxonomy'

interface FlatTerm {
  facetSlug: string
  slug: string
  name: string
  path: string
  parentPath: string | null
  depth: number
  order: number
  synonyms: string[] | null
  ratio: string | null
}

function flattenTerms(facetSlug: string, nodes: TermSeed[], parentPath: string | null, depth: number): FlatTerm[] {
  const out: FlatTerm[] = []
  nodes.forEach((node, i) => {
    const slug = node.slug ?? slugify(node.name)
    const path = parentPath ? `${parentPath}/${slug}` : slug
    out.push({
      facetSlug,
      slug,
      name: node.name,
      path,
      parentPath,
      depth,
      order: i,
      synonyms: node.synonyms && node.synonyms.length ? node.synonyms : null,
      ratio: node.ratio ?? null,
    })
    if (node.children && node.children.length) {
      out.push(...flattenTerms(facetSlug, node.children, path, depth + 1))
    }
  })
  return out
}

// Detect a Railway deploy so the seed can safely use the private internal
// DATABASE_URL there (it IS reachable inside Railway's network, e.g. during the
// Pre-Deploy / postmigrate hook), while still refusing that unreachable URL from
// a laptop.
const IN_RAILWAY = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID,
)

async function main() {
  // Local mock mode has no real DB to seed — no-op so `npm run migrate` (which
  // triggers this via the postmigrate hook) stays green.
  if (process.env.DB_MOCK === 'true') {
    console.log('DB_MOCK is set — skipping taxonomy seed.')
    return
  }
  const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL
  if (!connectionString) {
    console.error('No DATABASE_PUBLIC_URL / DATABASE_URL in env.')
    console.error('Run via `railway run` linked to the Postgres service, or set DATABASE_PUBLIC_URL.')
    process.exit(1)
  }
  if (/\.railway\.internal/.test(connectionString) && !process.env.DATABASE_PUBLIC_URL && !IN_RAILWAY) {
    console.error('Only the private internal DATABASE_URL is set — not reachable from a laptop.')
    process.exit(1)
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    statement_timeout: 60000,
  })

  const client = await pool.connect()
  let facetCount = 0
  let termCount = 0
  try {
    await client.query('BEGIN')

    for (let f = 0; f < TAXONOMY.length; f++) {
      const facet = TAXONOMY[f]
      const facetRow = await client.query(
        `INSERT INTO facets (slug, name, description, selection_ui, is_required, max_terms, applies_to, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           selection_ui = EXCLUDED.selection_ui,
           is_required = EXCLUDED.is_required,
           max_terms = EXCLUDED.max_terms,
           applies_to = EXCLUDED.applies_to,
           display_order = EXCLUDED.display_order,
           is_active = true,
           updated_at = NOW()
         RETURNING id`,
        [
          facet.slug,
          facet.name,
          facet.description ?? null,
          facet.selectionUi,
          facet.required ?? false,
          facet.maxTerms ?? null,
          facet.appliesTo && facet.appliesTo.length ? facet.appliesTo : null,
          f,
        ],
      )
      const facetId: string = facetRow.rows[0].id
      facetCount++

      // Upsert terms parent-first (flatten yields parents before children), keeping
      // a path→id map so each child can resolve its parent_id.
      const flat = flattenTerms(facet.slug, facet.terms, null, 0)
      const idByPath = new Map<string, string>()

      for (const term of flat) {
        const parentId = term.parentPath ? idByPath.get(term.parentPath) ?? null : null
        const termRow = await client.query(
          `INSERT INTO terms
             (facet_id, parent_id, slug, name, path, depth, synonyms, ratio, display_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (facet_id, path) DO UPDATE SET
             parent_id = EXCLUDED.parent_id,
             slug = EXCLUDED.slug,
             name = EXCLUDED.name,
             depth = EXCLUDED.depth,
             synonyms = EXCLUDED.synonyms,
             ratio = EXCLUDED.ratio,
             display_order = EXCLUDED.display_order,
             is_active = true,
             updated_at = NOW()
           RETURNING id`,
          [
            facetId,
            parentId,
            term.slug,
            term.name,
            term.path,
            term.depth,
            term.synonyms,
            term.ratio,
            term.order,
          ],
        )
        idByPath.set(term.path, termRow.rows[0].id)
        termCount++
      }

      console.log(`  ✓ ${facet.name.padEnd(26)} ${flat.length} terms`)
    }

    // Backfill: the marketplace sold terrain only before model classes existed, so
    // every model predating this seed is Terrain. Tag any model that has no
    // model-class term with `model-class:terrain`. Idempotent (guarded by NOT EXISTS
    // + ON CONFLICT) and a no-op on a fresh DB with no models.
    const backfill = await client.query(
      `INSERT INTO model_terms (model_id, term_id)
       SELECT m.id, t.id
         FROM models m
         CROSS JOIN terms t
         JOIN facets f ON f.id = t.facet_id
        WHERE f.slug = 'model-class' AND t.path = 'terrain'
          AND NOT EXISTS (
            SELECT 1 FROM model_terms mt
            JOIN terms t2 ON t2.id = mt.term_id
            JOIN facets f2 ON f2.id = t2.facet_id
            WHERE mt.model_id = m.id AND f2.slug = 'model-class'
          )
       ON CONFLICT DO NOTHING`,
    )
    if (backfill.rowCount) {
      console.log(`  ✓ Backfilled ${backfill.rowCount} model(s) → model-class:terrain`)
    }

    await client.query('COMMIT')
    console.log(`\n✅ Seeded ${facetCount} facets, ${termCount} terms.`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('❌ Taxonomy seed failed:', err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
