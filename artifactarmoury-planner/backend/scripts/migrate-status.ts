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

interface DiskMigration {
  version: number
  name: string
}

async function getAppliedMigrations(): Promise<
  Array<{ version: number; name: string; applied_at: Date | null }>
> {
  try {
    const result = await pool.query(
      `
      SELECT version, name, applied_at
      FROM schema_migrations
      ORDER BY version ASC
    `
    )
    return result.rows.map((row) => ({
      version: row.version,
      name: row.name,
      applied_at: row.applied_at ?? null,
    }))
  } catch (error) {
    // schema_migrations table may not exist yet
    return []
  }
}

function loadDiskMigrations(): DiskMigration[] {
  const migrationsDir = path.join(__dirname, '../db/migrations')

  if (!fs.existsSync(migrationsDir)) {
    return []
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const match = file.match(/^(\d+)_([a-zA-Z0-9_-]+)\.sql$/)
      if (!match) {
        throw new Error(`Invalid migration filename: ${file}`)
      }
      return {
        version: Number.parseInt(match[1], 10),
        name: match[2],
      }
    })
}

export async function showMigrationStatus(): Promise<void> {
  try {
    const diskMigrations = loadDiskMigrations()
    const appliedMigrations = await getAppliedMigrations()
    const appliedVersions = new Map(appliedMigrations.map((m) => [m.version, m]))

    if (diskMigrations.length === 0) {
      console.log('ℹ️  No migration files found in backend/db/migrations')
      return
    }

    console.log('📋 Migration Status\n')

    diskMigrations.forEach((migration) => {
      const applied = appliedVersions.get(migration.version)
      if (applied) {
        const appliedAt = applied.applied_at ? applied.applied_at.toISOString() : 'unknown'
        console.log(
          `✅ ${migration.version.toString().padStart(3, '0')} - ${migration.name} (applied ${appliedAt})`
        )
      } else {
        console.log(`⬜ ${migration.version.toString().padStart(3, '0')} - ${migration.name} (pending)`)
      }
    })

    const unknownApplied = appliedMigrations.filter(
      (applied) => !diskMigrations.some((disk) => disk.version === applied.version)
    )

    if (unknownApplied.length > 0) {
      console.log('\n⚠️  Applied migrations missing on disk:')
      unknownApplied.forEach((migration) => {
        const appliedAt = migration.applied_at ? migration.applied_at.toISOString() : 'unknown'
        console.log(
          `   • ${migration.version.toString().padStart(3, '0')} - ${migration.name} (applied ${appliedAt})`
        )
      })
    }
  } catch (error) {
    console.error('❌ Failed to determine migration status:', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedAsScript) {
  showMigrationStatus().catch((error) => {
    console.error('❌ Unhandled migration status error:', error)
    process.exit(1)
  })
}
