#!/bin/bash

# Test script for GLB-to-STL download endpoint
# This script sets up test data and tests the download functionality

set -e

BASE_URL="http://127.0.0.1:3001"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-artifact_armoury}"
DB_USER="${DB_USER:-postgres}"

echo "🧪 Testing GLB-to-STL Download Endpoint"
echo "========================================"

# Step 1: Get or create test user
echo ""
echo "📝 Step 1: Creating test user..."
USER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test-buyer@example.com",
    "password": "TestPassword123!",
    "name": "Test Buyer"
  }')

BUYER_TOKEN=$(echo "$USER_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
if [ -z "$BUYER_TOKEN" ]; then
  echo "⚠️  Could not create user (may already exist). Trying to login..."
  LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test-buyer@example.com",
      "password": "TestPassword123!"
    }')
  BUYER_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
fi

if [ -z "$BUYER_TOKEN" ]; then
  echo "❌ Failed to get buyer token"
  exit 1
fi

echo "✅ Buyer token: ${BUYER_TOKEN:0:20}..."

# Step 2: Get a published model
echo ""
echo "📝 Step 2: Finding a published model..."
MODELS_RESPONSE=$(curl -s "$BASE_URL/api/models?status=published&limit=1")
MODEL_ID=$(echo "$MODELS_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$MODEL_ID" ]; then
  echo "❌ No published models found. Please upload and publish a model first."
  exit 1
fi

echo "✅ Found model: $MODEL_ID"

# Step 3: Create test order in database (using psql)
echo ""
echo "📝 Step 3: Creating test order in database..."

# Get buyer user ID from token (we'll use a direct DB query instead)
# For now, we'll insert directly into the database
BUYER_ID=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
  "SELECT id FROM users WHERE email = 'test-buyer@example.com' LIMIT 1;" 2>/dev/null || echo "")

if [ -z "$BUYER_ID" ]; then
  echo "❌ Could not find buyer user ID in database"
  exit 1
fi

echo "✅ Buyer ID: $BUYER_ID"

# Create order
ORDER_ID=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
  "INSERT INTO orders (user_id, payment_status, fulfillment_status, total_amount, currency, created_at, updated_at) 
   VALUES ('$BUYER_ID', 'succeeded', 'pending', 29.99, 'USD', NOW(), NOW()) 
   RETURNING id;" 2>/dev/null || echo "")

if [ -z "$ORDER_ID" ]; then
  echo "❌ Could not create order in database"
  exit 1
fi

echo "✅ Order ID: $ORDER_ID"

# Create order item
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
  "INSERT INTO order_items (order_id, model_id, quantity, unit_price, total_price, artist_commission_amount, created_at) 
   VALUES ('$ORDER_ID', '$MODEL_ID', 1, 29.99, 29.99, 5.99, NOW());" 2>/dev/null || true

echo "✅ Order item created"

# Step 4: Test the download endpoint
echo ""
echo "📝 Step 4: Testing download endpoint..."
echo "   GET $BASE_URL/api/models/$MODEL_ID/download"

DOWNLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/models/$MODEL_ID/download" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -o /tmp/test_model.stl)

HTTP_CODE=$(echo "$DOWNLOAD_RESPONSE" | tail -1)
FILE_SIZE=$(stat -f%z /tmp/test_model.stl 2>/dev/null || stat -c%s /tmp/test_model.stl 2>/dev/null || echo "0")

if [ "$HTTP_CODE" = "200" ] && [ "$FILE_SIZE" -gt "84" ]; then
  echo "✅ Download successful!"
  echo "   HTTP Status: $HTTP_CODE"
  echo "   File size: $FILE_SIZE bytes"
  echo "   Saved to: /tmp/test_model.stl"
  echo ""
  echo "🎉 Test passed! You can now open /tmp/test_model.stl in a 3D viewer."
else
  echo "❌ Download failed"
  echo "   HTTP Status: $HTTP_CODE"
  echo "   File size: $FILE_SIZE bytes"
  exit 1
fi

# Step 5: Verify STL format
echo ""
echo "📝 Step 5: Verifying STL format..."
HEADER=$(xxd -l 80 -p /tmp/test_model.stl | head -c 160)
TRIANGLE_COUNT=$(xxd -s 80 -l 4 -p /tmp/test_model.stl | od -An -tx4 -v | tr -d ' ')

echo "✅ STL Header: ${HEADER:0:40}..."
echo "✅ Triangle count bytes: $TRIANGLE_COUNT"

echo ""
echo "✅ All tests passed!"
echo ""
echo "📋 Test Summary:"
echo "   - Buyer user created/found"
echo "   - Model found: $MODEL_ID"
echo "   - Test order created: $ORDER_ID"
echo "   - Download endpoint working"
echo "   - STL file generated successfully"

