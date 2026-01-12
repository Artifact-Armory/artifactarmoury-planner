# CloudFront Quick Reference

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025

---

## 🚀 Quick Start (5 Minutes)

### 1. Create S3 Origin Bucket
```bash
aws s3 mb s3://artifactarmoury-cdn-origin --region us-east-1
aws s3api put-bucket-versioning \
  --bucket artifactarmoury-cdn-origin \
  --versioning-configuration Status=Enabled
```

### 2. Deploy CloudFront Distribution
```bash
# Using CloudFormation
aws cloudformation create-stack \
  --stack-name artifactarmoury-cdn \
  --template-body file://cloudfront-distribution.yaml \
  --parameters \
    ParameterKey=OriginBucket,ParameterValue=artifactarmoury-cdn-origin \
    ParameterKey=DomainName,ParameterValue=cdn.artifactarmoury.com

# Or using Terraform
terraform init
terraform apply -var="origin_bucket=artifactarmoury-cdn-origin"
```

### 3. Get Distribution Domain
```bash
# CloudFormation
aws cloudformation describe-stacks \
  --stack-name artifactarmoury-cdn \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionDomain`].OutputValue' \
  --output text

# Terraform
terraform output distribution_domain
```

### 4. Update Environment Variables
```bash
# Backend .env
CDN_ENABLED=true
CDN_URL=https://cdn.artifactarmoury.com

# Frontend .env
VITE_CDN_ENABLED=true
VITE_CDN_URL=https://cdn.artifactarmoury.com
```

### 5. Test
```bash
curl -I https://cdn.artifactarmoury.com/models/sample.glb
```

---

## 📋 Common Commands

### View Distribution
```bash
# List distributions
aws cloudfront list-distributions

# Get distribution config
aws cloudfront get-distribution-config --id XXXXX

# Get distribution stats
aws cloudfront get-distribution --id XXXXX
```

### Invalidate Cache
```bash
# Single file
aws cloudfront create-invalidation \
  --distribution-id XXXXX \
  --paths "/models/file.glb"

# Pattern
aws cloudfront create-invalidation \
  --distribution-id XXXXX \
  --paths "/models/*" "/images/*"

# All files
aws cloudfront create-invalidation \
  --distribution-id XXXXX \
  --paths "/*"

# Check invalidation status
aws cloudfront list-invalidations --distribution-id XXXXX
```

### Monitor Performance
```bash
# Cache hit rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name CacheHitRate \
  --dimensions Name=DistributionId,Value=XXXXX \
  --start-time 2025-10-29T00:00:00Z \
  --end-time 2025-10-30T00:00:00Z \
  --period 3600 \
  --statistics Average

# Bytes downloaded
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name BytesDownloaded \
  --dimensions Name=DistributionId,Value=XXXXX \
  --start-time 2025-10-29T00:00:00Z \
  --end-time 2025-10-30T00:00:00Z \
  --period 3600 \
  --statistics Sum

# Error rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name 4xxErrorRate \
  --dimensions Name=DistributionId,Value=XXXXX \
  --start-time 2025-10-29T00:00:00Z \
  --end-time 2025-10-30T00:00:00Z \
  --period 3600 \
  --statistics Average
```

### Sync Files
```bash
# Sync from Backblaze B2 to S3 origin
aws s3 sync s3://artifactbuilder s3://artifactarmoury-cdn-origin \
  --source-region eu-central-003 \
  --region us-east-1

# Sync with delete
aws s3 sync s3://artifactbuilder s3://artifactarmoury-cdn-origin \
  --source-region eu-central-003 \
  --region us-east-1 \
  --delete

# Sync specific prefix
aws s3 sync s3://artifactbuilder/models s3://artifactarmoury-cdn-origin/models \
  --source-region eu-central-003 \
  --region us-east-1
```

---

## 🔍 Troubleshooting

### 403 Forbidden
```bash
# Check OAI
aws cloudfront get-cloud-front-origin-access-identity --id XXXXX

# Check bucket policy
aws s3api get-bucket-policy --bucket artifactarmoury-cdn-origin

# Check distribution config
aws cloudfront get-distribution-config --id XXXXX | grep OriginAccessIdentity
```

### Cache Not Working
```bash
# Check cache headers
curl -I https://cdn.artifactarmoury.com/file.glb | grep -i cache

# Check cache policy
aws cloudfront get-cache-policy --id XXXXX

# Check query string forwarding
aws cloudfront get-distribution-config --id XXXXX | grep QueryString
```

### Slow Performance
```bash
# Check cache hit rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name CacheHitRate \
  --dimensions Name=DistributionId,Value=XXXXX \
  --period 3600 \
  --statistics Average

# Check origin latency
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name OriginLatency \
  --dimensions Name=DistributionId,Value=XXXXX \
  --period 3600 \
  --statistics Average
```

---

## 💰 Cost Estimation

| Scenario | Monthly Cost |
|----------|------------|
| 10GB/month | $0.85 |
| 50GB/month | $4.25 |
| 100GB/month | $8.50 |
| 500GB/month | $42.50 |
| 1TB/month | $85.00 |

*Includes data transfer, requests, and Origin Shield*

---

## 📊 Metrics Reference

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Cache Hit Rate | > 80% | 60-80% | < 60% |
| 4xx Error Rate | < 1% | 1-5% | > 5% |
| 5xx Error Rate | < 0.1% | 0.1-1% | > 1% |
| Origin Latency | < 100ms | 100-200ms | > 200ms |

---

## 🔗 Useful Links

- [AWS CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [CloudFront Best Practices](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/best-practices-content-delivery.html)
- [CloudFront Troubleshooting](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/troubleshooting-content-delivery.html)

---

## 📞 Support

For detailed guides, see:
- `CLOUDFRONT_SETUP_GUIDE.md` - Complete setup
- `CLOUDFRONT_INTEGRATION_GUIDE.md` - Integration steps
- `CLOUDFRONT_MONITORING_GUIDE.md` - Monitoring & optimization

---

**Last Updated**: October 29, 2025

