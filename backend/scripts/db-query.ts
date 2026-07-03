// backend/scripts/db-query.ts
//
// Run a one-off read query against the production DB from your laptop WITHOUT a
// local psql client. Uses the Node `pg` driver the backend already bundles.
//
// The private DATABASE_URL (an internal *.railway.internal host) is unreachable
// from a laptop, so this prefers DATABASE_PUBLIC_URL. Run it linked to the
// **Postgres** service so that variable is injected:
//
//   railway link                     # pick the project, then the Postgres service
//   railway run npm run db:query -- "SELECT email, role FROM users WHERE id = '…'"
//
// Or pass a connection string explicitly (bypasses Railway entirely):
//   DATABASE_PUBLIC_URL="postgresql://…" npm run db:query -- "SELECT …"

import 'dotenv/config'
import pg from 'pg'

async function main() {
  const sql = process.argv[2]
  if (!sql) {
    console.error('Usage: npm run db:query -- "<SQL>"')
    process.exit(1)
  }

  const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL
  if (!connectionString) {
    console.error('No DATABASE_PUBLIC_URL / DATABASE_URL in env.')
    console.error('Run via `railway run` linked to the Postgres service, or set DATABASE_PUBLIC_URL.')
    process.exit(1)
  }
  if (/\.railway\.internal/.test(connectionString) && !process.env.DATABASE_PUBLIC_URL) {
    console.error('Only the private internal DATABASE_URL is set — it is NOT reachable from a laptop.')
    console.error('Link the Postgres service (which also exposes DATABASE_PUBLIC_URL) and retry.')
    process.exit(1)
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  })

  try {
    const res = await pool.query(sql)
    console.table(res.rows)
    console.log(`(${res.rowCount} row${res.rowCount === 1 ? '' : 's'})`)
  } finally {
    await pool.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
