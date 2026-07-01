# CloudFront CDN Setup Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Status**: Setup Guide

---

## 📋 Overview

This guide walks you through setting up AWS CloudFront CDN for your Artifact Armoury Planner project. CloudFront will cache and serve your static assets, 3D models, and images globally with low latency.

---

## 🎯 What You'll Get

✅ **Global Content Delivery** - Serve content from 200+ edge locations worldwide  
✅ **Reduced Latency** - 50-80% faster content delivery  
✅ **Lower Bandwidth Costs** - AWS CloudFront is cheaper than direct S3 access  
✅ **DDoS Protection** - Built-in AWS Shield Standard protection  
✅ **SSL/TLS Encryption** - HTTPS by default  
✅ **Caching** - Automatic caching of static assets  

---

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                         │
│  (Frontend: React + Three.js | Backend: Node.js + Express) │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
   ┌─────────────┐         ┌──────────────┐
   │  CloudFront │         │  API Backend │
   │    CDN      │         │  (Direct)    │
   └──────┬──────┘         └──────────────┘
          │
    ┌─────┴──────────────────────────┐
    │                                │
    ▼                                ▼
┌──────────────┐            ┌──────────────────┐
│ S3 Bucket    │            │ Backblaze B2     │
│ (Origin)     │            │ (Origin)         │
└──────────────┘            └──────────────────┘
```

---

## 🚀 Quick Start (5 Steps)

### Step 1: Create S3 Bucket for CloudFront Origin

```bash
# Create bucket
aws s3 mb s3://artifactarmoury-cdn-origin --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket artifactarmoury-cdn-origin \
  --versioning-configuration Status=Enabled

# Block public access (CloudFront will handle access)
aws s3api put-public-access-block \
  --bucket artifactarmoury-cdn-origin \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### Step 2: Create CloudFront Distribution

```bash
# Use the provided CloudFormation template
aws cloudformation create-stack \
  --stack-name artifactarmoury-cdn \
  --template-body file://cloudfront-distribution.yaml \
  --parameters \
    ParameterKey=OriginBucket,ParameterValue=artifactarmoury-cdn-origin \
    ParameterKey=DomainName,ParameterValue=cdn.artifactarmoury.com
```

### Step 3: Update DNS Records

```bash
# Get CloudFront domain name
aws cloudformation describe-stacks \
  --stack-name artifactarmoury-cdn \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionDomain`].OutputValue' \
  --output text

# Add CNAME record in your DNS provider:
# cdn.artifactarmoury.com -> d123.cloudfront.net
```

### Step 4: Update Application Configuration

```env
# Backend .env
CDN_URL=https://cdn.artifactarmoury.com
CDN_ENABLED=true

# Frontend .env
VITE_CDN_URL=https://cdn.artifactarmoury.com
```

### Step 5: Update File URLs

```typescript
// In your storage service
export function getFileURL(relativePath: string): string {
  if (process.env.CDN_ENABLED === 'true') {
    const cdnUrl = process.env.CDN_URL || 'https://cdn.artifactarmoury.com'
    return `${cdnUrl}/${relativePath}`
  }
  // Fallback to S3 or local
  return getS3FileURL(relativePath)
}
```

---

## 📁 Configuration Files

### 1. CloudFormation Template
**File**: `cloudfront-distribution.yaml`
- Complete CloudFront distribution setup
- Origin configuration
- Caching policies
- Security headers
- SSL/TLS configuration

### 2. Terraform Configuration
**File**: `cloudfront-distribution.tf`
- Infrastructure as Code alternative
- Modular and reusable
- State management

### 3. Environment Configuration
**File**: `cloudfront-env.example`
- Environment variables
- Configuration options
- Deployment settings

---

## 🔐 Security Configuration

### Origin Access Identity (OAI)

```yaml
OriginAccessIdentity:
  CloudFrontOriginAccessIdentity:
    OriginAccessIdentityConfig:
      Comment: "OAI for Artifact Armoury CDN"
```

### Bucket Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity XXXXX"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::artifactarmoury-cdn-origin/*"
    }
  ]
}
```

---

## 💾 Caching Strategy

### Static Assets (Images, CSS, JS)
- **TTL**: 31536000 seconds (1 year)
- **Compress**: Yes
- **Query String**: No

### 3D Models (GLB, STL)
- **TTL**: 2592000 seconds (30 days)
- **Compress**: Yes
- **Query String**: Yes (for versioning)

### API Responses
- **TTL**: 0 seconds (no caching)
- **Forward Headers**: All
- **Forward Cookies**: All

---

## 📊 Cost Estimation

| Item | Monthly Cost |
|------|-------------|
| Data Transfer Out | $0.085/GB |
| HTTP/HTTPS Requests | $0.0075/10k |
| Invalidation Requests | $0.005/request |
| **Total (100GB/month)** | **~$8.50** |

---

## 🔄 Deployment Steps

1. **Create S3 bucket** for CloudFront origin
2. **Deploy CloudFront distribution** using CloudFormation
3. **Configure DNS** with CNAME record
4. **Update application** configuration
5. **Test CDN** with sample requests
6. **Monitor performance** using CloudWatch

---

## 📞 Next Steps

1. Read `CLOUDFRONT_INTEGRATION_GUIDE.md` for integration details
2. Review `cloudfront-distribution.yaml` for configuration
3. Set up monitoring with `CLOUDFRONT_MONITORING_GUIDE.md`
4. Test with sample requests

---

**Status**: Ready for deployment  
**Last Updated**: October 29, 2025

