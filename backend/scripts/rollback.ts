import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

if (process.env.DB_MOCK === 'true') {
  console.log('DB_MOCK enabled; nothing to rollback')
  process.exit(0)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required to rollback migrations.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
})

async function rollback(steps = 1) {
  console.log(`🔄 Rolling back ${steps} migration(s)...\n`)

  try {
    const existing = await pool.query(
      `SELECT version, name 
       FROM schema_migrations 
       ORDER BY version DESC 
       LIMIT $1`,
      [steps]
    )

    if (existing.rows.length === 0) {
      console.log('ℹ️  No migrations to rollback.\n')
      return
    }

    for (const row of existing.rows) {
      console.log(`⏳ Rolling back ${row.version} - ${row.name}`)
      await pool.query('DELETE FROM schema_migrations WHERE version = $1', [row.version])
      console.log(`✅ Removed migration record for version ${row.version}\n`)
    }

    console.log('⚠️  Note: This only removes migration records.')
    console.log('   Apply manual SQL to revert schema/data if required.\n')
  } catch (error) {
    console.error('❌ Rollback failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

const steps = Number.isNaN(parseInt(process.argv[2], 10))
  ? 1
  : parseInt(process.argv[2], 10)

rollback(steps)
