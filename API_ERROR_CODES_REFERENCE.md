# API Error Codes Reference

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Status**: ✅ COMPLETE

---

## Overview

This document provides a comprehensive reference for all error codes, HTTP status codes, and validation requirements across the Artifact Armoury API.

---

## HTTP Status Codes

| Code | Name | Usage |
|------|------|-------|
| 200 | OK | Successful request |
| 201 | Created | Resource successfully created |
| 204 | No Content | Successful request with no response body |
| 400 | Bad Request | Invalid request parameters or validation error |
| 401 | Unauthorized | Authentication required or invalid credentials |
| 402 | Payment Required | Payment processing error |
| 403 | Forbidden | Insufficient permissions or access denied |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource already exists or conflict detected |
| 413 | Payload Too Large | Request body exceeds size limit |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected server error |
| 503 | Service Unavailable | Database or external service unavailable |

---

## Error Response Format

All error responses follow this format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "error details"
  },
  "requestId": "req_1234567890_abc123",
  "timestamp": "2025-10-29T12:00:00.000Z",
  "path": "/api/endpoint"
}
```

---

## Error Codes by Category

### Authentication Errors (401)

| Code | Message | Cause |
|------|---------|-------|
| AUTHENTICATION_ERROR | Authentication required | Missing or invalid auth token |
| INVALID_CREDENTIALS | Invalid email or password | Wrong login credentials |
| TOKEN_EXPIRED | Token has expired | JWT token expired |
| INVALID_TOKEN | Invalid token | Malformed or tampered token |

### Authorization Errors (403)

| Code | Message | Cause |
|------|---------|-------|
| AUTHORIZATION_ERROR | Permission denied | User lacks required role/permissions |
| INSUFFICIENT_PERMISSIONS | Insufficient permissions | Action requires higher privilege level |
| RESOURCE_FORBIDDEN | Access denied | User cannot access this resource |

### Validation Errors (400)

| Code | Message | Cause |
|------|---------|-------|
| VALIDATION_ERROR | Request validation failed | Invalid input parameters |
| REQUIRED | Field is required | Missing required field |
| INVALID_TYPE | Must be a [type] | Wrong data type |
| TOO_SHORT | Must be at least N characters | String too short |
| TOO_LONG | Must be at most N characters | String too long |
| TOO_SMALL | Must be at least N | Number too small |
| TOO_LARGE | Must be at most N | Number too large |
| INVALID_EMAIL | Invalid email address | Malformed email |
| INVALID_UUID | Must be a valid UUID | Invalid UUID format |
| INVALID_URL | Must be a valid URL | Invalid URL format |
| INVALID_FILE_TYPE | File type not allowed | Unsupported file extension |
| FILE_TOO_LARGE | File size exceeds maximum | File exceeds size limit |
| INVALID_VALUE | Must be one of: [values] | Invalid enum value |
| INVALID_FORMAT | Has invalid format | Doesn't match required pattern |

### Not Found Errors (404)

| Code | Message | Cause |
|------|---------|-------|
| NOT_FOUND | Resource not found | Resource doesn't exist |
| ENDPOINT_NOT_FOUND | Endpoint not found | Invalid API endpoint |

### Conflict Errors (409)

| Code | Message | Cause |
|------|---------|-------|
| CONFLICT | Resource already exists | Duplicate entry |
| DUPLICATE_ENTRY | Already exists | Unique constraint violation |
| EMAIL_ALREADY_EXISTS | Email already registered | Email in use |

### Database Errors (400/500)

| Code | Message | Cause |
|------|---------|-------|
| DUPLICATE_ENTRY | Already exists | Unique constraint violation (23505) |
| FOREIGN_KEY_VIOLATION | Referenced record doesn't exist | Foreign key constraint (23503) |
| REQUIRED_FIELD_MISSING | Required field missing | Not null constraint (23502) |
| CONSTRAINT_VIOLATION | Value doesn't meet requirements | Check constraint (23514) |
| INVALID_DATA_TYPE | Invalid data type | Type mismatch (22P02) |
| DATABASE_ERROR | Database error occurred | Generic database error |
| DATABASE_UNAVAILABLE | Cannot connect to database | Connection refused |
| SERVICE_UNAVAILABLE | Database temporarily unavailable | Connection pool exhausted |

### Payment Errors (402)

| Code | Message | Cause |
|------|---------|-------|
| PAYMENT_ERROR | Payment processing failed | Stripe or payment error |
| INVALID_PAYMENT_METHOD | Invalid payment method | Unsupported payment type |
| PAYMENT_DECLINED | Payment was declined | Card declined or insufficient funds |

### Rate Limit Errors (429)

| Code | Message | Cause |
|------|---------|-------|
| RATE_LIMIT_EXCEEDED | Too many requests | Rate limit exceeded |

### Server Errors (500/503)

| Code | Message | Cause |
|------|---------|-------|
| INTERNAL_SERVER_ERROR | Unexpected error occurred | Unhandled exception |
| SERVICE_UNAVAILABLE | Service temporarily unavailable | External service down |
| INVALID_JSON | Invalid JSON in request body | Malformed JSON |

---

## Rate Limiting

### Rate Limit Headers

All responses include rate limit information:

```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 1635340800
Retry-After: 60
```

### Rate Limit Tiers

| Endpoint | Limit | Window | Notes |
|----------|-------|--------|-------|
| General API | 100 | 15 min | Per IP or user |
| Authentication | 5 | 15 min | Failed attempts only |
| Search | 60 | 1 min | Per IP or user |
| Upload | 20 | 1 hour | Per authenticated user |
| Payment | 10 | 1 hour | Per authenticated user |
| Email | 3 | 1 hour | Per authenticated user |

---

## Validation Rules by Endpoint

### POST /api/auth/register

```json
{
  "email": "string (email, required, max 255)",
  "password": "string (required, min 8, max 128)",
  "displayName": "string (required, min 2, max 255)",
  "artistName": "string (optional, min 2, max 255)",
  "inviteCode": "string (optional, min 6, max 50)"
}
```

### POST /api/auth/login

```json
{
  "email": "string (email, required)",
  "password": "string (required, min 1)"
}
```

### POST /api/models

```json
{
  "name": "string (required, min 3, max 255)",
  "description": "string (optional, max 5000)",
  "category": "string (required, min 1, max 100)",
  "tags": "array (optional, max 20 items, each max 50 chars)",
  "basePrice": "number (required, min 0.5, max 10000)",
  "license": "enum (optional, cc0|cc-by|cc-by-sa|cc-by-nd|cc-by-nc|standard-commercial|personal-use)"
}
```

### GET /api/browse

```json
{
  "category": "string (optional, max 100)",
  "tags": "string (optional, max 500)",
  "minPrice": "number (optional, min 0)",
  "maxPrice": "number (optional, min 0, max 10000)",
  "sortBy": "enum (optional, recent|trending|price_low|price_high|name)",
  "page": "number (optional, min 1)",
  "limit": "number (optional, min 1, max 100)",
  "search": "string (optional, max 500)"
}
```

### POST /api/orders

```json
{
  "items": "array (required, min 1, max 50 items)",
  "shipping": "object (required, with name, line1, city, postalCode, country)",
  "customerEmail": "string (email, optional)"
}
```

### POST /api/tables

```json
{
  "name": "string (required, min 3, max 255)",
  "description": "string (optional, max 5000)",
  "width": "number (optional, min 1, max 10000)",
  "depth": "number (optional, min 1, max 10000)",
  "isPublic": "boolean (optional)"
}
```

---

## Common Error Scenarios

### Scenario: User tries to upload file > 100MB

**Request**: POST /api/models with 150MB file

**Response**:
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "file": "File size exceeds maximum allowed size of 100MB"
  },
  "statusCode": 400
}
```

### Scenario: Rate limit exceeded

**Request**: 61st search request in 1 minute

**Response**:
```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests",
  "retryAfter": 60,
  "statusCode": 429
}
```

### Scenario: Invalid email format

**Request**: POST /api/auth/register with email="invalid"

**Response**:
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "email": "Must be a valid email"
  },
  "statusCode": 400
}
```

---

## Best Practices

1. **Always check error code** - Use `error` field, not just HTTP status
2. **Handle rate limits** - Respect `Retry-After` header
3. **Validate locally first** - Reduce unnecessary API calls
4. **Log request IDs** - Use `requestId` for debugging
5. **Implement exponential backoff** - For retries on 5xx errors
6. **Cache responses** - Reduce API calls and rate limit pressure

---

## Testing Error Handling

See `API_TESTING_GUIDE.md` for comprehensive testing procedures.

---

**Last Updated**: October 29, 2025

