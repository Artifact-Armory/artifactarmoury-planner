import { Pool } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

if (process.env.DB_MOCK === 'true') {
  console.log('DB_MOCK enabled; no migrations to report')
  process.exit(0)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface MigrationFile {
  version: number
  name: string
}

function loadMigrationFiles(): MigrationFile[] {
  const migrationsDir = path.join(__dirname, '../db/migrations')
  if (!fs.existsSync(migrationsDir)) {
    return []
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const match = file.match(/^(\d+)_(.+)\.sql$/)
      if (!match) {
        throw new Error(`Invalid migration filename: ${file}`)
      }
      return { version: parseInt(match[1], 10), name: match[2] }
    })
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function showStatus() {
  await ensureTable()

  const files = loadMigrationFiles()
  const appliedResult = await pool.query(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC'
  )

  console.log('📋 Migration Status\n')

  if (!files.length) {
    console.log('No migration files found in backend/db/migrations.\n')
    return
  }

  const appliedVersions = new Set(appliedResult.rows.map((row) => Number(row.version)))

  console.log('Version | Status    | Name')
  console.log('--------|-----------|--------------------------------')
  for (const file of files) {
    const status = appliedVersions.has(file.version) ? '✅ applied ' : '⬜ pending'
    console.log(
      `${file.version.toString().padEnd(7)}| ${status.padEnd(9)}| ${file.name}`
    )
  }

  console.log('\nApplied migrations in database:')
  if (appliedResult.rows.length === 0) {
    console.log('  (none)\n')
  } else {
    appliedResult.rows.forEach((row) => {
      console.log(`  - ${row.version} ${row.name} @ ${row.applied_at}`)
    })
    console.log()
  }

  const latest = files[files.length - 1]
  const currentVersion = appliedResult.rows.length
    ? appliedResult.rows[appliedResult.rows.length - 1].version
    : 0

  console.log(`Current version: ${currentVersion}`)
  console.log(`Latest available version: ${latest.version}\n`)
}

showStatus()
  .catch((error) => {
    console.error('Failed to read migration status:', error)
    process.exit(1)
  })
  .finally(async () => {
    await pool.end()
  })
