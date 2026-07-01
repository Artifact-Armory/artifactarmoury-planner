# Model Deletion Fix - Mock Database Issue ✅

## Problem

When you deleted models from the artist dashboard and tried to re-upload them, you got:
```
"This model has already been uploaded to Artifact Armoury."
```

And the 3 models were still showing on the marketplace.

## Root Cause

The issue was that the **deletion endpoint didn't support mock database mode**. When using `DB_MOCK=true`:

1. The deletion code was trying to query the real PostgreSQL database
2. The real database had no models (they were only in mock memory)
3. The deletion failed silently
4. The mock models remained in memory
5. The watermark hash signatures were never cleared
6. Re-uploading the same model triggered the duplicate detection

## The Fix

I made three key changes:

### 1. Added Mock Model Deletion Function

**File:** `src/mock/mockModels.ts`

```typescript
export function deleteMockModel(modelId: string): boolean {
  for (const [ownerId, models] of mockModelsByUser.entries()) {
    const index = models.findIndex((model) => model.id === modelId)
    if (index !== -1) {
      const nextModels = models.filter((_, i) => i !== index)
      mockModelsByUser.set(ownerId, nextModels)
      
      // Also delete the watermark for this model
      for (const [signature, id] of mockWatermarksBySignature.entries()) {
        if (id === modelId) {
          mockWatermarksBySignature.delete(signature)
          break
        }
      }
      
      return true
    }
  }
  return false
}
```

### 2. Added Mock Watermark Storage

**File:** `src/mock/mockModels.ts`

```typescript
const mockWatermarksBySignature = new Map<string, string>() // hash_signature -> model_id

export function addMockWatermark(hashSignature: string, modelId: string): void {
  mockWatermarksBySignature.set(hashSignature, modelId)
}

export function findMockWatermark(hashSignature: string): string | undefined {
  return mockWatermarksBySignature.get(hashSignature)
}
```

### 3. Updated Deletion Endpoint to Support Mock Mode

**File:** `src/routes/models.ts`

```typescript
router.delete('/:id',
  authenticate,
  requireArtist,
  requireModelOwnership,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (IS_MOCK_DB) {
      const deleted = deleteMockModel(id);
      
      if (!deleted) {
        throw new NotFoundError('Model');
      }

      logger.info('Mock model deleted', { userId: (req as any).userId, modelId: id });

      res.json({
        message: 'Model deleted successfully',
        modelId: id
      });
      return;
    }

    // ... real database deletion code ...
  })
);
```

### 4. Updated Duplicate Detection to Support Mock Mode

**File:** `src/routes/models.ts`

```typescript
// Check for duplicates (mock or real database)
let existingModelId: string | undefined;

if (IS_MOCK_DB) {
  existingModelId = findMockWatermark(fingerprintSignature);
} else {
  const duplicateModel = await db.query(
    `SELECT model_id FROM model_watermarks WHERE hash_signature = $1`,
    [fingerprintSignature]
  );
  if (duplicateModel.rows.length > 0) {
    existingModelId = duplicateModel.rows[0].model_id;
  }
}

if (existingModelId) {
  throw new ConflictError('This model has already been uploaded to Artifact Armoury.');
}
```

### 5. Store Watermark When Creating Mock Model

**File:** `src/routes/models.ts`

```typescript
if (IS_MOCK_DB) {
  const mockId = createMockModelId();
  const mockEntry: MockModel = { /* ... */ };

  const userId = (req as any).userId as string;
  addMockModel(userId, mockEntry);
  
  // Store watermark for duplicate detection
  addMockWatermark(fingerprintSignature, mockId);

  // ... rest of code ...
}
```

## How It Works Now

### Upload Flow (Mock Mode)
1. Parse STL and calculate fingerprint signature
2. Check `mockWatermarksBySignature` for duplicates
3. If not found, create mock model
4. Store watermark in `mockWatermarksBySignature`
5. Return success

### Delete Flow (Mock Mode)
1. Find model in `mockModelsByUser`
2. Remove model from memory
3. Find and remove corresponding watermark from `mockWatermarksBySignature`
4. Return success

### Re-upload Flow (Mock Mode)
1. Parse STL and calculate fingerprint signature
2. Check `mockWatermarksBySignature` - **watermark is gone!**
3. Duplicate check passes
4. Create new mock model
5. Store new watermark
6. Return success

## Testing

1. **Delete a model** from the artist dashboard
   - Should see "Model deleted successfully"
   - Model should disappear from your models list
   - Model should disappear from marketplace

2. **Re-upload the same model**
   - Should work without "already uploaded" error
   - Model should appear in your models list
   - Model should appear on marketplace

3. **Check server logs** for:
   - `Mock model deleted` (confirms deletion)
   - `Duplicate check passed` (confirms watermark was cleared)

## Files Modified

1. `artifactarmoury-planner/backend/src/mock/mockModels.ts`
   - Added `mockWatermarksBySignature` storage
   - Added `deleteMockModel()` function
   - Added `addMockWatermark()` function
   - Added `findMockWatermark()` function

2. `artifactarmoury-planner/backend/src/routes/models.ts`
   - Updated imports to include new mock functions
   - Updated deletion endpoint to support mock mode
   - Updated duplicate detection to support mock mode
   - Updated model creation to store watermark in mock mode

## Expected Behavior After Fix

✅ Delete a model → model removed from memory and marketplace
✅ Watermark deleted → duplicate detection cleared
✅ Re-upload same model → no "already uploaded" error
✅ Model appears on marketplace again
✅ Server logs show proper deletion and duplicate check

## Build Status

✅ TypeScript compilation successful
✅ No type errors
✅ Ready for testing

## Next Steps

1. Restart the backend server
2. Delete the 3 models from the artist dashboard
3. Re-upload them
4. Verify they appear on the marketplace
5. Check server logs for confirmation messages

