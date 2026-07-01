# CloudFront Integration Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Status**: Integration Guide

---

## 📋 Overview

This guide explains how to integrate CloudFront CDN with your existing S3/Backblaze storage setup.

---

## 🏗️ Architecture

Your current setup:
```
Frontend (React) → Backend (Node.js) → S3/Backblaze B2
```

With CloudFront:
```
Frontend (React) → CloudFront CDN → S3 Origin → Backblaze B2 (optional)
```

---

## 🚀 Integration Steps

### Step 1: Update Storage Service

**File**: `artifactarmoury-planner/backend/src/services/storage.ts`

Add CloudFront URL support:

```typescript
export function getFileURL(relativePath: string): string {
  // Use CloudFront if enabled
  if (process.env.CDN_ENABLED === 'true') {
    const cdnUrl = process.env.CDN_URL || 'https://cdn.artifactarmoury.com'
    return `${cdnUrl}/${relativePath}`
  }

  // If using S3, return S3 URL
  if (STORAGE_MODE === 's3' || STORAGE_MODE === 'hybrid') {
    const s3Endpoint = process.env.S3_ENDPOINT || 'https://eu-central-003.backblazeb2.com'
    const s3Bucket = process.env.S3_BUCKET || 'artifactbuilder'
    return `${s3Endpoint}/${s3Bucket}/${relativePath}`
  }

  // Otherwise return local URL
  const baseURL = process.env.BASE_URL || 'http://localhost:3001'
  return `${baseURL}/uploads/${relativePath}`
}
```

### Step 2: Update Environment Variables

**File**: `artifactarmoury-planner/backend/.env`

```env
# CloudFront CDN Configuration
CDN_ENABLED=true
CDN_URL=https://cdn.artifactarmoury.com

# Or use CloudFront default domain
# CDN_URL=https://d123abc456.cloudfront.net

# Keep existing S3 configuration
STORAGE_MODE=s3
S3_ENDPOINT=https://eu-central-003.backblazeb2.com
S3_REGION=eu-central-003
S3_BUCKET=artifactbuilder
```

### Step 3: Update Frontend Configuration

**File**: `artifactarmoury-planner/frontend/.env`

```env
VITE_CDN_ENABLED=true
VITE_CDN_URL=https://cdn.artifactarmoury.com
```

### Step 4: Update Frontend API Client

**File**: `artifactarmoury-planner/frontend/src/api/client.ts`

```typescript
const getCDNUrl = (path: string): string => {
  if (import.meta.env.VITE_CDN_ENABLED === 'true') {
    const cdnUrl = import.meta.env.VITE_CDN_URL || 'https://cdn.artifactarmoury.com'
    return `${cdnUrl}/${path}`
  }
  return path
}

// Use in components
export const getModelUrl = (modelPath: string) => getCDNUrl(modelPath)
export const getImageUrl = (imagePath: string) => getCDNUrl(imagePath)
export const getThumbnailUrl = (thumbnailPath: string) => getCDNUrl(thumbnailPath)
```

### Step 5: Sync Files to CloudFront Origin

```bash
# Copy files from Backblaze B2 to S3 origin bucket
aws s3 sync s3://artifactbuilder s3://artifactarmoury-cdn-origin \
  --source-region eu-central-003 \
  --region us-east-1

# Or use AWS DataSync for large-scale migration
```

### Step 6: Test CloudFront

```bash
# Test with CloudFront domain
curl -I https://d123abc456.cloudfront.net/models/sample.glb

# Test with custom domain
curl -I https://cdn.artifactarmoury.com/models/sample.glb

# Check cache headers
curl -I https://cdn.artifactarmoury.com/images/sample.jpg | grep -i cache
```

---

## 🔄 Data Flow

### Upload Flow
```
1. User uploads file
2. Backend saves to S3 (Backblaze B2)
3. Backend returns file path
4. Frontend requests via CloudFront
5. CloudFront caches from S3 origin
```

### Download Flow
```
1. Frontend requests: https://cdn.artifactarmoury.com/models/file.glb
2. CloudFront checks cache
3. If cached: return from edge location
4. If not cached: fetch from S3 origin
5. Cache and return to user
```

---

## 📊 Caching Strategy

### Static Assets (CSS, JS, Images)
```
Cache-Control: max-age=31536000, public
TTL: 1 year
Compress: Yes
```

### 3D Models (GLB, STL)
```
Cache-Control: max-age=2592000, public
TTL: 30 days
Compress: Yes
Query String: Yes (for versioning)
```

### API Responses
```
Cache-Control: no-cache, no-store, must-revalidate
TTL: 0 seconds
Forward: All headers and cookies
```

---

## 🔐 Security

### HTTPS Only
- All requests redirected to HTTPS
- TLS 1.2 minimum
- Custom SSL certificate support

### Origin Access Identity (OAI)
- S3 bucket only accessible via CloudFront
- Direct S3 access blocked
- Prevents unauthorized access

### Security Headers
```
Strict-Transport-Security: max-age=31536000
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
```

---

## 📈 Performance Monitoring

### CloudWatch Metrics
```bash
# View distribution metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name BytesDownloaded \
  --dimensions Name=DistributionId,Value=XXXXX \
  --start-time 2025-10-29T00:00:00Z \
  --end-time 2025-10-30T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

### Key Metrics
- **BytesDownloaded**: Data served by CloudFront
- **BytesUploaded**: Data uploaded to origin
- **Requests**: Total requests
- **4xxErrorRate**: Client errors
- **5xxErrorRate**: Server errors
- **CacheHitRate**: Percentage of cached requests

---

## 🔄 Invalidation

### Invalidate Single File
```bash
aws cloudfront create-invalidation \
  --distribution-id XXXXX \
  --paths "/models/updated-file.glb"
```

### Invalidate Pattern
```bash
aws cloudfront create-invalidation \
  --distribution-id XXXXX \
  --paths "/models/*" "/images/*"
```

### Invalidate All
```bash
aws cloudfront create-invalidation \
  --distribution-id XXXXX \
  --paths "/*"
```

---

## 💰 Cost Optimization

### Reduce Costs
1. **Enable compression** - Reduce data transfer by 60-80%
2. **Set appropriate TTLs** - Increase cache hit rate
3. **Use Origin Shield** - Reduce origin load
4. **Consolidate requests** - Fewer requests = lower costs

### Monitor Costs
```bash
# View CloudFront costs
aws ce get-cost-and-usage \
  --time-period Start=2025-10-01,End=2025-10-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --filter file://filter.json
```

---

## 🐛 Troubleshooting

### Cache Not Working
```bash
# Check cache headers
curl -I https://cdn.artifactarmoury.com/file.glb

# Check CloudFront cache policy
aws cloudfront get-distribution-config --id XXXXX
```

### 403 Forbidden
- Check OAI configuration
- Verify S3 bucket policy
- Check origin access identity

### Slow Performance
- Check cache hit rate
- Verify compression enabled
- Check origin latency

---

## 📞 Next Steps

1. Deploy CloudFront distribution
2. Update application configuration
3. Sync files to S3 origin
4. Test with sample requests
5. Monitor performance
6. Optimize caching strategy

---

**Status**: Ready for integration  
**Last Updated**: October 29, 2025

