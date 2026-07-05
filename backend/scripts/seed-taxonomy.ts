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

async function main() {
  const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL
  if (!connectionString) {
    console.error('No DATABASE_PUBLIC_URL / DATABASE_URL in env.')
    console.error('Run via `railway run` linked to the Postgres service, or set DATABASE_PUBLIC_URL.')
    process.exit(1)
  }
  if (/\.railway\.internal/.test(connectionString) && !process.env.DATABASE_PUBLIC_URL) {
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
        `INSERT INTO facets (slug, name, description, selection_ui, is_required, max_terms, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           selection_ui = EXCLUDED.selection_ui,
           is_required = EXCLUDED.is_required,
           max_terms = EXCLUDED.max_terms,
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
