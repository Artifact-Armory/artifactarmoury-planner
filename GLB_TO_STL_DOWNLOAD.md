# GLB to STL Conversion for Customer Downloads

## Problem
When customers purchase a model, they need to download it as an STL file for 3D printing. However, we're now only storing the GLB file (not the original STL) to save disk space. We need to convert the GLB back to STL format on-the-fly when customers download.

## Solution
Implemented a complete GLB-to-STL conversion pipeline with a new download endpoint.

### Changes Made

#### 1. **`backend/src/services/fileProcessor.ts`**
Added `convertGLBtoSTL()` function that:
- Loads GLB file using glTF-Transform's NodeIO
- Extracts mesh geometry (vertices, normals, indices)
- Reconstructs triangles from indexed geometry
- Calculates face normals using cross product
- Writes binary STL format with proper header and triangle data
- Handles both indexed and non-indexed geometry

**Key Features:**
- Preserves mesh geometry and normals
- Handles multiple meshes in a single GLB
- Generates proper binary STL format (80-byte header + triangle count + triangle data)
- Includes error logging for debugging

#### 2. **`backend/src/routes/models.ts`**
Added new `GET /:id/download` endpoint that:
- Requires authentication
- Verifies user has purchased the model (checks orders table)
- Validates model has GLB file available
- Converts GLB to STL on-the-fly
- Streams STL file to user with proper headers
- Cleans up temporary files after download
- Increments download_count in database

**Security:**
- Only authenticated users can download
- Only users who purchased the model can download
- Checks payment_status = 'succeeded'

**Performance:**
- Temporary STL files stored in `uploads/temp/`
- Cleaned up immediately after download
- No permanent storage of converted files

### How It Works

1. **Customer purchases model** → Order created with payment_status = 'succeeded'
2. **Customer clicks download** → Frontend calls `GET /api/models/:id/download`
3. **Backend verifies purchase** → Checks orders table
4. **GLB to STL conversion** → Extracts geometry and writes binary STL
5. **File streamed to user** → Browser downloads as `.stl` file
6. **Temp file cleaned up** → Temporary STL deleted from server
7. **Download count incremented** → Stats updated in database

### File Format Details

**Binary STL Structure:**
```
[0-79]     : Header (80 bytes) - "Converted from GLB by Artifact Armoury"
[80-83]    : Triangle count (4 bytes, little-endian uint32)
[84+]      : Triangle data (50 bytes per triangle)
             - Normal vector (3 floats, 12 bytes)
             - Vertex 1 (3 floats, 12 bytes)
             - Vertex 2 (3 floats, 12 bytes)
             - Vertex 3 (3 floats, 12 bytes)
             - Attribute byte count (2 bytes, always 0)
```

### Testing

To test the download endpoint:

1. **Create a test order** with payment_status = 'succeeded'
2. **Call the endpoint:**
   ```bash
   curl -H "Authorization: Bearer <token>" \
     http://localhost:3001/api/models/<model-id>/download \
     -o model.stl
   ```
3. **Verify the STL file** opens in a 3D viewer (Fusion 360, Cura, etc.)

### Benefits

✅ **Disk Space Savings** - Only store GLB (50% reduction vs STL+GLB)
✅ **On-Demand Conversion** - Convert only when needed
✅ **No Permanent Temp Files** - Cleaned up immediately
✅ **Secure Downloads** - Verified purchase required
✅ **Proper Format** - Binary STL compatible with all slicers
✅ **Geometry Preserved** - Normals and mesh structure maintained

### Build Status
✅ TypeScript compilation successful
✅ No type errors
✅ Ready to test

---

## Testing Without Real Payments

### Quick Start (Recommended)

**Option 1: Automated Test Script**
```bash
cd artifactarmoury-planner/backend
node test-download.js
```

This will:
1. Create a test buyer user
2. Find a published model
3. Create a test order
4. Test the download endpoint
5. Save the STL file to `test_model.stl`

**Option 2: Manual SQL Setup**
```bash
# Create test data in database
psql -h 127.0.0.1 -U postgres -d artifact_armoury -f setup-test-order.sql

# Then test with curl
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3001/api/models/MODEL_ID/download \
  -o test_model.stl
```

### Key Points for Testing

1. **No Stripe needed** - Test orders are created directly in the database
2. **Payment status** - Must be set to `'succeeded'` for download to work
3. **User verification** - Only authenticated users who purchased can download
4. **File cleanup** - Temporary STL files are automatically deleted after download

See `TESTING_DOWNLOAD.md` for detailed testing instructions.

