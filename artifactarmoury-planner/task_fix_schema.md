# TASK: Schema Alignment & Asset Library Integration

## Overview

Fix critical schema misalignments between implementation and DEV_GUIDE.md, then integrate the Selective User Asset Library feature. This task addresses database contract violations, missing migration tooling, and frontend/backend inconsistencies.

---

## Priority: CRITICAL (Blocking Production)

**Estimated Time**: 8-12 hours  
**Dependencies**: PostgreSQL 14+, Node.js 18+, existing codebase

---

## Phase 1: Critical Schema Fixes (HIGH Priority)

### 1.1 Fix Artist Routes Schema Mismatch

**Problem**: `backend/src/routes/artists.ts` queries non-existent `artists`, `assets`, `example_tables` tables.  
**Impact**: All artist endpoints return 500 errors.

**Tasks**:

```typescript
// File: backend/src/routes/artists.ts

// ❌ REMOVE (lines 31, 114):
// SELECT * FROM artists WHERE ...
// SELECT * FROM assets WHERE artist_id = ...
// SELECT * FROM example_tables WHERE ...

// ✅ REPLACE WITH:
// Line 31 - Get artist profile
const result = await db.query(
  `SELECT 
    id, email, display_name, artist_name, artist_bio, artist_url,
    commission_rate, stripe_account_id, stripe_onboarding_complete,
    created_at
   FROM users 
   WHERE role = 'artist' AND id = $1`,
  [artistId]
);

// Line 114 - Get artist's models
const modelsResult = await db.query(
  `SELECT 
    id, name, description, category, tags, thumbnail_path,
    base_price, width, depth, height, status, visibility,
    view_count, download_count, sale_count, created_at
   FROM models 
   WHERE artist_id = $1 AND status = 'published'
   ORDER BY created_at DESC`,
  [artistId]
);

// Remove any references to example_tables
// Artist tables should query the tables table:
const tablesResult = await db.query(
  `SELECT 
    id, name, description, width, depth, is_public, 
    view_count, clone_count, created_at
   FROM tables 
   WHERE user_id = $1 AND is_public = true
   ORDER BY created_at DESC
   LIMIT 10`,
  [artistId]
);
```

**Verification**:
```bash
# Test artist endpoints
curl http://localhost:3001/api/artists/{id}
curl http://localhost:3001/api/artists/{id}/models
```

---

### 1.2 Fix Tables Routes Schema Mismatch

**Problem**: `backend/src/routes/tables.ts:47` persists to `user_tables`, but schema defines `tables` table.  
**Impact**: Table saves/loads fail completely.

**Tasks**:

```typescript
// File: backend/src/routes/tables.ts

// ❌ REMOVE all references to user_tables table
// Lines 47, 89, 134, etc.

// ✅ REPLACE WITH tables schema

// Line 47 - Save table
router.post('/', async (req, res, next) => {
  try {
    const {
      name,
      description = '',
      width = 1200,
      depth = 900,
      layout = { models: [] },
      is_public = false
    } = req.body;

    const userId = req.user?.id || null;
    
    // Generate share code
    const shareCode = crypto.randomBytes(8).toString('hex').toUpperCase();

    const result = await db.query(
      `INSERT INTO tables (
        user_id, name, description, width, depth, 
        layout, is_public, share_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [userId, name, description, width, depth, JSON.stringify(layout), is_public, shareCode]
    );

    res.status(201).json({ table: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Line 89 - Get user's tables
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    const result = await db.query(
      `SELECT 
        id, name, description, width, depth, 
        is_public, share_code, view_count, clone_count,
        created_at, updated_at
       FROM tables
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );

    res.json({ tables: result.rows });
  } catch (error) {
    next(error);
  }
});

// Line 134 - Get single table
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(
      `SELECT * FROM tables WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Increment view count
    await db.query(
      'UPDATE tables SET view_count = view_count + 1 WHERE id = $1',
      [id]
    );

    res.json({ table: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update table
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, layout, is_public } = req.body;
    
    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (layout !== undefined) {
      updates.push(`layout = $${paramCount++}`);
      values.push(JSON.stringify(layout));
    }
    if (is_public !== undefined) {
      updates.push(`is_public = $${paramCount++}`);
      values.push(is_public);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await db.query(
      `UPDATE tables SET ${updates.join(', ')} 
       WHERE id = $${paramCount} 
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    res.json({ table: result.rows[0] });
  } catch (error) {
    next(error);
  }
});
```

**Verification**:
```bash
# Test table endpoints
curl -X POST http://localhost:3001/api/tables \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Table","width":1200,"depth":900}'
```

---

### 1.3 Fix Stripe Service Schema Mismatch

**Problem**: `backend/src/services/stripe.ts` references non-existent `stripe_transfers` table and incorrect JSON path `orders.items`.  
**Impact**: Payout processing and webhook handling crash.

**Tasks**:

```typescript
// File: backend/src/services/stripe.ts

// ❌ REMOVE (line 329):
// INSERT INTO stripe_transfers ...

// ❌ REMOVE (line 367):
// SELECT items FROM orders WHERE ...

// ✅ REPLACE WITH schema-compliant code:

// Line 329 - Record payout in payments table
async function recordArtistPayout(orderId: string, artistId: string, amount: number) {
  const result = await db.query(
    `INSERT INTO payments (
      user_id, 
      order_id, 
      amount, 
      currency, 
      payment_method, 
      status,
      stripe_transfer_id
    )
    VALUES ($1, $2, $3, 'usd', 'stripe_transfer', 'completed', $4)
    RETURNING *`,
    [artistId, orderId, amount, stripeTransferId]
  );
  
  return result.rows[0];
}

// Line 367 - Get order items properly
async function getOrderItems(orderId: string) {
  const result = await db.query(
    `SELECT 
      oi.id,
      oi.model_id,
      oi.quantity,
      oi.unit_price,
      oi.subtotal,
      oi.artist_id,
      oi.artist_commission_amount,
      m.name as model_name
     FROM order_items oi
     JOIN models m ON oi.model_id = m.id
     WHERE oi.order_id = $1`,
    [orderId]
  );
  
  return result.rows;
}

// Update webhook handler to use correct schema
export async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata.order_id;
  
  try {
    await db.query('BEGIN');
    
    // Update order status
    await db.query(
      `UPDATE orders 
       SET status = 'paid', payment_intent_id = $1, paid_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [paymentIntent.id, orderId]
    );
    
    // Get all order items with artist info
    const items = await getOrderItems(orderId);
    
    // Process artist payouts
    for (const item of items) {
      if (item.artist_commission_amount > 0) {
        // Get artist's Stripe account
        const artistResult = await db.query(
          'SELECT stripe_account_id FROM users WHERE id = $1',
          [item.artist_id]
        );
        
        const stripeAccountId = artistResult.rows[0]?.stripe_account_id;
        
        if (stripeAccountId) {
          // Create transfer
          const transfer = await stripe.transfers.create({
            amount: Math.round(item.artist_commission_amount * 100), // cents
            currency: 'usd',
            destination: stripeAccountId,
            metadata: {
              order_id: orderId,
              order_item_id: item.id,
              model_id: item.model_id
            }
          });
          
          // Record payment
          await db.query(
            `INSERT INTO payments (
              user_id, order_id, amount, currency, 
              payment_method, status, stripe_transfer_id
            )
            VALUES ($1, $2, $3, 'usd', 'stripe_transfer', 'completed', $4)`,
            [item.artist_id, orderId, item.artist_commission_amount, transfer.id]
          );
        }
      }
    }
    
    await db.query('COMMIT');
    
    // Send confirmation email
    await sendOrderConfirmationEmail(orderId);
    
  } catch (error) {
    await db.query('ROLLBACK');
    logger.error('Payment processing failed', { error, orderId });
    throw error;
  }
}
```

**Verification**:
```bash
# Test webhook locally with Stripe CLI
stripe listen --forward-to localhost:3001/api/webhooks/stripe
stripe trigger payment_intent.succeeded
```

---

## Phase 2: Migration Tooling (MEDIUM Priority)

### 2.1 Create Migration Script

**Problem**: `npm run migrate` advertised but `backend/scripts/migrate.ts` doesn't exist.  
**Impact**: No scripted database bootstrap path.

**Tasks**:

```bash
# Create scripts directory
mkdir -p backend/scripts
```

```typescript
// File: backend/scripts/migrate.ts

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

interface Migration {
  version: number;
  name: string;
  sql: string;
}

async function getCurrentVersion(): Promise<number> {
  try {
    const result = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
    );
    return result.rows[0]?.version || 0;
  } catch (error) {
    // Table doesn't exist yet, return 0
    return 0;
  }
}

async function createMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function loadMigrations(): Promise<Migration[]> {
  const migrationsDir = path.join(__dirname, '../db/migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('📁 Creating migrations directory...');
    fs.mkdirSync(migrationsDir, { recursive: true });
    return [];
  }
  
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  return files.map(file => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename: ${file}`);
    }
    
    const [, versionStr, name] = match;
    const version = parseInt(versionStr, 10);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    
    return { version, name, sql };
  });
}

async function runMigrations() {
  console.log('🚀 Starting database migrations...\n');
  
  try {
    await createMigrationsTable();
    const currentVersion = await getCurrentVersion();
    console.log(`📊 Current schema version: ${currentVersion}`);
    
    const migrations = await loadMigrations();
    const pendingMigrations = migrations.filter(m => m.version > currentVersion);
    
    if (pendingMigrations.length === 0) {
      console.log('✅ Database is up to date!\n');
      return;
    }
    
    console.log(`📦 Found ${pendingMigrations.length} pending migration(s)\n`);
    
    for (const migration of pendingMigrations) {
      console.log(`⏳ Running migration ${migration.version}: ${migration.name}...`);
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // Run migration SQL
        await client.query(migration.sql);
        
        // Record migration
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        
        await client.query('COMMIT');
        console.log(`✅ Migration ${migration.version} completed\n`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Migration ${migration.version} failed:`, error);
        throw error;
      } finally {
        client.release();
      }
    }
    
    console.log('🎉 All migrations completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Migration process failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}
```

```typescript
// File: backend/scripts/rollback.ts

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function rollback(steps: number = 1) {
  console.log(`🔄 Rolling back ${steps} migration(s)...\n`);
  
  try {
    const result = await pool.query(
      `SELECT version, name 
       FROM schema_migrations 
       ORDER BY version DESC 
       LIMIT $1`,
      [steps]
    );
    
    if (result.rows.length === 0) {
      console.log('ℹ️  No migrations to rollback\n');
      return;
    }
    
    for (const row of result.rows) {
      console.log(`⏳ Rolling back: ${row.version} - ${row.name}`);
      
      await pool.query(
        'DELETE FROM schema_migrations WHERE version = $1',
        [row.version]
      );
      
      console.log(`✅ Rolled back version ${row.version}\n`);
    }
    
    console.log('⚠️  Note: Rollback only removes migration records.');
    console.log('   You must manually undo schema changes if needed.\n');
    
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const steps = parseInt(process.argv[2] || '1', 10);
rollback(steps);
```

```json
// File: backend/package.json (update scripts)

{
  "scripts": {
    "migrate": "tsx scripts/migrate.ts",
    "migrate:rollback": "tsx scripts/rollback.ts",
    "migrate:status": "tsx scripts/migrate-status.ts",
    "db:seed": "tsx scripts/seed-dev-data.ts"
  }
}
```

**Create Initial Migration**:

```bash
mkdir -p backend/db/migrations
```

```sql
-- File: backend/db/migrations/001_initial_schema.sql

-- Run the complete schema from schema.sql
-- Copy the entire contents of backend/src/db/schema.sql here
```

```sql
-- File: backend/db/migrations/002_add_tables_columns.sql

-- Add missing columns to tables for asset library support
ALTER TABLE tables ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' 
    CHECK (status IN ('active', 'archived'));
ALTER TABLE tables ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'user_free'
    CHECK (plan IN ('anon_free', 'user_free', 'pro'));
ALTER TABLE tables ADD COLUMN IF NOT EXISTS max_assets INTEGER DEFAULT 1000;

CREATE INDEX IF NOT EXISTS idx_tables_session ON tables(session_id);
CREATE INDEX IF NOT EXISTS idx_tables_status ON tables(status);
```

**Verification**:
```bash
npm run migrate
npm run migrate:status
```

---

## Phase 3: Frontend Fixes (MEDIUM Priority)

### 3.1 Fix Duplicate Checkout Component

**Problem**: `frontend/src/pages/Checkout.tsx` has two competing components.  
**Impact**: Module export broken, checkout UI blocked.

**Tasks**:

```typescript
// File: frontend/src/pages/Checkout.tsx

// ❌ REMOVE duplicate component definitions
// Keep only the more complete implementation

// ✅ FINAL VERSION:

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import axios from 'axios';
import toast from 'react-hot-toast';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

interface CartItem {
  model_id: string;
  name: string;
  price: number;
  quantity: number;
  thumbnail_path: string;
}

interface CheckoutFormProps {
  items: CartItem[];
  total: number;
}

const CheckoutForm: React.FC<CheckoutFormProps> = ({ items, total }) => {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  
  const [processing, setProcessing] = useState(false);
  const [shippingInfo, setShippingInfo] = useState({
    name: '',
    email: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'US'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!stripe || !elements) {
      return;
    }
    
    setProcessing(true);
    
    try {
      // Create order and get client secret
      const { data } = await axios.post('/api/orders', {
        items: items.map(item => ({
          model_id: item.model_id,
          quantity: item.quantity,
          unit_price: item.price
        })),
        shipping: shippingInfo
      });
      
      const { clientSecret, orderId } = data;
      
      // Confirm payment
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }
      
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: shippingInfo.name,
            email: shippingInfo.email,
            address: {
              line1: shippingInfo.address_line1,
              line2: shippingInfo.address_line2,
              city: shippingInfo.city,
              state: shippingInfo.state,
              postal_code: shippingInfo.postal_code,
              country: shippingInfo.country
            }
          }
        }
      });
      
      if (result.error) {
        toast.error(result.error.message || 'Payment failed');
      } else {
        toast.success('Order placed successfully!');
        navigate(`/orders/${orderId}`);
      }
      
    } catch (error: any) {
      console.error('Checkout error:', error);
      toast.error(error.response?.data?.error || 'Checkout failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Shipping Information */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Shipping Information</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Full Name"
            required
            className="border rounded px-4 py-2"
            value={shippingInfo.name}
            onChange={(e) => setShippingInfo({ ...shippingInfo, name: e.target.value })}
          />
          
          <input
            type="email"
            placeholder="Email"
            required
            className="border rounded px-4 py-2"
            value={shippingInfo.email}
            onChange={(e) => setShippingInfo({ ...shippingInfo, email: e.target.value })}
          />
          
          <input
            type="text"
            placeholder="Address Line 1"
            required
            className="border rounded px-4 py-2 md:col-span-2"
            value={shippingInfo.address_line1}
            onChange={(e) => setShippingInfo({ ...shippingInfo, address_line1: e.target.value })}
          />
          
          <input
            type="text"
            placeholder="Address Line 2 (Optional)"
            className="border rounded px-4 py-2 md:col-span-2"
            value={shippingInfo.address_line2}
            onChange={(e) => setShippingInfo({ ...shippingInfo, address_line2: e.target.value })}
          />
          
          <input
            type="text"
            placeholder="City"
            required
            className="border rounded px-4 py-2"
            value={shippingInfo.city}
            onChange={(e) => setShippingInfo({ ...shippingInfo, city: e.target.value })}
          />
          
          <input
            type="text"
            placeholder="State/Province"
            required
            className="border rounded px-4 py-2"
            value={shippingInfo.state}
            onChange={(e) => setShippingInfo({ ...shippingInfo, state: e.target.value })}
          />
          
          <input
            type="text"
            placeholder="Postal Code"
            required
            className="border rounded px-4 py-2"
            value={shippingInfo.postal_code}
            onChange={(e) => setShippingInfo({ ...shippingInfo, postal_code: e.target.value })}
          />
        </div>
      </div>
      
      {/* Payment Information */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Payment Information</h2>
        
        <div className="border rounded px-4 py-3">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#424770',
                  '::placeholder': {
                    color: '#aab7c4',
                  },
                },
                invalid: {
                  color: '#9e2146',
                },
              },
            }}
          />
        </div>
      </div>
      
      {/* Order Summary */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-bold mb-4">Order Summary</h2>
        
        <div className="space-y-2 mb-4">
          {items.map((item) => (
            <div key={item.model_id} className="flex justify-between text-sm">
              <span>{item.name} × {item.quantity}</span>
              <span>${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
        </div>
        
        <div className="border-t pt-2">
          <div className="flex justify-between font-bold text-lg">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
      
      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400"
      >
        {processing ? 'Processing...' : `Pay $${total.toFixed(2)}`}
      </button>
    </form>
  );
};

const Checkout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [items, setItems] = useState<CartItem[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    // Get cart items from location state or localStorage
    const cartItems = location.state?.items || JSON.parse(localStorage.getItem('cart') || '[]');
    
    if (cartItems.length === 0) {
      toast.error('Your cart is empty');
      navigate('/browse');
      return;
    }
    
    setItems(cartItems);
    setTotal(cartItems.reduce((sum: number, item: CartItem) => 
      sum + (item.price * item.quantity), 0
    ));
  }, [location, navigate]);

  if (items.length === 0) {
    return <div className="container mx-auto px-4 py-8">Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">Checkout</h1>
      
      <Elements stripe={stripePromise}>
        <CheckoutForm items={items} total={total} />
      </Elements>
    </div>
  );
};

export default Checkout;
```

---

### 3.2 Fix Table Builder Persistence

**Problem**: 3D builder expects `user_tables` but schema uses `tables`.

**Tasks**:

Update all frontend table-related API calls:

```typescript
// File: frontend/src/api/tables.ts

import axios from 'axios';

export interface Table {
  id: string;
  name: string;
  description: string;
  width: number;
  depth: number;
  layout: {
    models: Array<{
      modelId: string;
      x: number;
      y: number;
      rotation: number;
      scale: number;
    }>;
  };
  is_public: boolean;
  share_code: string;
  created_at: string;
  updated_at: string;
}

export const tablesApi = {
  create: async (data: Partial<Table>): Promise<Table> => {
    const response = await axios.post('/api/tables', data);
    return response.data.table;
  },

  getById: async (id: string): Promise<Table> => {
    const response = await axios.get(`/api/tables/${id}`);
    return response.data.table;
  },

  getUserTables: async (userId: string): Promise<Table[]> => {
    const response = await axios.get(`/api/tables/user/${userId}`);
    return response.data.tables;
  },

  update: async (id: string, data: Partial<Table>): Promise<Table> => {
    const response = await axios.patch(`/api/tables/${id}`, data);
    return response.data.table;
  },

  delete: async (id: string): Promise<void> => {
    await axios.delete(`/api/tables/${id}`);
  }
};
```

Update the table builder component to use correct API:

```typescript
// File: frontend/src/table-top-terrain-builder/TerrainBuilder.tsx

// Replace all instances of:
// axios.post('/api/user_tables', ...)
// WITH:
// axios.post('/api/tables', ...)

// Replace all instances of:
// axios.get('/api/user_tables/:id')
// WITH:
// axios.get('/api/tables/:id')
```

---

## Phase 4: Integrate Asset Library (NEW FEATURE)

Now that schema is aligned, integrate the Selective User Asset Library from the integration guide.

### 4.1 Run Asset Library Migration

```sql
-- File: backend/db/migrations/003_asset_library.sql

-- Copy the complete schema from the Asset Library Integration Guide
-- This includes:
-- - anonymous_sessions
-- - assets (replaces/extends models)
-- - sets
-- - set_assets
-- - table_assets
-- - table_sets
-- - recent_asset_usage

-- (Copy from "Database Schema Extensions" section of integration guide)
```

### 4.2 Add Backend Routes

```bash
# Create new files from integration guide:

# 1. Session middleware
touch backend/src/middleware/session.ts
# Copy content from integration guide section 2

# 2. Library routes
touch backend/src/routes/library.ts
# Copy content from integration guide section 2

# 3. Table library routes
touch backend/src/routes/table-library.ts
# Copy content from integration guide section 2
```

Update backend app registration:

```typescript
// File: backend/src/app.ts

import sessionRoutes from './middleware/session.js';
import libraryRoutes from './routes/library.js';
import tableLibraryRoutes from './routes/table-library.js';

// Register new routes (add after existing routes)
app.use('/api/library', libraryRoutes);
app.use('/api/tables', tableLibraryRoutes);
```

### 4.3 Add Frontend Components

```bash
# Create new files from integration guide:

# 1. Session hook
mkdir -p frontend/src/hooks
touch frontend/src/hooks/useSession.ts
# Copy content from integration guide section 3

# 2. Library store
touch frontend/src/store/libraryStore.ts
# Copy content from integration guide section 3

# 3. Pages
touch frontend/src/pages/GlobalLibrary.tsx
touch frontend/src/pages/TableLibrary.tsx

# 4. Components
mkdir -p frontend/src/components/VirtualTable
touch frontend/src/components/VirtualTable/AssetDrawer.tsx
```

Update frontend routes:

```typescript
// File: frontend/src/App.tsx

import { GlobalLibrary } from './pages/GlobalLibrary';
import { TableLibrary } from './pages/TableLibrary';

// Add new routes
<Route path="/library/browse/:tableId" element={<GlobalLibrary />} />
<Route path="/library/manage/:tableId" element={<TableLibrary />} />
```

### 4.4 Update Existing Table Components

Integrate Asset Drawer into existing Virtual Table:

```typescript
// File: frontend/src/table-top-terrain-builder/TerrainBuilder.tsx

import { useState } from 'react';
import { AssetDrawer } from '../components/VirtualTable/AssetDrawer';
import { useLibraryStore } from '../store/libraryStore';

const TerrainBuilder: React.FC = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { trackAssetUsage } = useLibraryStore();
  
  const handleAssetSelect = async (assetId: string) => {
    // Track usage
    await trackAssetUsage(currentTableId, assetId);
    
    // Add to scene (existing logic)
    addModelToScene(assetId);
    
    setDrawerOpen(false);
  };
  
  return (
    <div className="relative">
      {/* Existing 3D canvas */}
      <Canvas>
        {/* ... existing scene setup ... */}
      </Canvas>
      
      {/* Add Asset Library button */}
      <button
        onClick={() => setDrawerOpen(true)}
        className="absolute top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        📚 Asset Library
      </button>
      
      {/* Asset Drawer */}
      <AssetDrawer
        tableId={currentTableId}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelectAsset={handleAssetSelect}
      />
    </div>
  );
};
```

---

## Phase 5: Data Migration & Cleanup

### 5.1 Migrate Existing Models to Assets

```typescript
// File: backend/scripts/migrate-models-to-assets.ts

import { db } from '../src/db/index.js';
import logger from '../src/utils/logger.js';

async function migrateModelsToAssets() {
  console.log('🔄 Migrating models to assets table...\n');
  
  try {
    await db.query('BEGIN');
    
    // Copy published models to assets
    const result = await db.query(`
      INSERT INTO assets (
        id, artist_id, name, description, category, tags,
        file_ref, glb_file_path, preview_url, thumbnail_path,
        dimensions_mm, poly_count, base_price, status, visibility,
        view_count, created_at, updated_at, published_at
      )
      SELECT 
        id,
        artist_id,
        name,
        description,
        category,
        tags,
        stl_file_path as file_ref,
        glb_file_path,
        thumbnail_path as preview_url,
        thumbnail_path,
        jsonb_build_object('x', width, 'y', depth, 'z', height) as dimensions_mm,
        NULL as poly_count,
        base_price,
        status,
        visibility,
        view_count,
        created_at,
        updated_at,
        published_at
      FROM models
      WHERE status = 'published'
      ON CONFLICT (id) DO NOTHING
    `);
    
    console.log(`✅ Migrated ${result.rowCount} models to assets\n`);
    
    // Update stats
    await db.query(`
      UPDATE assets a
      SET 
        add_count = COALESCE((
          SELECT COUNT(*) FROM favorites WHERE model_id = a.id
        ), 0),
        use_count = a.view_count
      WHERE EXISTS (SELECT 1 FROM models WHERE id = a.id)
    `);
    
    await db.query('COMMIT');
    
    console.log('🎉 Migration completed successfully!\n');
    console.log('⚠️  Note: Original models table preserved.');
    console.log('   Review and drop manually if no longer needed.\n');
    
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await db.closePool();
  }
}

migrateModelsToAssets();
```

```json
// Add to package.json scripts:
{
  "scripts": {
    "migrate:models-to-assets": "tsx scripts/migrate-models-to-assets.ts"
  }
}
```

### 5.2 Clean Up Legacy Tables

After verifying the migration works:

```sql
-- File: backend/db/migrations/004_cleanup_legacy.sql

-- Drop legacy tables (ONLY after verification)
-- Uncomment when ready:

-- DROP TABLE IF EXISTS artists CASCADE;
-- DROP TABLE IF EXISTS assets CASCADE;
-- DROP TABLE IF EXISTS example_tables CASCADE;
-- DROP TABLE IF EXISTS user_tables CASCADE;
-- DROP TABLE IF EXISTS stripe_transfers CASCADE;

-- Add comment for now:
COMMENT ON TABLE models IS 'Legacy table - migrated to assets. Review before dropping.';
```

---

## Phase 6: Testing & Verification

### 6.1 Backend Tests

Create comprehensive test suite:

```typescript
// File: backend/src/__tests__/integration/schema-alignment.test.ts

import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db';

describe('Schema Alignment Tests', () => {
  
  describe('Artist Routes', () => {
    let artistId: string;
    
    beforeAll(async () => {
      // Create test artist
      const result = await db.query(
        `INSERT INTO users (email, password_hash, display_name, role, artist_name)
         VALUES ($1, $2, $3, 'artist', $4)
         RETURNING id`,
        ['test-artist@example.com', 'hash', 'Test Artist', 'TestArtist']
      );
      artistId = result.rows[0].id;
    });
    
    afterAll(async () => {
      await db.query('DELETE FROM users WHERE id = $1', [artistId]);
    });
    
    it('should fetch artist profile from users table', async () => {
      const response = await request(app)
        .get(`/api/artists/${artistId}`);
      
      expect(response.status).toBe(200);
      expect(response.body.artist.artist_name).toBe('TestArtist');
      expect(response.body.artist.email).toBeDefined();
    });
    
    it('should fetch artist models from models table', async () => {
      // Create test model
      await db.query(
        `INSERT INTO models (artist_id, name, category, stl_file_path, base_price, status)
         VALUES ($1, 'Test Model', 'terrain', '/test.stl', 10.00, 'published')`,
        [artistId]
      );
      
      const response = await request(app)
        .get(`/api/artists/${artistId}/models`);
      
      expect(response.status).toBe(200);
      expect(response.body.models).toBeInstanceOf(Array);
      expect(response.body.models.length).toBeGreaterThan(0);
    });
  });
  
  describe('Tables Routes', () => {
    let userId: string;
    let tableId: string;
    
    beforeAll(async () => {
      const result = await db.query(
        `INSERT INTO users (email, password_hash, display_name, role)
         VALUES ('test-user@example.com', 'hash', 'Test User', 'customer')
         RETURNING id`
      );
      userId = result.rows[0].id;
    });
    
    afterAll(async () => {
      if (tableId) await db.query('DELETE FROM tables WHERE id = $1', [tableId]);
      await db.query('DELETE FROM users WHERE id = $1', [userId]);
    });
    
    it('should save table to tables table (not user_tables)', async () => {
      const response = await request(app)
        .post('/api/tables')
        .set('Authorization', `Bearer ${generateTestToken(userId)}`)
        .send({
          name: 'Test Table',
          description: 'Test Description',
          width: 1200,
          depth: 900,
          layout: { models: [] }
        });
      
      expect(response.status).toBe(201);
      expect(response.body.table.id).toBeDefined();
      tableId = response.body.table.id;
      
      // Verify in database
      const result = await db.query(
        'SELECT * FROM tables WHERE id = $1',
        [tableId]
      );
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].user_id).toBe(userId);
      
      // Verify NOT in user_tables (should not exist)
      const legacyCheck = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'user_tables'
        )
      `);
      
      if (legacyCheck.rows[0].exists) {
        const legacyResult = await db.query(
          'SELECT * FROM user_tables WHERE id = $1',
          [tableId]
        );
        expect(legacyResult.rows.length).toBe(0);
      }
    });
    
    it('should retrieve table with correct schema', async () => {
      const response = await request(app)
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${generateTestToken(userId)}`);
      
      expect(response.status).toBe(200);
      expect(response.body.table.layout).toBeDefined();
      expect(response.body.table.share_code).toBeDefined();
      expect(response.body.table.is_public).toBeDefined();
    });
  });
  
  describe('Stripe Service', () => {
    it('should use order_items table (not orders.items JSON)', async () => {
      // Create test order
      const orderResult = await db.query(
        `INSERT INTO orders (order_number, user_id, customer_email, 
          shipping_name, shipping_address_line1, shipping_city, 
          shipping_state, shipping_postal_code, shipping_country,
          subtotal, shipping_cost, tax, total, status)
         VALUES ('TEST-001', NULL, 'test@example.com', 
          'Test User', '123 Test St', 'Test City',
          'TS', '12345', 'US',
          100.00, 10.00, 5.00, 115.00, 'paid')
         RETURNING id`
      );
      const orderId = orderResult.rows[0].id;
      
      // Create order items
      await db.query(
        `INSERT INTO order_items (order_id, model_id, quantity, unit_price, 
          subtotal, artist_id, artist_commission_amount)
         VALUES ($1, (SELECT id FROM models LIMIT 1), 1, 100.00, 
          100.00, (SELECT id FROM users WHERE role='artist' LIMIT 1), 15.00)`,
        [orderId]
      );
      
      // Verify structure
      const items = await db.query(
        `SELECT * FROM order_items WHERE order_id = $1`,
        [orderId]
      );
      
      expect(items.rows.length).toBeGreaterThan(0);
      expect(items.rows[0].artist_commission_amount).toBeDefined();
      
      // Clean up
      await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
      await db.query('DELETE FROM orders WHERE id = $1', [orderId]);
    });
    
    it('should use payments table (not stripe_transfers)', async () => {
      // Verify stripe_transfers doesn't exist
      const result = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'stripe_transfers'
        )
      `);
      
      expect(result.rows[0].exists).toBe(false);
      
      // Verify payments table exists and has correct structure
      const paymentsCheck = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'payments'
      `);
      
      const columns = paymentsCheck.rows.map(r => r.column_name);
      expect(columns).toContain('stripe_transfer_id');
      expect(columns).toContain('order_id');
      expect(columns).toContain('user_id');
    });
  });
  
  describe('Asset Library Integration', () => {
    let tableId: string;
    let assetId: string;
    
    beforeAll(async () => {
      // Create test table
      const tableRes = await db.query(
        `INSERT INTO tables (name, width, depth, layout, status)
         VALUES ('Test Table', 1200, 900, '{"models":[]}', 'active')
         RETURNING id`
      );
      tableId = tableRes.rows[0].id;
      
      // Create test asset
      const assetRes = await db.query(
        `INSERT INTO assets (artist_id, name, category, file_ref, base_price, status, visibility)
         VALUES ((SELECT id FROM users WHERE role='artist' LIMIT 1), 
          'Test Asset', 'terrain', '/test.glb', 10.00, 'published', 'public')
         RETURNING id`
      );
      assetId = assetRes.rows[0].id;
    });
    
    afterAll(async () => {
      await db.query('DELETE FROM table_assets WHERE table_id = $1', [tableId]);
      await db.query('DELETE FROM tables WHERE id = $1', [tableId]);
      await db.query('DELETE FROM assets WHERE id = $1', [assetId]);
    });
    
    it('should add asset to table library', async () => {
      const response = await request(app)
        .post(`/api/tables/${tableId}/library/assets`)
        .send({ asset_id: assetId });
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
    
    it('should enforce 3-table limit for anonymous users', async () => {
      // Create 3 tables
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/tables')
          .set('x-session-id', 'test-session-123')
          .send({
            name: `Table ${i}`,
            width: 1200,
            depth: 900
          });
      }
      
      // 4th should fail
      const response = await request(app)
        .post('/api/tables')
        .set('x-session-id', 'test-session-123')
        .send({
          name: 'Table 4',
          width: 1200,
          depth: 900
        });
      
      expect(response.status).toBe(402);
      expect(response.body.error).toContain('limit');
    });
  });
});

function generateTestToken(userId: string): string {
  // Implement JWT token generation for tests
  return 'test-token';
}
```

### 6.2 Frontend Tests

```typescript
// File: frontend/src/__tests__/integration/tables.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import axios from 'axios';
import { TableLibrary } from '../../pages/TableLibrary';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Table Library Integration', () => {
  it('should fetch table library from correct endpoint', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        assets: [
          {
            id: 'asset-1',
            name: 'Test Asset',
            thumbnail_path: '/test.jpg',
            category: 'terrain',
            tags: ['ww2']
          }
        ],
        total: 1
      }
    });
    
    render(
      <BrowserRouter>
        <TableLibrary />
      </BrowserRouter>
    );
    
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/tables/')
      );
      expect(screen.getByText('Test Asset')).toBeInTheDocument();
    });
  });
});
```

### 6.3 Manual Testing Checklist

```markdown
## Manual Testing Checklist

### Artist Routes
- [ ] GET /api/artists/:id returns artist from users table
- [ ] GET /api/artists/:id/models returns models from models table
- [ ] No 500 errors on artist endpoints

### Tables Routes
- [ ] POST /api/tables saves to tables table (not user_tables)
- [ ] GET /api/tables/:id retrieves correct schema
- [ ] PATCH /api/tables/:id updates correctly
- [ ] Table share_code is generated
- [ ] Table layout JSON structure matches guide

### Stripe Integration
- [ ] Order creation works
- [ ] order_items are created (not orders.items JSON)
- [ ] Payment webhook processes correctly
- [ ] Artist payouts recorded in payments table
- [ ] No references to stripe_transfers table

### Migrations
- [ ] npm run migrate executes successfully
- [ ] npm run migrate:status shows current version
- [ ] npm run migrate:rollback works
- [ ] Database schema matches schema.sql

### Asset Library
- [ ] Anonymous sessions created on first visit
- [ ] Session persists across page refreshes
- [ ] Can create up to 3 tables without auth
- [ ] 4th table creation blocked with 402 error
- [ ] Can add assets to table library
- [ ] Can add sets (bulk operation)
- [ ] Remove asset shows undo toast
- [ ] Undo works within 5 minutes
- [ ] Asset drawer opens in Virtual Table
- [ ] Recent assets tracked correctly

### Frontend
- [ ] Checkout page loads without errors
- [ ] Table builder persists to /api/tables
- [ ] Global library browser works
- [ ] Table library manager works
- [ ] Asset drawer integrates with 3D scene
```

---

## Phase 7: Documentation Updates

### 7.1 Update DEV_GUIDE.md

```markdown
## Add to DEV_GUIDE.md

### Database Migrations

The project uses a custom migration system:

```bash
# Run all pending migrations
npm run migrate

# Check migration status
npm run migrate:status

# Rollback last migration
npm run migrate:rollback

# Rollback multiple migrations
npm run migrate:rollback 3
```

### Creating New Migrations

```bash
# Create new migration file
touch backend/db/migrations/00X_description.sql
```

Migration files must:
- Follow naming convention: `###_description.sql`
- Be numbered sequentially
- Contain idempotent SQL when possible
- Be tested before commit

### Asset Library System

The application now uses a per-table asset library system:

- **Anonymous users**: Can create up to 3 tables via session cookies (30-day TTL)
- **Authenticated users**: Start with 3 tables, upgradeable to 10+ on Pro plan
- **Assets**: Global library of 3D models artists upload
- **Sets**: Curated collections of multiple assets
- **Table Library**: Per-table subset of assets users have added

See the Asset Library Integration Guide for full documentation.
```

### 7.2 Create Migration Guide

```markdown
// File: docs/MIGRATION_GUIDE.md

# Schema Migration Guide

## Overview

This guide documents the migration from the legacy schema to the current DEV_GUIDE-compliant schema.

## What Changed

### Tables Renamed/Removed
- ❌ `artists` → ✅ `users` (with role='artist')
- ❌ `assets` → ✅ `models` (for existing), `assets` (new asset library)
- ❌ `example_tables` → ✅ `tables`
- ❌ `user_tables` → ✅ `tables`
- ❌ `stripe_transfers` → ✅ `payments`

### Schema Changes
- `orders.items` JSON field → `order_items` table
- Added `assets` table for asset library
- Added `sets`, `table_assets`, `table_sets` for library management
- Added `anonymous_sessions` for unauthenticated users
- Added session_id, status, plan to `tables`

## Migration Steps

1. **Backup database**
   ```bash
   pg_dump -U postgres -d terrain_builder > backup_$(date +%Y%m%d).sql
   ```

2. **Run migrations**
   ```bash
   npm run migrate
   ```

3. **Migrate existing data**
   ```bash
   npm run migrate:models-to-assets
   ```

4. **Verify data integrity**
   ```bash
   npm run test:integration
   ```

5. **Update application**
   ```bash
   # Pull latest code
   git pull origin main
   
   # Install dependencies
   npm install
   
   # Restart services
   npm run dev
   ```

## Rollback Plan

If issues occur:

```bash
# Restore from backup
psql -U postgres -d terrain_builder < backup_YYYYMMDD.sql

# Or rollback migrations
npm run migrate:rollback
```

## Verification Queries

```sql
-- Check artist data migrated correctly
SELECT COUNT(*) FROM users WHERE role = 'artist';

-- Check tables schema
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'tables';

-- Verify no legacy tables
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('artists', 'user_tables', 'stripe_transfers');
-- Should return 0 rows

-- Check order_items structure
SELECT * FROM order_items LIMIT 1;
```
```

---

## Phase 8: Deployment

### 8.1 Pre-Deployment Checklist

```markdown
## Pre-Deployment Checklist

### Code Review
- [ ] All schema references updated
- [ ] No references to legacy tables
- [ ] Migration files reviewed and tested
- [ ] Tests passing (npm test)
- [ ] TypeScript compilation successful (npm run build)

### Database
- [ ] Backup created
- [ ] Migration files in version control
- [ ] Migration tested on staging
- [ ] Rollback plan documented

### Environment
- [ ] Environment variables updated
- [ ] Session secret configured
- [ ] Stripe keys verified
- [ ] Database URL correct

### Documentation
- [ ] DEV_GUIDE.md updated
- [ ] MIGRATION_GUIDE.md created
- [ ] API endpoints documented
- [ ] Changelog updated
```

### 8.2 Deployment Steps

```bash
# File: deploy.sh

#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# 1. Backup database
echo "📦 Creating database backup..."
pg_dump -U $DB_USER -d $DB_NAME > "backup_$(date +%Y%m%d_%H%M%S).sql"

# 2. Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# 3. Install dependencies
echo "📚 Installing dependencies..."
cd backend && npm ci
cd ../frontend && npm ci

# 4. Run migrations
echo "🔄 Running database migrations..."
cd ../backend && npm run migrate

# 5. Migrate existing data
echo "🔄 Migrating models to assets..."
npm run migrate:models-to-assets

# 6. Build frontend
echo "🏗️  Building frontend..."
cd ../frontend && npm run build

# 7. Restart services
echo "🔄 Restarting services..."
pm2 restart terrain-builder-backend
pm2 restart terrain-builder-frontend

# 8. Health check
echo "🏥 Running health check..."
sleep 5
curl -f http://localhost:3001/health || exit 1

echo "✅ Deployment completed successfully!"
```

---

## Timeline & Priorities

### Day 1 (4-6 hours)
- ✅ Phase 1.1: Fix Artist Routes (1 hour)
- ✅ Phase 1.2: Fix Tables Routes (1-2 hours)
- ✅ Phase 1.3: Fix Stripe Service (1-2 hours)
- ✅ Phase 2.1: Create Migration Script (1 hour)

### Day 2 (4-6 hours)
- ✅ Phase 3.1: Fix Checkout Component (1 hour)
- ✅ Phase 3.2: Fix Table Builder (1 hour)
- ✅ Phase 4.1-4.2: Backend Asset Library (2-3 hours)

### Day 3 (2-4 hours)
- ✅ Phase 4.3-4.4: Frontend Asset Library (2-3 hours)
- ✅ Phase 5: Data Migration (1 hour)

### Day 4 (2-3 hours)
- ✅ Phase 6: Testing (1-2 hours)
- ✅ Phase 7: Documentation (1 hour)

### Day 5 (Deployment)
- ✅ Phase 8: Deployment to staging/production

---

## Success Criteria

### Critical (Must Have)
- [ ] All artist endpoints return 200 (not 500)
- [ ] Table persistence works end-to-end
- [ ] Stripe webhooks process without errors
- [ ] Migrations run successfully
- [ ] No references to legacy tables in code

### Important (Should Have)
- [ ] Asset library functional
- [ ] Anonymous sessions working
- [ ] 3-table limit enforced
- [ ] Frontend components integrated
- [ ] Tests passing (>80% coverage)

### Nice to Have
- [ ] Performance optimized
- [ ] Full test coverage (>90%)
- [ ] Documentation complete
- [ ] Monitoring dashboards

---

## Risk Mitigation

### Risk: Data Loss During Migration
**Mitigation**: 
- Full database backup before migration
- Test migrations on staging first
- Keep legacy tables temporarily (mark deprecated)
- Implement rollback script

### Risk: Breaking Changes in Production
**Mitigation**:
- Feature flags for new asset library
- Blue-green deployment strategy
- Canary releases for critical endpoints
- Automated health checks

### Risk: Session Conflicts
**Mitigation**:
- Clear session cookies during deployment
- Version session schema
- Graceful degradation for old sessions

---

## Post-Deployment Monitoring

### Metrics to Watch

```sql
-- Check for 500 errors (should be 0)
SELECT COUNT(*) FROM activity_log 
WHERE action LIKE '%error%' 
AND created_at > NOW() - INTERVAL '1 hour';

-- Monitor table creation rate
SELECT COUNT(*), DATE_TRUNC('hour', created_at) as hour
FROM tables 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- Asset library adoption
SELECT 
  COUNT(DISTINCT table_id) as tables_with_assets,
  AVG(asset_count) as avg_assets_per_table
FROM (
  SELECT table_id, COUNT(*) as asset_count
  FROM table_assets
  WHERE removed_at IS NULL
  GROUP BY table_id
) sub;

-- Anonymous vs authenticated sessions
SELECT 
  COUNT(*) FILTER (WHERE session_id IS NOT NULL) as anonymous_tables,
  COUNT(*) FILTER (WHERE user_id IS NOT NULL) as authenticated_tables
FROM tables
WHERE created_at > NOW() - INTERVAL '7 days';
```

### Alerts
- 500 error rate > 1%
- Migration failure
- Database connection errors
- Stripe webhook failures

---

## Support & Troubleshooting

### Common Issues

**Issue**: Migration fails with "table already exists"
```bash
# Solution: Check schema_migrations table
psql -d terrain_builder -c "SELECT * FROM schema_migrations"

# If needed, manually mark migration as complete
psql -d terrain_builder -c "INSERT INTO schema_migrations (version, name) VALUES (1, 'initial_schema')"
```

**Issue**: Artist endpoints still return 500
```bash
# Verify artists migrated to users table
psql -d terrain_builder -c "SELECT COUNT(*) FROM users WHERE role='artist'"

# Check for remaining references to artists table
grep -r "FROM artists" backend/src/
```

**Issue**: Table limit not enforced
```bash
# Check session middleware is registered
grep "sessionMiddleware" backend/src/app.ts

# Verify anonymous_sessions table exists
psql -d terrain_builder -c "\dt anonymous_sessions"
```

---

## Completion Checklist

- [ ] All HIGH priority fixes completed
- [ ] All MEDIUM priority fixes completed
- [ ] Asset library integrated
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Code reviewed
- [ ] Deployed to staging
- [ ] Staging verified
- [ ] Deployed to production
- [ ] Production monitoring active
- [ ] Team notified

---

**Estimated Total Time**: 12-16 hours over 5 days

**Last Updated**: [Current Date]  
**Version**: 1.0  
**Status**: Ready for Implementation