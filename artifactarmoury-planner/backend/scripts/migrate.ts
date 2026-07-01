import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not defined. Please set it in your environment or .env file.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: DATABASE_URL,
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface Migration {
  version: number
  name: string
  sql: string
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function getCurrentVersion(): Promise<number> {
  try {
    const result = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
    )
    return result.rows[0]?.version ?? 0
  } catch (error) {
    // Table may not exist yet
    return 0
  }
}

function loadMigrations(): Migration[] {
  const migrationsDir = path.join(__dirname, '../db/migrations')

  if (!fs.existsSync(migrationsDir)) {
    console.log('📁 Creating migrations directory at', migrationsDir)
    fs.mkdirSync(migrationsDir, { recursive: true })
    return []
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  return files.map((file) => {
    const match = file.match(/^(\d+)_([a-zA-Z0-9_-]+)\.sql$/)
    if (!match) {
      throw new Error(`Invalid migration filename: ${file}`)
    }

    const [, versionStr, name] = match
    const version = parseInt(versionStr, 10)
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')

    return { version, name, sql }
  })
}

export async function runMigrations(): Promise<void> {
  console.log('🚀 Starting database migrations...\n')

  try {
    await ensureMigrationsTable()
    const currentVersion = await getCurrentVersion()
    console.log(`📊 Current schema version: ${currentVersion}`)

    const migrations = loadMigrations()
    const pending = migrations.filter((migration) => migration.version > currentVersion)

    if (pending.length === 0) {
      console.log('✅ Database is already up to date!\n')
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

    console.log('🎉 All migrations completed successfully!\n')
  } catch (error) {
    console.error('❌ Migration process failed:', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedAsScript) {
  runMigrations().catch((error) => {
    console.error('❌ Unhandled migration error:', error)
    process.exit(1)
  })
}
