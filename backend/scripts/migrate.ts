import { Pool } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'

dotenv.config()

if (process.env.DB_MOCK === 'true') {
  console.log('DB_MOCK enabled; skipping migrations')
  process.exit(0)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required to run migrations.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
})

// __dirname is already provided by CommonJS (module: "commonjs"); the ESM
// import.meta.url form was invalid here and broke `npm run migrate`.

interface MigrationFile {
  version: number
  name: string
  sql: string
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function currentVersion(): Promise<number> {
  const result = await pool.query(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
  )
  return result.rows[0]?.version ?? 0
}

function loadMigrationFiles(): MigrationFile[] {
  const migrationsDir = path.join(__dirname, '../db/migrations')
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true })
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

      const [, versionStr, name] = match
      const version = parseInt(versionStr, 10)
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      return { version, name, sql }
    })
}

async function runMigrations() {
  console.log('🚀 Starting database migrations...\n')

  await ensureMigrationsTable()
  const current = await currentVersion()
  console.log(`📊 Current schema version: ${current}`)

  const migrations = loadMigrationFiles()
  const pending = migrations.filter((migration) => migration.version > current)

  if (pending.length === 0) {
    console.log('✅ Database is up to date.\n')
    return
  }

  console.log(`📦 Found ${pending.length} pending migration(s)\n`)

  for (const migration of pending) {
    console.log(`⏳ Running migration ${migration.version}: ${migration.name}`)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(migration.sql)
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name]
      )
      await client.query('COMMIT')
      console.log(`✅ Migration ${migration.version} completed\n`)
    } catch (error) {
      await client.query('ROLLBACK')
      console.error(`❌ Migration ${migration.version} failed`, error)
      throw error
    } finally {
      client.release()
    }
  }
}

runMigrations()
  .catch((err) => {
    console.error('Migration process failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await pool.end()
  })
