#!/usr/bin/env node

/**
 * Migration Generator
 * Creates a new migration file with proper naming and template
 *
 * Usage:
 *   npm run migrate:create "add_user_preferences"
 *   npm run migrate:create "add_user_preferences" --template=table
 */

import fs from 'fs'
import path from 'path'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ============================================================================
// TEMPLATES
// ============================================================================

const TEMPLATES = {
  blank: (name: string) => `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Add your SQL here
`,

  table: (name: string) => `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

CREATE TABLE IF NOT EXISTS ${name} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes as needed
-- CREATE INDEX idx_${name}_created_at ON ${name}(created_at);
`,

  column: (name: string) => `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Add column to existing table
ALTER TABLE table_name
ADD COLUMN IF NOT EXISTS column_name data_type DEFAULT value;

-- Add index if needed
-- CREATE INDEX idx_table_column ON table_name(column_name);
`,

  index: (name: string) => `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_${name} ON table_name(column_name);
`,

  constraint: (name: string) => `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Add constraint
ALTER TABLE table_name
ADD CONSTRAINT constraint_name UNIQUE (column_name);

-- Or foreign key
-- ALTER TABLE table_name
-- ADD CONSTRAINT fk_table_column FOREIGN KEY (column_id) REFERENCES other_table(id);
`,

  data: (name: string) => `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Data migration
UPDATE table_name
SET column_name = new_value
WHERE condition;

-- Or insert data
-- INSERT INTO table_name (column1, column2) VALUES (value1, value2);
`,
}

// ============================================================================
// MAIN
// ============================================================================

async function createMigration() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error('❌ Error: Migration name is required')
    console.error('\nUsage:')
    console.error('  npx ts-node scripts/create-migration.ts "migration_name"')
    console.error('  npx ts-node scripts/create-migration.ts "migration_name" --template table')
    console.error('\nAvailable templates:')
    Object.keys(TEMPLATES).forEach((t) => console.error(`  - ${t}`))
    process.exit(1)
  }

  const migrationName = args[0]
  const templateArg = args.find((arg) => arg.startsWith('--template='))
  const templateName = templateArg ? templateArg.split('=')[1] : 'blank'

  // Validate template
  if (!TEMPLATES[templateName as keyof typeof TEMPLATES]) {
    console.error(`❌ Error: Unknown template "${templateName}"`)
    console.error('Available templates:', Object.keys(TEMPLATES).join(', '))
    process.exit(1)
  }

  // Validate migration name
  if (!/^[a-z0-9_]+$/.test(migrationName)) {
    console.error('❌ Error: Migration name must contain only lowercase letters, numbers, and underscores')
    process.exit(1)
  }

  // Get next version number
  const migrationsDir = path.join(__dirname, '../db/migrations')

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true })
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  let nextVersion = 1
  if (files.length > 0) {
    const lastFile = files[files.length - 1]
    const match = lastFile.match(/^(\d+)_/)
    if (match) {
      nextVersion = parseInt(match[1], 10) + 1
    }
  }

  // Create filename
  const versionStr = String(nextVersion).padStart(3, '0')
  const filename = `${versionStr}_${migrationName}.sql`
  const filepath = path.join(migrationsDir, filename)

  // Check if file already exists
  if (fs.existsSync(filepath)) {
    console.error(`❌ Error: Migration file already exists: ${filename}`)
    process.exit(1)
  }

  // Get template
  const template = TEMPLATES[templateName as keyof typeof TEMPLATES]
  const content = template(migrationName)

  // Write file
  try {
    fs.writeFileSync(filepath, content, 'utf8')
    console.log(`✅ Migration created: ${filename}`)
    console.log(`📁 Location: ${filepath}`)
    console.log(`📝 Template: ${templateName}`)
    console.log(`\n📋 Next steps:`)
    console.log(`  1. Edit the migration file`)
    console.log(`  2. Run: npm run migrate`)
    console.log(`  3. Test your changes`)
  } catch (error) {
    console.error('❌ Error creating migration file:', error)
    process.exit(1)
  }
}

createMigration().catch((error) => {
  console.error('❌ Unhandled error:', error)
  process.exit(1)
})

