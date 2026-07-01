// scripts/migrate-add-file-hash.ts
// Run with: npx ts-node scripts/migrate-add-file-hash.ts
import { db } from '../src/db'

async function migrate() {
  console.log('Running migration: add file_hash to models...')
  await db.query(`
    ALTER TABLE models
      ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64) UNIQUE;
    CREATE INDEX IF NOT EXISTS idx_models_file_hash ON models(file_hash);
  `)
  console.log('Migration complete.')
  process.exit(0)
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
