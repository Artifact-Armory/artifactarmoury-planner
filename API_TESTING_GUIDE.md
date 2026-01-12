# API Testing Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Status**: ✅ COMPLETE

---

## Overview

This guide provides comprehensive testing procedures for error handling, request validation, and rate limiting across all API endpoints.

---

## Testing Error Handling

### 1. Test 404 Not Found

```bash
# Test non-existent endpoint
curl -X GET http://localhost:3001/api/nonexistent

# Expected Response (404):
{
  "error": "ENDPOINT_NOT_FOUND",
  "message": "Endpoint not found",
  "code": "NOT_FOUND",
  "requestId": "req_...",
  "timestamp": "2025-10-29T12:00:00.000Z",
  "path": "/api/nonexistent"
}
```

### 2. Test 500 Server Error

```bash
# Test with invalid database query (if applicable)
curl -X GET http://localhost:3001/api/models/invalid-uuid

# Expected Response (400 or 404):
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "id": "Must be a valid UUID"
  }
}
```

### 3. Test Error Logging

```bash
# Check server logs for error details
tail -f logs/error.log

# Should see:
# [ERROR] Client error {
#   requestId: "req_...",
#   statusCode: 400,
#   errorCode: "VALIDATION_ERROR",
#   message: "...",
#   path: "/api/...",
#   userId: "...",
#   ip: "127.0.0.1"
# }
```

---

## Testing Request Validation

### 1. Test Required Field Validation

```bash
# Missing required field
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123"
  }'

# Expected Response (400):
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "displayName": "displayName is required"
  }
}
```

### 2. Test Type Validation

```bash
# Wrong data type
curl -X POST http://localhost:3001/api/models \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "name": "Test Model",
    "category": "terrain",
    "basePrice": "not-a-number"
  }'

# Expected Response (400):
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "basePrice": "basePrice must be a number"
  }
}
```

### 3. Test Length Validation

```bash
# String too short
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Pass1",
    "displayName": "A",
    "inviteCode": "ABC"
  }'

# Expected Response (400):
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "password": "password must be at least 8 characters",
    "displayName": "displayName must be at least 2 characters",
    "inviteCode": "inviteCode must be at least 6 characters"
  }
}
```

### 4. Test Email Validation

```bash
# Invalid email format
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "invalid-email",
    "password": "Password123",
    "displayName": "Test User",
    "inviteCode": "INVITE123"
  }'

# Expected Response (400):
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "email": "email must be a valid email"
  }
}
```

### 5. Test Enum Validation

```bash
# Invalid enum value
curl -X GET "http://localhost:3001/api/browse?sortBy=invalid_sort"

# Expected Response (400):
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "sortBy": "sortBy must be one of: recent, trending, price_low, price_high, name"
  }
}
```

### 6. Test Array Validation

```bash
# Array with too many items
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "items": [{"modelId": "...", "quantity": 1}, ...],
    "shipping": {...}
  }'

# Expected Response (400):
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "items": "items must have at most 50 items"
  }
}
```

---

## Testing Rate Limiting

### 1. Test General Rate Limit (100 req/15min)

```bash
# Make 101 requests in quick succession
for i in {1..101}; do
  curl -X GET http://localhost:3001/api/browse
done

# Request 101 should return (429):
{
  "error": "Too many requests",
  "message": "You have exceeded the rate limit. Please try again later.",
  "retryAfter": 900
}
```

### 2. Test Auth Rate Limit (5 failed/15min)

```bash
# Make 6 failed login attempts
for i in {1..6}; do
  curl -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "password": "wrong-password"
    }'
done

# Request 6 should return (429):
{
  "error": "Too many requests",
  "message": "You have exceeded the rate limit. Please try again later.",
  "retryAfter": 900
}
```

### 3. Test Search Rate Limit (60 req/min)

```bash
# Make 61 search requests in 1 minute
for i in {1..61}; do
  curl -X GET "http://localhost:3001/api/browse?search=test"
  sleep 1
done

# Request 61 should return (429)
```

### 4. Test Upload Rate Limit (20/hour)

```bash
# Make 21 upload requests
for i in {1..21}; do
  curl -X POST http://localhost:3001/api/models \
    -H "Authorization: Bearer TOKEN" \
    -F "model=@model.stl" \
    -F "thumbnail=@thumb.png"
done

# Request 21 should return (429)
```

### 5. Check Rate Limit Headers

```bash
curl -i http://localhost:3001/api/browse

# Response headers should include:
# RateLimit-Limit: 100
# RateLimit-Remaining: 99
# RateLimit-Reset: 1635340800
```

---

## Testing Authentication Errors

### 1. Test Missing Auth Token

```bash
curl -X POST http://localhost:3001/api/models \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}'

# Expected Response (401):
{
  "error": "AUTHENTICATION_ERROR",
  "message": "Authentication required",
  "code": "AUTHENTICATION_ERROR"
}
```

### 2. Test Invalid Token

```bash
curl -X POST http://localhost:3001/api/models \
  -H "Authorization: Bearer invalid-token" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}'

# Expected Response (401):
{
  "error": "AUTHENTICATION_ERROR",
  "message": "Invalid token"
}
```

---

## Testing Authorization Errors

### 1. Test Insufficient Permissions

```bash
# Regular user trying to access admin endpoint
curl -X GET http://localhost:3001/api/admin/users \
  -H "Authorization: Bearer USER_TOKEN"

# Expected Response (403):
{
  "error": "AUTHORIZATION_ERROR",
  "message": "Permission denied",
  "code": "AUTHORIZATION_ERROR"
}
```

---

## Automated Testing with Postman

### 1. Create Collection

```
1. Create new collection: "Artifact Armoury API Tests"
2. Add environment variables:
   - base_url: http://localhost:3001
   - auth_token: (set after login)
   - user_id: (set after registration)
```

### 2. Create Test Scripts

```javascript
// Test: Validate error response format
pm.test("Error response has required fields", function() {
  var jsonData = pm.response.json();
  pm.expect(jsonData).to.have.property("error");
  pm.expect(jsonData).to.have.property("message");
  pm.expect(jsonData).to.have.property("requestId");
  pm.expect(jsonData).to.have.property("timestamp");
});

// Test: Validate rate limit headers
pm.test("Rate limit headers present", function() {
  pm.expect(pm.response.headers.get("RateLimit-Limit")).to.exist;
  pm.expect(pm.response.headers.get("RateLimit-Remaining")).to.exist;
});
```

---

## Continuous Integration Testing

### 1. Create Test Script

```bash
#!/bin/bash
# tests/api-validation.sh

echo "Testing error handling..."
curl -f http://localhost:3001/api/nonexistent || echo "✓ 404 handling works"

echo "Testing validation..."
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{}' | grep -q "VALIDATION_ERROR" && echo "✓ Validation works"

echo "Testing rate limiting..."
for i in {1..101}; do
  curl -s http://localhost:3001/api/browse > /dev/null
done
curl http://localhost:3001/api/browse | grep -q "RATE_LIMIT_EXCEEDED" && echo "✓ Rate limiting works"
```

### 2. Run in CI/CD

```yaml
# .github/workflows/api-tests.yml
name: API Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install
      - run: npm run dev &
      - run: sleep 5
      - run: bash tests/api-validation.sh
```

---

## Monitoring in Production

### 1. Check Error Logs

```bash
# View recent errors
tail -100 logs/error.log | grep "ERROR"

# Count errors by type
grep "error:" logs/error.log | jq '.error' | sort | uniq -c
```

### 2. Monitor Rate Limiting

```bash
# Check rate limit hits
grep "Rate limit exceeded" logs/error.log | wc -l

# Check by endpoint
grep "Rate limit exceeded" logs/error.log | jq '.path' | sort | uniq -c
```

---

**Last Updated**: October 29, 2025

