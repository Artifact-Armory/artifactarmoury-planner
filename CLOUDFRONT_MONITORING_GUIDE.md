# CloudFront Monitoring & Optimization Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Status**: Monitoring Guide

---

## 📊 Key Metrics

### Performance Metrics
| Metric | Target | Tool |
|--------|--------|------|
| Cache Hit Rate | > 80% | CloudWatch |
| Time to First Byte | < 100ms | CloudFront Logs |
| Data Transfer | Minimize | Cost Explorer |
| Request Count | Monitor | CloudWatch |

### Health Metrics
| Metric | Target | Tool |
|--------|--------|------|
| 4xx Error Rate | < 1% | CloudWatch |
| 5xx Error Rate | < 0.1% | CloudWatch |
| Origin Latency | < 200ms | CloudFront Logs |
| Availability | > 99.9% | CloudWatch |

---

## 🔍 CloudWatch Monitoring

### Enable CloudFront Logging

```bash
# Create S3 bucket for logs
aws s3 mb s3://artifactarmoury-cdn-logs

# Update distribution to log to S3
aws cloudfront update-distribution \
  --id XXXXX \
  --distribution-config file://config.json
```

### View Metrics

```bash
# Get cache hit rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name CacheHitRate \
  --dimensions Name=DistributionId,Value=XXXXX \
  --start-time 2025-10-29T00:00:00Z \
  --end-time 2025-10-30T00:00:00Z \
  --period 3600 \
  --statistics Average

# Get bytes downloaded
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name BytesDownloaded \
  --dimensions Name=DistributionId,Value=XXXXX \
  --start-time 2025-10-29T00:00:00Z \
  --end-time 2025-10-30T00:00:00Z \
  --period 3600 \
  --statistics Sum

# Get error rates
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name 4xxErrorRate \
  --dimensions Name=DistributionId,Value=XXXXX \
  --start-time 2025-10-29T00:00:00Z \
  --end-time 2025-10-30T00:00:00Z \
  --period 3600 \
  --statistics Average
```

---

## 📈 CloudFront Logs Analysis

### Parse Logs

```bash
# Download logs
aws s3 sync s3://artifactarmoury-cdn-logs ./logs

# Analyze cache hit rate
grep -c "Hit" logs/* | awk -F: '{sum+=$2} END {print sum}'

# Find slow requests
awk '$5 > 1000 {print}' logs/* | head -20

# Analyze by path
awk '{print $7}' logs/* | sort | uniq -c | sort -rn | head -20
```

### Log Format
```
date time x-edge-location bytes status-code method host uri query-string user-agent
```

---

## 🚀 Performance Optimization

### 1. Increase Cache Hit Rate

**Current**: Monitor cache hit rate
```bash
# Check current rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name CacheHitRate \
  --dimensions Name=DistributionId,Value=XXXXX \
  --period 3600 \
  --statistics Average
```

**Optimization**:
- Increase TTL for static assets
- Remove query strings from cache key
- Enable compression
- Use Origin Shield

### 2. Reduce Origin Load

**Enable Origin Shield**:
```bash
# Already enabled in CloudFormation template
# Adds additional caching layer between CloudFront and origin
# Reduces origin requests by 50-80%
```

**Benefits**:
- Reduces origin bandwidth
- Improves cache hit rate
- Protects origin from traffic spikes

### 3. Optimize Compression

**Enable Compression**:
```bash
# Already enabled in CloudFormation template
# Compresses responses > 1KB
# Reduces data transfer by 60-80%
```

**Supported Types**:
- text/html
- text/css
- text/javascript
- application/json
- application/javascript
- image/svg+xml

### 4. Reduce Data Transfer

**Strategies**:
1. **Image Optimization**
   - Use WebP format
   - Resize images for device
   - Compress before upload

2. **Model Optimization**
   - Compress GLB files
   - Use LOD (Level of Detail)
   - Gzip compression

3. **Code Splitting**
   - Already implemented in Vite
   - Reduces initial bundle size
   - Improves cache efficiency

---

## 💰 Cost Optimization

### Current Costs

```
Data Transfer Out: $0.085/GB
Requests: $0.0075/10k
Invalidations: $0.005/request
```

### Reduce Costs

**1. Increase Cache Hit Rate**
- Target: 80%+ cache hit rate
- Savings: 80% reduction in origin requests

**2. Compress Content**
- Reduce data transfer by 60-80%
- Savings: $0.05-0.07/GB

**3. Use Origin Shield**
- Cost: $0.005/request
- Savings: 50-80% reduction in origin requests
- ROI: Positive for > 100GB/month

**4. Consolidate Requests**
- Combine multiple requests
- Reduce request count
- Savings: $0.0075/10k requests

### Cost Estimation

```
Scenario: 100GB/month, 1M requests

Without Optimization:
- Data Transfer: 100GB × $0.085 = $8.50
- Requests: 1M ÷ 10k × $0.0075 = $0.75
- Total: $9.25/month

With Optimization (80% cache hit):
- Data Transfer: 20GB × $0.085 = $1.70
- Requests: 200k ÷ 10k × $0.0075 = $0.15
- Origin Shield: 200k ÷ 10k × $0.005 = $0.10
- Total: $1.95/month

Savings: $7.30/month (79% reduction)
```

---

## 🔔 Alerts & Notifications

### Create CloudWatch Alarms

```bash
# High error rate alert
aws cloudwatch put-metric-alarm \
  --alarm-name cdn-high-error-rate \
  --alarm-description "Alert when 4xx error rate > 5%" \
  --metric-name 4xxErrorRate \
  --namespace AWS/CloudFront \
  --statistic Average \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2

# Low cache hit rate alert
aws cloudwatch put-metric-alarm \
  --alarm-name cdn-low-cache-hit \
  --alarm-description "Alert when cache hit rate < 70%" \
  --metric-name CacheHitRate \
  --namespace AWS/CloudFront \
  --statistic Average \
  --period 3600 \
  --threshold 70 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 1
```

---

## 📊 Dashboard Setup

### Create CloudWatch Dashboard

```bash
aws cloudwatch put-dashboard \
  --dashboard-name ArtifactArmoury-CDN \
  --dashboard-body file://dashboard.json
```

### Dashboard Widgets
- Cache Hit Rate (line chart)
- Bytes Downloaded (area chart)
- Request Count (line chart)
- Error Rates (line chart)
- Origin Latency (histogram)

---

## 🔄 Regular Maintenance

### Daily
- Monitor error rates
- Check cache hit rate
- Review CloudWatch alarms

### Weekly
- Analyze CloudFront logs
- Review performance metrics
- Check cost trends

### Monthly
- Optimize cache policies
- Review invalidation patterns
- Analyze traffic patterns
- Update documentation

---

## 🐛 Troubleshooting

### Low Cache Hit Rate
```bash
# Check cache policy
aws cloudfront get-cache-policy --id XXXXX

# Check query string forwarding
aws cloudfront get-distribution-config --id XXXXX | grep QueryString

# Solution: Remove unnecessary query strings
```

### High Origin Load
```bash
# Check Origin Shield status
aws cloudfront get-distribution-config --id XXXXX | grep OriginShield

# Solution: Enable Origin Shield if not already enabled
```

### High Error Rate
```bash
# Check origin health
aws cloudfront get-distribution-config --id XXXXX

# Check origin logs
aws s3 ls s3://artifactarmoury-cdn-logs/

# Solution: Check origin server logs
```

---

## 📞 Next Steps

1. Enable CloudFront logging
2. Set up CloudWatch dashboard
3. Create alarms for key metrics
4. Analyze logs weekly
5. Optimize based on metrics
6. Review costs monthly

---

**Status**: Ready for monitoring  
**Last Updated**: October 29, 2025

