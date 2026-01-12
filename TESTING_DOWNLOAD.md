# Testing GLB-to-STL Download Without Real Payments

## Quick Start (3 Steps)

### Step 1: Start the Backend
```bash
cd artifactarmoury-planner/backend
npm run dev
```

### Step 2: Create Test Data
```bash
# Option A: Using Node.js script (recommended)
node test-download.js

# Option B: Using curl (manual)
# See "Manual Testing with curl" section below
```

### Step 3: Verify the Download
The script will save a test STL file to `test_model.stl` that you can open in any 3D viewer.

---

## Detailed Testing Methods

### Method 1: Automated Testing (Recommended)

**Prerequisites:**
- Backend running on `http://127.0.0.1:3001`
- At least one published model in the database

**Run the test:**
```bash
cd artifactarmoury-planner/backend
node test-download.js
```

**What it does:**
1. Creates a test buyer user (or logs in if exists)
2. Finds a published model
3. Creates a test order
4. Tests the download endpoint
5. Verifies the STL file format
6. Saves output to `test_model.stl`

**Output:**
```
🧪 Testing GLB-to-STL Download Endpoint
========================================

📝 Step 1: Creating/logging in test buyer...
✅ User created
✅ Token: eyJhbGciOiJIUzI1NiIs...

📝 Step 2: Finding a published model...
✅ Found model: 550e8400-e29b-41d4-a716-446655440000

📝 Step 3: Creating test order...
✅ Order created: 123e4567-e89b-12d3-a456-426614174000

📝 Step 4: Simulating payment...
⚠️  Note: In production, this would be done via Stripe webhook
   For testing, you can manually update the database:
   UPDATE orders SET payment_status = 'succeeded' WHERE id = '123e4567-e89b-12d3-a456-426614174000';
   Then run this script again with the model ID.

📝 Step 5: Testing download endpoint...
   GET /api/models/550e8400-e29b-41d4-a716-446655440000/download
✅ Download successful!
   HTTP Status: 200
   File size: 12345 bytes
   Saved to: /home/callum/Projects/artifactarmoury-planner/backend/test_model.stl

📝 Step 6: Verifying STL format...
✅ STL Header: "Converted from GLB..."
✅ Triangle count: 1234
✅ Expected file size: 12345 bytes
✅ Actual file size: 12345 bytes

✅ All tests passed!
```

---

### Method 2: Manual Testing with curl

**Step 1: Create a test buyer user**
```bash
curl -X POST http://127.0.0.1:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test-buyer@example.com",
    "password": "TestPassword123!",
    "name": "Test Buyer"
  }'
```

Save the `token` from the response.

**Step 2: Get a published model**
```bash
curl http://127.0.0.1:3001/api/models?status=published&limit=1
```

Save the `id` from the first model.

**Step 3: Create a test order**
```bash
curl -X POST http://127.0.0.1:3001/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "items": [
      {
        "modelId": "MODEL_ID",
        "quantity": 1,
        "color": "white",
        "material": "pla",
        "quality": "standard"
      }
    ],
    "shipping": {
      "name": "Test Buyer",
      "line1": "123 Test St",
      "city": "Test City",
      "state": "TS",
      "postalCode": "12345",
      "country": "US"
    },
    "customerEmail": "test-buyer@example.com"
  }'
```

Save the `order.id` from the response.

**Step 4: Mark order as paid (using psql)**
```bash
psql -h 127.0.0.1 -U postgres -d artifact_armoury -c \
  "UPDATE orders SET payment_status = 'succeeded' WHERE id = 'ORDER_ID';"
```

**Step 5: Download the model**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3001/api/models/MODEL_ID/download \
  -o test_model.stl
```

**Step 6: Verify the file**
```bash
# Check file size
ls -lh test_model.stl

# Open in 3D viewer (macOS)
open test_model.stl

# Open in 3D viewer (Linux)
xdg-open test_model.stl

# Or use a web viewer
# https://www.viewstl.com/
```

---

### Method 3: Using Mock Database Mode

If you're using `DB_MOCK=true`:

**Step 1: Add mock order support**

Edit `backend/src/mock/mockTables.ts` to add:
```typescript
export interface MockOrder {
  id: string
  userId: string
  paymentStatus: 'succeeded' | 'pending' | 'failed'
  items: Array<{ modelId: string; quantity: number }>
  createdAt: string
}

const mockOrdersById = new Map<string, MockOrder>()

export function addMockOrder(order: MockOrder): void {
  mockOrdersById.set(order.id, { ...order })
}

export function findMockOrder(orderId: string): MockOrder | null {
  return mockOrdersById.get(orderId) || null
}
```

**Step 2: Update the download endpoint**

Add mock database support to `backend/src/routes/models.ts`:
```typescript
if (IS_MOCK_DB) {
  // Check mock orders instead of database
  const mockOrders = require('../mock/mockTables').mockOrdersById
  // ... implement mock order checking
}
```

---

## Troubleshooting

### "You have not purchased this model"
**Solution:** The order's `payment_status` must be `'succeeded'`. Update it:
```bash
psql -h 127.0.0.1 -U postgres -d artifact_armoury -c \
  "UPDATE orders SET payment_status = 'succeeded' WHERE id = 'ORDER_ID';"
```

### "Model does not have a preview file available"
**Solution:** The model needs a GLB file. Make sure you uploaded a model and it was processed successfully.

### "Failed to convert GLB to STL"
**Solution:** Check the backend logs for detailed error messages. The GLB file may be corrupted.

### File size is 0 bytes
**Solution:** The download may have failed. Check:
1. Is the user authenticated?
2. Did the user purchase the model?
3. Is the GLB file accessible?

---

## Verifying STL Format

A valid binary STL file has:
- **Header:** 80 bytes (text description)
- **Triangle count:** 4 bytes (little-endian uint32)
- **Triangle data:** 50 bytes per triangle
  - Normal: 3 floats (12 bytes)
  - Vertex 1: 3 floats (12 bytes)
  - Vertex 2: 3 floats (12 bytes)
  - Vertex 3: 3 floats (12 bytes)
  - Attribute count: 2 bytes (always 0)

**Check with hexdump:**
```bash
# View first 100 bytes
hexdump -C test_model.stl | head -10

# Check triangle count (bytes 80-84)
xxd -s 80 -l 4 test_model.stl
```

---

## Next Steps

Once testing is complete:

1. **Test with real Stripe payments** (if needed)
2. **Test with different model types** (complex meshes, multiple materials)
3. **Test concurrent downloads** (load testing)
4. **Monitor file sizes** (ensure compression is working)
5. **Test error cases** (missing GLB, corrupted files, etc.)

