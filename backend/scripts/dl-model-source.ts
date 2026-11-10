// backend/scripts/dl-model-source.ts
//
// Download a model's main print file (the one the preview bake uses) by model
// id, for debugging a failed bake. Works even when the model is 'failed', which
// blocks the normal download button. Connects with pg directly and retries,
// because Railway's public database proxy drops the odd connection.
//
//   railway run node -r ts-node/register/transpile-only scripts/dl-model-source.ts <model-id> <out.stl>

import './script-env'
import { promises as fs } from 'fs'
import pg from 'pg'
import { downloadObject } from '../src/services/r2'

async function queryWithRetry(sql: string, params: any[]) {
  let last: any
  for (let attempt = 1; attempt <= 5; attempt++) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 30000,
      max: 1,
    })
    try {
      return await pool.query(sql, params)
    } catch (e: any) {
      last = e
      console.warn(`Attempt ${attempt} failed: ${e.code || e.message}`)
      await new Promise((r) => setTimeout(r, 2000))
    } finally {
      await pool.end().catch(() => {})
    }
  }
  throw last
}

async function main() {
  const [id, out] = process.argv.slice(2)
  if (!id || !out) {
    console.error('Usage: dl-model-source.ts <model-id> <out.stl>')
    process.exit(1)
  }
  const { rows } = await queryWithRetry(
    `SELECT source_key, error, created_at
       FROM proxy_bake_jobs
      WHERE model_id = $1 AND part_id IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [id],
  )
  const key = rows[0]?.source_key
  if (!key) throw new Error('No bake job found for that model')
  console.log('Last bake error:', rows[0].error)
  console.log('Source key:', key)
  const buf = await downloadObject(key)
  await fs.writeFile(out, buf)
  console.log(`Wrote ${buf.length} bytes to ${out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
