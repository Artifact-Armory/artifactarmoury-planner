import { Pool } from 'pg'
import dotenv from 'dotenv'
import { pathToFileURL } from 'url'

dotenv.config()

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not defined. Please set it in your environment or .env file.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: DATABASE_URL,
})

export async function rollback(steps = 1): Promise<void> {
  console.log(`🔄 Rolling back ${steps} migration(s)...\n`)

  try {
    const result = await pool.query(
      `
      SELECT version, name
      FROM schema_migrations
      ORDER BY version DESC
      LIMIT $1
    `,
      [steps]
    )

    if (result.rowCount === 0) {
      console.log('ℹ️  No migrations to rollback.\n')
      return
    }

    for (const row of result.rows) {
      console.log(`⏳ Rolling back: ${row.version} - ${row.name}`)
      await pool.query('DELETE FROM schema_migrations WHERE version = $1', [row.version])
      console.log(`✅ Rolled back version ${row.version}\n`)
    }

    console.log('⚠️  Note: Rollback only removes migration records.')
    console.log('   You must manually undo schema changes if needed.\n')
  } catch (error) {
    console.error('❌ Rollback failed:', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

const stepsArg = process.argv[2] ? Number.parseInt(process.argv[2], 10) : 1
const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedAsScript) {
  rollback(Number.isNaN(stepsArg) ? 1 : stepsArg).catch((error) => {
    console.error('❌ Unhandled rollback error:', error)
    process.exit(1)
  })
}
