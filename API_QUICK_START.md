# API Error Handling & Validation - Quick Start Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025

---

## 🚀 Quick Start (5 minutes)

### 1. Apply Validation to a Route

```typescript
import { validate } from '../middleware/requestValidator';
import { createModelSchema } from '../schemas/validationSchemas';
import { asyncHandler } from '../middleware/error';

router.post('/',
  authenticate,
  validate(createModelSchema),  // ← Add this line
  asyncHandler(async (req, res) => {
    // Your route handler
    res.json({ success: true });
  })
);
```

### 2. Test It

```bash
# Invalid request (missing required field)
curl -X POST http://localhost:3001/api/models \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}'

# Response (400):
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "category": "category is required",
    "basePrice": "basePrice is required"
  }
}
```

---

## 📋 Available Validation Schemas

```typescript
// Authentication
registerSchema              // POST /api/auth/register
loginSchema                 // POST /api/auth/login
passwordResetSchema         // POST /api/auth/password-reset
passwordUpdateSchema        // POST /api/auth/password-update

// Models
createModelSchema           // POST /api/models
updateModelSchema           // PUT /api/models/:id

// Browse
browseModelsSchema          // GET /api/browse

// Orders
createOrderSchema           // POST /api/orders

// Tables
createTableSchema           // POST /api/tables

// Admin
flagModelSchema             // POST /api/admin/flag/:id
```

---

## 🔧 Create Custom Validation Schema

```typescript
import { ValidationSchema } from '../middleware/requestValidator';

export const myCustomSchema: ValidationSchema = {
  body: {
    email: {
      type: 'email',
      required: true
    },
    age: {
      type: 'number',
      required: true,
      min: 18,
      max: 120
    },
    tags: {
      type: 'array',
      required: false,
      maxLength: 10,
      items: {
        type: 'string',
        maxLength: 50
      }
    }
  },
  query: {
    page: {
      type: 'number',
      required: false,
      min: 1
    }
  },
  params: {
    id: {
      type: 'uuid',
      required: true
    }
  }
};
```

---

## 📊 Validation Types & Rules

### String
```typescript
{
  type: 'string',
  required: true,           // Required field
  minLength: 3,             // Minimum length
  maxLength: 100,           // Maximum length
  pattern: /^[a-z]+$/       // Regex pattern
}
```

### Number
```typescript
{
  type: 'number',
  required: true,
  min: 0,                   // Minimum value
  max: 1000                 // Maximum value
}
```

### Array
```typescript
{
  type: 'array',
  required: true,
  minLength: 1,             // Minimum items
  maxLength: 50,            // Maximum items
  items: {                  // Item validation
    type: 'string',
    maxLength: 100
  }
}
```

### Email
```typescript
{
  type: 'email',
  required: true
}
```

### UUID
```typescript
{
  type: 'uuid',
  required: true
}
```

### URL
```typescript
{
  type: 'url',
  required: true
}
```

### Enum
```typescript
{
  type: 'string',
  required: true,
  enum: ['option1', 'option2', 'option3']
}
```

### Custom Validation
```typescript
{
  type: 'string',
  required: true,
  custom: (value) => {
    if (value.includes('badword')) {
      return 'Contains inappropriate content';
    }
    return true;
  }
}
```

---

## ⚠️ Error Response Format

All validation errors return 400 with this format:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "fieldName": "error message",
    "anotherField": "another error"
  },
  "requestId": "req_1635340800000_abc123",
  "timestamp": "2025-10-29T12:00:00.000Z",
  "path": "/api/endpoint"
}
```

---

## 🔐 Rate Limiting

All public endpoints have rate limiting:

| Endpoint | Limit | Window |
|----------|-------|--------|
| General API | 100 | 15 min |
| Auth (failed) | 5 | 15 min |
| Search | 60 | 1 min |
| Upload | 20 | 1 hour |
| Payment | 10 | 1 hour |
| Email | 3 | 1 hour |

Rate limit exceeded returns 429:

```json
{
  "error": "Too many requests",
  "message": "You have exceeded the rate limit. Please try again later.",
  "retryAfter": 900
}
```

---

## 🛡️ Error Classes

Use these in your route handlers:

```typescript
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  PaymentError,
  RateLimitError,
  ServiceUnavailableError
} from '../middleware/error';

// Example usage
if (!user) {
  throw new NotFoundError('User not found');
}

if (!hasPermission) {
  throw new AuthorizationError('Permission denied');
}

if (emailExists) {
  throw new ConflictError('Email already registered');
}
```

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `API_ERROR_CODES_REFERENCE.md` | All error codes and HTTP status codes |
| `API_TESTING_GUIDE.md` | How to test error handling and validation |
| `API_IMPLEMENTATION_COMPLETE.md` | Full implementation details |
| `API_QUICK_START.md` | This file - quick reference |

---

## 🧪 Quick Test Examples

### Test Required Field Validation
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

### Test Type Validation
```bash
curl -X POST http://localhost:3001/api/models \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"name": "Test", "category": "terrain", "basePrice": "not-a-number"}'
```

### Test Email Validation
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "invalid-email", "password": "Pass123", "displayName": "Test"}'
```

### Test Rate Limiting
```bash
# Make 101 requests quickly
for i in {1..101}; do
  curl -X GET http://localhost:3001/api/browse
done
# Request 101 will return 429
```

---

## 💡 Best Practices

1. **Always use validation schemas** - Don't write inline validation
2. **Use asyncHandler** - Wraps async errors automatically
3. **Check error codes** - Use `error` field, not just HTTP status
4. **Respect rate limits** - Implement exponential backoff
5. **Log request IDs** - Use for debugging and support
6. **Test error scenarios** - Follow `API_TESTING_GUIDE.md`

---

## 🔗 File Locations

```
Backend:
  src/middleware/requestValidator.ts    ← Validation middleware
  src/middleware/error.ts               ← Error handling
  src/middleware/security.ts            ← Rate limiting
  src/schemas/validationSchemas.ts      ← Validation schemas

Documentation:
  API_ERROR_CODES_REFERENCE.md          ← Error codes
  API_TESTING_GUIDE.md                  ← Testing procedures
  API_IMPLEMENTATION_COMPLETE.md        ← Full details
  API_QUICK_START.md                    ← This file
```

---

## ❓ Common Questions

**Q: How do I add validation to an existing route?**
A: Import the schema and add `validate(schema)` middleware before your handler.

**Q: How do I create a custom validation rule?**
A: Use the `custom` property with a function that returns true or an error message.

**Q: What if I need a validation schema that doesn't exist?**
A: Create it in `src/schemas/validationSchemas.ts` following the existing patterns.

**Q: How do I test rate limiting?**
A: See `API_TESTING_GUIDE.md` for detailed testing procedures.

**Q: What error codes are available?**
A: See `API_ERROR_CODES_REFERENCE.md` for complete list.

---

## 🚀 Next Steps

1. **Apply validation** to your routes using existing schemas
2. **Test error handling** following the testing guide
3. **Monitor in production** using the provided procedures
4. **Extend as needed** by creating new schemas

---

**Status**: ✅ Production Ready  
**Last Updated**: October 29, 2025

