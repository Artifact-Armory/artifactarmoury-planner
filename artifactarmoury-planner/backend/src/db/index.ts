// backend/src/db/index.ts
import pg from 'pg'

const { Pool } = pg

// Allow mock DB for development without a live Postgres
const DB_MOCK = process.env.DB_MOCK === 'true'

// Environment validation
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && !DB_MOCK) {
  throw new Error('DATABASE_URL environment variable is required')
}

// Parse connection string to check configuration
const connectionConfig = {
  connectionString: DATABASE_URL,
  // SSL configuration for production (Railway, Heroku, etc.)
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : undefined,
  // Connection pool settings
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Timeout if connection takes longer than 5 seconds
  // Statement timeout (prevent runaway queries)
  statement_timeout: 30000, // 30 second timeout for queries
  // Query timeout
  query_timeout: 30000,
}

// Create connection pool (or mock implementation)
export const db: any = DB_MOCK
  ? {
      async query(_text?: string, _params?: any[]) {
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }
      },
      async connect() {
        return {
          async query(_t?: string, _p?: any[]) {
            return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }
          },
          release() {}
        }
      },
      on() {},
      end() {},
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
    }
  : new Pool(connectionConfig)

// Connection error handling
db.on('error', (err) => {
  console.error('Unexpected database error:', err)
  // Don't exit process - let connection pool handle reconnection
})

// Connection established
db.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    console.log('✓ Database connection established')
  }
})

// Backward-compat helper for code expecting db.getClient()
;(db as any).getClient = async () => await db.connect()

// Test database connection
export async function testConnection(): Promise<boolean> {
  if (process.env.DB_MOCK === 'true') {
    console.log('�o" DB_MOCK enabled; skipping connection test')
    return true
  }
  try {
    const result = await db.query('SELECT NOW() as now, version() as version')
    console.log('✓ Database connection successful')
    console.log(`  Time: ${result.rows[0].now}`)
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`  Version: ${result.rows[0].version.split(',')[0]}`)
    }
    
    return true
  } catch (error) {
    console.error('✗ Database connection failed:', error)
    return false
  }
}

// Initialize database (run migrations)
export async function initializeDatabase(): Promise<void> {
  if (process.env.DB_MOCK === 'true') {
    console.log('DB_MOCK enabled; skipping initializeDatabase')
    return
  }
  const client = await db.connect()
  
  try {
    console.log('Running database initialization...')
    
    // Read schema file
    const fs = await import('fs/promises')
    const path = await import('path')
    
    // Use process.cwd() instead of import.meta.url
    const schemaPath = path.join(process.cwd(), 'src/db/schema.sql')
    
    const schema = await fs.readFile(schemaPath, 'utf-8')
    
    // Execute schema
    await client.query(schema)
    
    console.log('✓ Database schema initialized')
    
    // Create default admin if ADMIN_EMAIL is set
    const adminEmail = process.env.ADMIN_EMAIL
    if (adminEmail) {
      const bcrypt = await import('bcrypt')
      const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123'
      const passwordHash = await bcrypt.hash(adminPassword, 12)
      
      await client.query(`
        INSERT INTO artists (email, password_hash, name, role, status, commission_rate)
        VALUES ($1, $2, 'Admin', 'admin', 'active', 1.00)
        ON CONFLICT (email) DO NOTHING
      `, [adminEmail, passwordHash])
      
      console.log('✓ Admin user created/verified')
    }
    
  } catch (error) {
    console.error('Database initialization error:', error)
    throw error
  } finally {
    client.release()
  }
}

// Helper function to run migrations
export async function runMigrations(): Promise<void> {
  if (process.env.DB_MOCK === 'true') {
    console.log('DB_MOCK enabled; skipping migrations')
    return
  }
  const client = await db.connect()
  
  try {
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `)
    
    // Get list of executed migrations
    const executedResult = await client.query(
      'SELECT name FROM migrations ORDER BY id'
    )
    const executedMigrations = new Set(executedResult.rows.map(r => r.name))
    
    // Read migrations directory
    const fs = await import('fs/promises')
    const path = await import('path')
    
    // Use process.cwd() instead of import.meta.url
    const migrationsDir = path.join(process.cwd(), 'src/db/migrations')
    
    // Check if migrations directory exists
    try {
      await fs.access(migrationsDir)
    } catch {
      console.log('No migrations directory found, skipping migrations')
      return
    }
    
    // Get all migration files
    const files = await fs.readdir(migrationsDir)
    const migrationFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort()
    
    // Execute pending migrations
    for (const file of migrationFiles) {
      if (executedMigrations.has(file)) {
        continue
      }
      
      console.log(`Running migration: ${file}`)
      
      const migrationPath = path.join(migrationsDir, file)
      const sql = await fs.readFile(migrationPath, 'utf-8')
      
      await client.query('BEGIN')
      
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [file]
        )
        await client.query('COMMIT')
        console.log(`✓ Migration completed: ${file}`)
      } catch (error) {
        await client.query('ROLLBACK')
        console.error(`✗ Migration failed: ${file}`, error)
        throw error
      }
    }
    
    console.log('✓ All migrations completed')
    
  } catch (error) {
    console.error('Migration error:', error)
    throw error
  } finally {
    client.release()
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  try {
    await db.end()
    console.log('✓ Database connections closed')
  } catch (error) {
    console.error('Error closing database:', error)
  }
}

// Query helper with automatic error logging
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now()
  
  try {
    const result = (await db.query(text, params)) as pg.QueryResult<T>
    const duration = Date.now() - start
    
    if (process.env.NODE_ENV === 'development' && duration > 1000) {
      console.warn(`Slow query (${duration}ms): ${text.substring(0, 100)}...`)
    }
    
    return result
  } catch (error) {
    console.error('Database query error:', {
      text: text.substring(0, 200),
      params,
      error
    })
    throw error
  }
}

// Transaction helper
export async function transaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect()
  
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Health check
export async function getHealthStatus(): Promise<{
  connected: boolean
  poolSize: number
  idleCount: number
  waitingCount: number
}> {
  try {
    await db.query('SELECT 1')
    return {
      connected: true,
      poolSize: db.totalCount,
      idleCount: db.idleCount,
      waitingCount: db.waitingCount
    }
  } catch (error) {
    return {
      connected: false,
      poolSize: 0,
      idleCount: 0,
      waitingCount: 0
    }
  }
}

// Export types
export type { QueryResult, QueryResultRow, PoolClient } from 'pg'

// Default export
export default db
