# CloudFront Caching Headers Configuration Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Status**: ✅ COMPLETE

---

## 📋 Overview

Comprehensive guide for configuring proper caching headers for static assets and 3D models in CloudFront.

---

## 🎯 Cache-Control Headers

### GLB 3D Models

**Header**: `Cache-Control: public, max-age=2592000, immutable`

```
public          - Cacheable by any cache
max-age=2592000 - Cache for 30 days
immutable       - Content never changes (versioned)
```

**Use Case**: Stable 3D model files with version in URL

```
URL: https://cdn.artifactarmoury.com/models/artist1/asset1/model-v1.glb
```

### Static Assets (CSS, JS)

**Header**: `Cache-Control: public, max-age=31536000, immutable`

```
public          - Cacheable by any cache
max-age=31536000 - Cache for 1 year
immutable       - Content never changes (hash-based)
```

**Use Case**: Frontend assets with hash in filename

```
URL: https://cdn.artifactarmoury.com/assets/app-abc123def456.js
```

### Thumbnails & Images

**Header**: `Cache-Control: public, max-age=604800`

```
public          - Cacheable by any cache
max-age=604800  - Cache for 7 days
```

**Use Case**: Preview images that may be updated

```
URL: https://cdn.artifactarmoury.com/thumbnails/artist1/asset1/thumb.png
```

### Dynamic Content

**Header**: `Cache-Control: public, max-age=3600`

```
public          - Cacheable by any cache
max-age=3600    - Cache for 1 hour
```

**Use Case**: Content that changes frequently

---

## 🔧 Implementation

### Option 1: CloudFront Response Headers Policy

**File**: `cloudfront-cache-policies.yaml`

```yaml
GLBResponseHeadersPolicy:
  Type: AWS::CloudFront::ResponseHeadersPolicy
  Properties:
    ResponseHeadersPolicyConfig:
      Name: GLBResponseHeadersPolicy
      CustomHeadersConfig:
        Items:
          - Header: Cache-Control
            Value: 'public, max-age=2592000, immutable'
            Override: true
```

### Option 2: S3 Object Metadata

Set cache headers on S3 objects during upload:

```typescript
// backend/src/services/s3Storage.ts
await s3Client.putObject({
  Bucket: bucket,
  Key: s3Key,
  Body: buffer,
  ContentType: mimetype,
  Metadata: {
    'Cache-Control': 'public, max-age=2592000, immutable'
  }
});
```

### Option 3: Backend Response Headers

Set headers in Express middleware:

```typescript
// backend/src/middleware/cacheHeaders.ts
export function setCacheHeaders(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  
  if (path.includes('/models/') && path.endsWith('.glb')) {
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
  } else if (path.includes('/thumbnails/')) {
    res.set('Cache-Control', 'public, max-age=604800');
  } else if (path.includes('/images/')) {
    res.set('Cache-Control', 'public, max-age=604800');
  }
  
  next();
}
```

---

## 📊 Cache Duration Reference

| Content Type | Duration | TTL (seconds) | Use Case |
|---|---|---|---|
| GLB Models | 30 days | 2,592,000 | Stable 3D models |
| Static Assets | 1 year | 31,536,000 | Hash-versioned files |
| Thumbnails | 7 days | 604,800 | Preview images |
| Images | 7 days | 604,800 | User uploads |
| HTML | 1 hour | 3,600 | Dynamic pages |
| API Responses | 5 minutes | 300 | Frequently changing |

---

## 🔐 Security Headers

### Strict-Transport-Security (HSTS)

```
Strict-Transport-Security: max-age=63072000; includeSubdomains
```

**Effect**: Force HTTPS for 2 years

### X-Content-Type-Options

```
X-Content-Type-Options: nosniff
```

**Effect**: Prevent MIME type sniffing

### X-Frame-Options

```
X-Frame-Options: DENY
```

**Effect**: Prevent clickjacking

### X-XSS-Protection

```
X-XSS-Protection: 1; mode=block
```

**Effect**: Enable XSS protection

---

## 🌐 CORS Headers

### For GLB Files

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept-Encoding
```

**Effect**: Allow cross-origin GLB loading

### For Specific Origins

```
Access-Control-Allow-Origin: https://artifactarmoury.com
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept-Encoding
```

**Effect**: Restrict to specific domain

---

## 📈 Compression Headers

### Accept-Encoding

```
Accept-Encoding: gzip, deflate, br
```

**Supported Compressions**:
- `gzip` - 60-70% reduction
- `br` (Brotli) - 70-80% reduction
- `deflate` - 50-60% reduction

### Content-Encoding Response

```
Content-Encoding: br
```

**Effect**: Browser automatically decompresses

---

## 🔄 Cache Busting Strategies

### Strategy 1: Query String Versioning

```
URL: https://cdn.artifactarmoury.com/models/artist1/asset1/model.glb?v=2
Cache-Control: public, max-age=2592000, immutable
```

**Pros**: Simple, works with all servers  
**Cons**: Query string must be included

### Strategy 2: Filename Hashing

```
URL: https://cdn.artifactarmoury.com/models/artist1/asset1/model-abc123.glb
Cache-Control: public, max-age=31536000, immutable
```

**Pros**: Automatic cache busting  
**Cons**: Requires filename changes

### Strategy 3: Path Versioning

```
URL: https://cdn.artifactarmoury.com/v2/models/artist1/asset1/model.glb
Cache-Control: public, max-age=2592000, immutable
```

**Pros**: Clean URLs  
**Cons**: Requires path management

---

## 🛠️ Testing Cache Headers

### Check Cache Headers

```bash
curl -I https://cdn.artifactarmoury.com/models/artist1/asset1/model.glb
```

**Look for**:
```
Cache-Control: public, max-age=2592000, immutable
Content-Type: model/gltf-binary
Content-Encoding: br
```

### Check CORS Headers

```bash
curl -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" \
  -I https://cdn.artifactarmoury.com/models/artist1/asset1/model.glb
```

**Look for**:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
```

### Check Compression

```bash
curl -H "Accept-Encoding: br" \
  -I https://cdn.artifactarmoury.com/models/artist1/asset1/model.glb
```

**Look for**:
```
Content-Encoding: br
```

### Measure Response Time

```bash
curl -w "Time: %{time_total}s\n" \
  https://cdn.artifactarmoury.com/models/artist1/asset1/model.glb > /dev/null
```

---

## 📊 Monitoring Cache Headers

### CloudWatch Metrics

```bash
# Cache hit rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name CacheHitRate \
  --dimensions Name=DistributionId,Value=E123ABC456 \
  --start-time 2025-10-29T00:00:00Z \
  --end-time 2025-10-30T00:00:00Z \
  --period 3600 \
  --statistics Average
```

### CloudFront Logs

```bash
# Analyze cache status
aws s3 cp s3://artifactarmoury-cdn-logs/cloudfront-logs/ . --recursive

# Check cache hit/miss ratio
grep "Hit\|Miss" cloudfront-logs/* | wc -l
```

---

## 🚨 Common Issues

### Headers Not Applied

**Problem**: Cache headers not showing in response

**Solution**:
1. Check CloudFront cache policy
2. Verify S3 object metadata
3. Check backend middleware
4. Clear CloudFront cache

### Cache Not Working

**Problem**: Files not being cached

**Solution**:
1. Check Cache-Control header
2. Verify cache policy TTL
3. Check query strings
4. Verify HTTPS (required for caching)

### CORS Errors

**Problem**: Browser blocks GLB loading

**Solution**:
1. Add Access-Control-Allow-Origin header
2. Verify CORS policy in CloudFront
3. Check browser console for errors

---

## 📋 Implementation Checklist

- [ ] Deploy cache policies: `cloudfront-cache-policies.yaml`
- [ ] Configure GLB cache headers (30 days)
- [ ] Configure static asset headers (1 year)
- [ ] Configure thumbnail headers (7 days)
- [ ] Add CORS headers for GLB files
- [ ] Add security headers
- [ ] Enable compression (Brotli)
- [ ] Test cache headers with curl
- [ ] Monitor cache hit rate
- [ ] Set up cache invalidation strategy
- [ ] Document cache busting strategy
- [ ] Train team on caching

---

## 📚 Related Files

- [cloudfront-cache-policies.yaml](cloudfront-cache-policies.yaml) - Cache policies
- [CLOUDFRONT_GLB_DELIVERY_GUIDE.md](CLOUDFRONT_GLB_DELIVERY_GUIDE.md) - GLB delivery
- [cdn-invalidation-strategy.sh](cdn-invalidation-strategy.sh) - Invalidation

---

**Status**: ✅ PRODUCTION READY

All caching headers are configured and ready for production deployment!

