# Backblaze B2 S3 Integration - Quick Start Guide

**Get up and running with S3 storage in 5 minutes!**

---

## ⚡ Quick Setup

### 1. Verify Installation

```bash
cd artifactarmoury-planner/backend

# Check packages installed
npm list @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Expected output:
```
├── @aws-sdk/client-s3@3.x.x
└── @aws-sdk/s3-request-presigner@3.x.x
```

### 2. Verify Environment Variables

Check `.env` file contains:

```env
STORAGE_MODE=s3
S3_ENDPOINT=https://eu-central-003.backblazeb2.com
S3_REGION=eu-central-003
S3_BUCKET=Artifactbuilder
S3_KEY_ID=003516a6cf37b870000000001
S3_APPLICATION_KEY=K003Mz5Rzp7zvqbEKnSPqgYtIKbs9A4
```

### 3. Build Project

```bash
npm run build
```

Should complete with no errors.

### 4. Start Backend

```bash
# Development mode
npm run dev

# Or production mode
npm start
```

### 5. Test S3 Connection

```bash
# In another terminal
node test-s3-integration.js
```

---

## 🔄 Storage Modes

### Development (Local)
```env
STORAGE_MODE=local
```
- Files stored on disk
- No S3 connection needed
- Fastest for development

### Production (S3)
```env
STORAGE_MODE=s3
```
- Files stored on Backblaze B2
- Scalable and reliable
- Recommended for production

### Migration (Hybrid)
```env
STORAGE_MODE=hybrid
```
- Files stored on both disk and S3
- Fallback if S3 fails
- Use during migration

---

## 📤 Upload a File

### Via API

```bash
# Get auth token first
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"artist@example.com","password":"password"}' \
  | jq -r '.accessToken')

# Upload model
curl -X POST http://localhost:3001/api/models \
  -H "Authorization: Bearer $TOKEN" \
  -F "model=@path/to/model.stl" \
  -F "name=My Model" \
  -F "category=terrain" \
  -F "basePrice=29.99"
```

### Verify in Backblaze

1. Log in to [Backblaze B2 Console](https://secure.backblaze.com/)
2. Go to **Buckets** → **Artifactbuilder**
3. Look for files in `models/` directory

---

## 📥 Download a File

### Via API

```bash
# Download purchased model
curl -X GET http://localhost:3001/api/models/{modelId}/download \
  -H "Authorization: Bearer $TOKEN" \
  -o downloaded_model.stl
```

### Verify File

```bash
# Check file size and format
ls -lh downloaded_model.stl
file downloaded_model.stl
```

---

## 🗑️ Delete a File

### Via API

```bash
# Delete model (artist only)
curl -X DELETE http://localhost:3001/api/models/{modelId} \
  -H "Authorization: Bearer $TOKEN"
```

### Verify Deletion

Check Backblaze B2 console - file should be gone.

---

## 🔍 Monitor S3 Usage

### Backblaze B2 Console

1. Log in to [Backblaze B2 Console](https://secure.backblaze.com/)
2. Go to **Buckets** → **Artifactbuilder**
3. View:
   - Total files
   - Total storage used
   - Recent uploads/downloads

### Backend Logs

```bash
# Watch logs for S3 operations
npm run dev 2>&1 | grep -i s3
```

---

## 🐛 Common Issues

### Issue: "Cannot find module '@aws-sdk/client-s3'"

**Solution**:
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm run build
```

### Issue: "ENOTFOUND eu-central-003.backblazeb2.com"

**Solution**:
- Check internet connection
- Verify firewall allows HTTPS
- Test: `curl https://eu-central-003.backblazeb2.com`

### Issue: "InvalidAccessKeyId"

**Solution**:
- Verify S3_KEY_ID in .env
- Verify S3_APPLICATION_KEY in .env
- Check for extra spaces
- Regenerate keys in Backblaze console

### Issue: "NoSuchBucket"

**Solution**:
- Verify S3_BUCKET name: `Artifactbuilder`
- Check bucket exists in Backblaze console
- Verify key has bucket access

---

## 📊 File Organization

Files are automatically organized in S3:

```
Artifactbuilder/
├── models/
│   ├── {artistId}/
│   │   ├── {assetId}/
│   │   │   ├── 1729710976452-abc123.stl
│   │   │   └── 1729710976453-def456.glb
│   │   └── ...
│   └── ...
├── thumbnails/
│   ├── {artistId}/
│   │   └── 1729710976454-ghi789.png
│   └── ...
├── images/
│   ├── {artistId}/
│   │   └── 1729710976455-jkl012.jpg
│   └── ...
└── temp/
    └── temp-1729710976456-mno345.stl
```

---

## 🔐 Security Tips

✅ **Do**:
- Keep `.env` file secure (never commit to git)
- Rotate keys quarterly
- Use read-only keys for downloads
- Monitor access logs

❌ **Don't**:
- Share credentials
- Commit `.env` to git
- Use same key for multiple services
- Leave old keys active

---

## 📈 Performance Tips

### Optimize Upload
- Compress files before upload
- Use multipart upload for large files
- Upload during off-peak hours

### Optimize Download
- Use signed URLs for direct downloads
- Enable CDN caching
- Compress responses with Brotli

### Optimize Storage
- Delete old versions
- Archive rarely-used files
- Use lifecycle policies

---

## 🚀 Next Steps

1. **Test**: Run `node test-s3-integration.js`
2. **Upload**: Upload a test model
3. **Download**: Download and verify
4. **Monitor**: Check Backblaze console
5. **Deploy**: Move to production

---

## 📞 Support

### Documentation
- [Backblaze B2 Docs](https://www.backblaze.com/b2/docs/)
- [AWS SDK Docs](https://docs.aws.amazon.com/sdk-for-javascript/)
- [S3 API Reference](https://www.backblaze.com/b2/docs/s3_compatible_api.html)

### Troubleshooting
- Check logs: `npm run dev 2>&1 | grep -i error`
- Test connectivity: `curl https://eu-central-003.backblazeb2.com`
- Verify credentials: Check `.env` file

---

## ✅ Checklist

- [ ] Packages installed
- [ ] Environment variables set
- [ ] Project builds successfully
- [ ] Backend starts without errors
- [ ] S3 test script passes
- [ ] Can upload files
- [ ] Can download files
- [ ] Can delete files
- [ ] Files appear in Backblaze console
- [ ] Ready for production

---

**Status**: ✅ Ready to Use  
**Last Updated**: October 29, 2025

