-- Setup test order for GLB-to-STL download testing
-- 
-- Usage:
--   psql -h 127.0.0.1 -U postgres -d artifact_armoury -f setup-test-order.sql
--
-- This script:
-- 1. Creates a test buyer user
-- 2. Finds a published model
-- 3. Creates a test order with payment_status = 'succeeded'
-- 4. Creates order items

-- Step 1: Create test buyer user (if not exists)
INSERT INTO users (
  email, 
  password_hash, 
  name, 
  role, 
  created_at, 
  updated_at
) VALUES (
  'test-buyer@example.com',
  '$2b$10$abcdefghijklmnopqrstuvwxyz', -- dummy hash
  'Test Buyer',
  'customer',
  NOW(),
  NOW()
) ON CONFLICT (email) DO NOTHING;

-- Step 2: Get buyer user ID
\set buyer_id `psql -h 127.0.0.1 -U postgres -d artifact_armoury -t -c "SELECT id FROM users WHERE email = 'test-buyer@example.com' LIMIT 1;"`

-- Step 3: Get a published model
\set model_id `psql -h 127.0.0.1 -U postgres -d artifact_armoury -t -c "SELECT id FROM models WHERE status = 'published' LIMIT 1;"`

-- Step 4: Create test order
INSERT INTO orders (
  user_id,
  payment_status,
  fulfillment_status,
  total_amount,
  currency,
  created_at,
  updated_at
) VALUES (
  :'buyer_id'::uuid,
  'succeeded',
  'pending',
  29.99,
  'USD',
  NOW(),
  NOW()
) RETURNING id AS order_id \gset

-- Step 5: Create order item
INSERT INTO order_items (
  order_id,
  model_id,
  quantity,
  unit_price,
  total_price,
  artist_commission_amount,
  created_at
) VALUES (
  :'order_id'::uuid,
  :'model_id'::uuid,
  1,
  29.99,
  29.99,
  5.99,
  NOW()
);

-- Display results
SELECT 
  'Test order created successfully!' as status,
  :'buyer_id'::text as buyer_id,
  :'model_id'::text as model_id,
  :'order_id'::text as order_id;

-- Display how to test
\echo ''
\echo 'To test the download endpoint:'
\echo ''
\echo '1. Get a token:'
\echo '   curl -X POST http://127.0.0.1:3001/api/auth/login \'
\echo '     -H "Content-Type: application/json" \'
\echo '     -d ''{"email": "test-buyer@example.com", "password": "TestPassword123!"}'''
\echo ''
\echo '2. Download the model:'
\echo '   curl -H "Authorization: Bearer YOUR_TOKEN" \'
\echo '     http://127.0.0.1:3001/api/models/MODEL_ID/download \'
\echo '     -o test_model.stl'
\echo ''

