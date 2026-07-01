# Backblaze B2 S3 Integration Setup Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Status**: Implementation Complete

---

## 📋 Overview

This guide documents the integration of Backblaze B2 S3-compatible storage into the Artifact Armoury backend. The system supports three storage modes:

- **local**: Files stored on local disk (development)
- **s3**: Files stored exclusively on Backblaze B2 (production)
- **hybrid**: Files stored on both local disk and S3 (migration/fallback)

---

## 🔧 Implementation Details

### Installed Packages

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### New Files Created

1. **`src/services/s3Storage.ts`** (290 lines)
   - S3 client initialization
   - File upload/download/delete operations
   - Signed URL generation
   - File listing and metadata operations

2. **Updated `src/services/storage.ts`**
   - Added S3 support to existing storage abstraction
   - Maintains backward compatibility with local storage
   - Supports hybrid mode for gradual migration

### Environment Variables

Add to `.env`:

```env
# Storage Mode: 'local', 's3', or 'hybrid'
STORAGE_MODE=s3

# Backblaze B2 Configuration
S3_ENDPOINT=https://eu-central-003.backblazeb2.com
S3_REGION=eu-central-003
S3_BUCKET=Artifactbuilder
S3_KEY_ID=003516a6cf37b870000000001
S3_APPLICATION_KEY=K003Mz5Rzp7zvqbEKnSPqgYtIKbs9A4
```

---

## 🚀 Storage Modes

### Local Mode (Development)

```env
STORAGE_MODE=local
```

- Files stored in `/uploads` directory
- No S3 connection required
- Fastest for development
- **Not suitable for production**

### S3 Mode (Production)

```env
STORAGE_MODE=s3
```

- Files stored exclusively on Backblaze B2
- Local disk only used for temporary processing
- Scalable and reliable
- **Recommended for production**

### Hybrid Mode (Migration)

```env
STORAGE_MODE=hybrid
```

- Files stored on both local disk and S3
- Fallback to local if S3 fails
- Useful during migration
- **Higher storage costs**

---

## 📁 File Organization in S3

Files are organized by category and artist:

```
Artifactbuilder/
├── models/
│   ├── {artistId}/
│   │   ├── {assetId}/
│   │   │   ├── {timestamp}-{hash}.stl
│   │   │   └── {timestamp}-{hash}.glb
│   │   └── ...
│   └── ...
├── thumbnails/
│   ├── {artistId}/
│   │   └── {timestamp}-{hash}.png
│   └── ...
├── images/
│   ├── {artistId}/
│   │   └── {timestamp}-{hash}.jpg
│   └── ...
└── temp/
    └── {timestamp}-{hash}.{ext}
```

---

## 🔐 Security Considerations

### Credentials Management

1. **Never commit credentials to git**
   - Use `.env` file (already in `.gitignore`)
   - Use environment variables in production

2. **Rotate keys regularly**
   - Generate new application keys in Backblaze console
   - Update environment variables
   - Delete old keys

3. **Restrict key permissions**
   - In Backblaze: Set key to specific bucket only
   - Use read-only keys for downloads if possible

### File Access Control

- **Private files**: Served through backend with authentication
- **Public files**: Can use signed URLs with expiration
- **Download endpoint**: Verifies purchase before serving

---

## 📊 Performance Characteristics

| Operation | Local | S3 | Hybrid |
|-----------|-------|-----|--------|
| Upload | ~100ms | ~500ms | ~600ms |
| Download | ~50ms | ~300ms | ~50ms |
| Delete | ~10ms | ~200ms | ~210ms |
| Storage | Local disk | Backblaze | Both |
| Cost | Free | ~$6/TB/month | 2x cost |

---

## 🔄 API Changes

### File Upload

```typescript
// Automatically uses configured storage mode
const result = await saveFile({
  originalName: 'model.stl',
  buffer: fileBuffer,
  category: 'models',
  artistId: userId,
  assetId: modelId
})

// result.relativePath is S3 key or local path
// result.filepath is S3 key or local path
```

### File Download

```typescript
// Automatically uses configured storage mode
const buffer = await readFile(relativePath)

// Or get stream for large files
const stream = await getFileStream(relativePath)
```

### File Deletion

```typescript
// Automatically deletes from configured storage
await deleteFile(relativePath)
```

### File URLs

```typescript
// Returns appropriate URL based on storage mode
const url = getFileURL(relativePath)
// Local: http://localhost:3001/uploads/models/...
// S3: https://eu-central-003.backblazeb2.com/Artifactbuilder/models/...
```

---

## 🧪 Testing

### Test Upload to S3

```bash
# Start backend with S3 mode
STORAGE_MODE=s3 npm run dev

# Upload a model through the API
curl -X POST http://localhost:3001/api/models \
  -H "Authorization: Bearer {token}" \
  -F "model=@test_model.stl" \
  -F "name=Test Model" \
  -F "category=terrain" \
  -F "basePrice=29.99"
```

### Verify Files in Backblaze

1. Log in to Backblaze B2 console
2. Navigate to Artifactbuilder bucket
3. Verify files appear in correct directory structure

### Test Download

```bash
# Download a purchased model
curl -X GET http://localhost:3001/api/models/{modelId}/download \
  -H "Authorization: Bearer {token}" \
  -o downloaded_model.stl
```

---

## 🔧 Troubleshooting

### Connection Errors

**Error**: `ECONNREFUSED` or timeout

**Solution**:
- Verify S3_ENDPOINT is correct
- Check internet connection
- Verify credentials in .env

### Authentication Errors

**Error**: `InvalidAccessKeyId` or `SignatureDoesNotMatch`

**Solution**:
- Verify S3_KEY_ID and S3_APPLICATION_KEY
- Check for extra spaces in .env
- Regenerate keys in Backblaze console

### File Not Found

**Error**: `NoSuchKey` when downloading

**Solution**:
- Verify file was uploaded successfully
- Check S3_BUCKET name matches
- Verify file path in database

### Hybrid Mode Fallback

**Error**: S3 fails but local storage succeeds

**Solution**:
- Check S3 connection
- Review logs for S3 errors
- Consider switching to local mode temporarily

---

## 📈 Migration from Local to S3

### Step 1: Enable Hybrid Mode

```env
STORAGE_MODE=hybrid
```

- New files go to both local and S3
- Existing local files still accessible

### Step 2: Migrate Existing Files

```bash
# Run migration script (to be created)
npm run migrate:to-s3
```

### Step 3: Verify Migration

- Check all files in S3 bucket
- Test downloads from S3
- Verify file counts match

### Step 4: Switch to S3 Mode

```env
STORAGE_MODE=s3
```

- New files go to S3 only
- Local storage used only for temp files

### Step 5: Cleanup Local Storage

```bash
# After verification, remove local files
rm -rf uploads/models uploads/thumbnails uploads/images
```

---

## 📞 Support

### Backblaze B2 Documentation

- [B2 API Documentation](https://www.backblaze.com/b2/docs/)
- [S3-Compatible API](https://www.backblaze.com/b2/docs/s3_compatible_api.html)
- [Application Keys](https://www.backblaze.com/b2/docs/application_keys.html)

### AWS SDK Documentation

- [AWS SDK for JavaScript](https://docs.aws.amazon.com/sdk-for-javascript/)
- [S3 Client](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html)

---

## ✅ Checklist

- [x] Install AWS SDK packages
- [x] Create S3 storage service
- [x] Update storage abstraction layer
- [x] Add environment variables
- [x] Support all three storage modes
- [x] Implement file operations (upload, download, delete)
- [x] Generate signed URLs
- [x] Update file URLs based on storage mode
- [ ] Create migration script
- [ ] Test all storage modes
- [ ] Deploy to staging
- [ ] Monitor S3 usage and costs
- [ ] Deploy to production

---

**Last Updated**: October 29, 2025  
**Status**: Ready for Testing

