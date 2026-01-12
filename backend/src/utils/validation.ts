// backend/src/utils/validation.ts
import type { Request, Response, NextFunction } from 'express'

// ============================================================================
// VALIDATION ERRORS
// ============================================================================

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public code?: string
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ============================================================================
// EMAIL VALIDATION
// ============================================================================

export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false
  
  // RFC 5322 simplified regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  
  if (!emailRegex.test(email)) return false
  
  // Additional checks
  if (email.length > 254) return false // Max email length
  
  const [localPart, domain] = email.split('@')
  if (localPart.length > 64) return false // Max local part length
  
  return true
}

export function validateEmail(email: string): void {
  if (!isValidEmail(email)) {
    throw new ValidationError('Invalid email address', 'email', 'INVALID_EMAIL')
  }
}

// ============================================================================
// PASSWORD VALIDATION
// ============================================================================

export interface PasswordRequirements {
  minLength?: number
  requireUppercase?: boolean
  requireLowercase?: boolean
  requireNumbers?: boolean
  requireSpecialChars?: boolean
}

const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: false
}

export function validatePassword(
  password: string,
  requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
): void {
  if (!password || typeof password !== 'string') {
    throw new ValidationError('Password is required', 'password', 'PASSWORD_REQUIRED')
  }

  const minLength = requirements.minLength ?? 8
  if (password.length < minLength) {
    throw new ValidationError(
      `Password must be at least ${minLength} characters`,
      'password',
      'PASSWORD_TOO_SHORT'
    )
  }

  if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
    throw new ValidationError(
      'Password must contain at least one uppercase letter',
      'password',
      'PASSWORD_NO_UPPERCASE'
    )
  }

  if (requirements.requireLowercase && !/[a-z]/.test(password)) {
    throw new ValidationError(
      'Password must contain at least one lowercase letter',
      'password',
      'PASSWORD_NO_LOWERCASE'
    )
  }

  if (requirements.requireNumbers && !/[0-9]/.test(password)) {
    throw new ValidationError(
      'Password must contain at least one number',
      'password',
      'PASSWORD_NO_NUMBER'
    )
  }

  if (requirements.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    throw new ValidationError(
      'Password must contain at least one special character',
      'password',
      'PASSWORD_NO_SPECIAL'
    )
  }
}

// ============================================================================
// STRING VALIDATION
// ============================================================================

export function validateString(
  value: any,
  field: string,
  options: {
    minLength?: number
    maxLength?: number
    required?: boolean
    pattern?: RegExp
  } = {}
): void {
  const { minLength, maxLength, required = true, pattern } = options

  if (required && (!value || typeof value !== 'string' || value.trim() === '')) {
    throw new ValidationError(`${field} is required`, field, 'REQUIRED')
  }

  if (!value) return // Optional field not provided

  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`, field, 'INVALID_TYPE')
  }

  const trimmed = value.trim()

  if (minLength && trimmed.length < minLength) {
    throw new ValidationError(
      `${field} must be at least ${minLength} characters`,
      field,
      'TOO_SHORT'
    )
  }

  if (maxLength && trimmed.length > maxLength) {
    throw new ValidationError(
      `${field} must be at most ${maxLength} characters`,
      field,
      'TOO_LONG'
    )
  }

  if (pattern && !pattern.test(trimmed)) {
    throw new ValidationError(
      `${field} has invalid format`,
      field,
      'INVALID_FORMAT'
    )
  }
}

// ============================================================================
// NUMBER VALIDATION
// ============================================================================

export function validateNumber(
  value: any,
  field: string,
  options: {
    min?: number
    max?: number
    required?: boolean
    integer?: boolean
  } = {}
): void {
  const { min, max, required = true, integer = false } = options

  if (required && (value === undefined || value === null)) {
    throw new ValidationError(`${field} is required`, field, 'REQUIRED')
  }

  if (value === undefined || value === null) return // Optional field

  const num = Number(value)

  if (isNaN(num)) {
    throw new ValidationError(`${field} must be a number`, field, 'INVALID_TYPE')
  }

  if (integer && !Number.isInteger(num)) {
    throw new ValidationError(`${field} must be an integer`, field, 'NOT_INTEGER')
  }

  if (min !== undefined && num < min) {
    throw new ValidationError(
      `${field} must be at least ${min}`,
      field,
      'TOO_SMALL'
    )
  }

  if (max !== undefined && num > max) {
    throw new ValidationError(
      `${field} must be at most ${max}`,
      field,
      'TOO_LARGE'
    )
  }
}

// ============================================================================
// ARRAY VALIDATION
// ============================================================================

export function validateArray(
  value: any,
  field: string,
  options: {
    minLength?: number
    maxLength?: number
    required?: boolean
    itemValidator?: (item: any) => void
  } = {}
): void {
  const { minLength, maxLength, required = true, itemValidator } = options

  if (required && (!value || !Array.isArray(value))) {
    throw new ValidationError(`${field} is required`, field, 'REQUIRED')
  }

  if (!value) return // Optional field

  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`, field, 'INVALID_TYPE')
  }

  if (minLength !== undefined && value.length < minLength) {
    throw new ValidationError(
      `${field} must have at least ${minLength} items`,
      field,
      'TOO_FEW'
    )
  }

  if (maxLength !== undefined && value.length > maxLength) {
    throw new ValidationError(
      `${field} must have at most ${maxLength} items`,
      field,
      'TOO_MANY'
    )
  }

  if (itemValidator) {
    value.forEach((item, index) => {
      try {
        itemValidator(item)
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new ValidationError(
            `${field}[${index}]: ${error.message}`,
            `${field}[${index}]`,
            error.code
          )
        }
        throw error
      }
    })
  }
}

// ============================================================================
// ENUM VALIDATION
// ============================================================================

export function validateEnum(
  value: any,
  field: string,
  allowedValues: any[],
  required = true
): void {
  if (required && (value === undefined || value === null)) {
    throw new ValidationError(`${field} is required`, field, 'REQUIRED')
  }

  if (value === undefined || value === null) return // Optional field

  if (!allowedValues.includes(value)) {
    throw new ValidationError(
      `${field} must be one of: ${allowedValues.join(', ')}`,
      field,
      'INVALID_VALUE'
    )
  }
}

// ============================================================================
// FILE VALIDATION
// ============================================================================

export function validateFileType(
  filename: string,
  allowedExtensions: string[]
): void {
  const ext = filename.toLowerCase().split('.').pop()
  
  if (!ext || !allowedExtensions.includes(`.${ext}`)) {
    throw new ValidationError(
      `File type not allowed. Allowed types: ${allowedExtensions.join(', ')}`,
      'file',
      'INVALID_FILE_TYPE'
    )
  }
}

export function validateFileSize(
  size: number,
  maxSize: number
): void {
  if (size > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2)
    throw new ValidationError(
      `File size exceeds maximum allowed size of ${maxSizeMB}MB`,
      'file',
      'FILE_TOO_LARGE'
    )
  }
}

// ============================================================================
// UUID VALIDATION
// ============================================================================

export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(value)
}

export function validateUUID(value: string, field: string): void {
  if (!isValidUUID(value)) {
    throw new ValidationError(`${field} must be a valid UUID`, field, 'INVALID_UUID')
  }
}

// ============================================================================
// URL VALIDATION
// ============================================================================

export function isValidURL(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export function validateURL(value: string, field: string): void {
  if (!isValidURL(value)) {
    throw new ValidationError(`${field} must be a valid URL`, field, 'INVALID_URL')
  }
}

// ============================================================================
// SANITIZATION
// ============================================================================

export function sanitizeString(value: string): string {
  if (!value || typeof value !== 'string') return ''
  
  return value
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets to prevent HTML injection
    .replace(/\0/g, '') // Remove null bytes
    .substring(0, 10000) // Limit length to prevent DoS
}

export function sanitizeHTML(value: string): string {
  if (!value || typeof value !== 'string') return ''
  
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
}

export function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject)
  }
  
  const sanitized: any = {}
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value)
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value)
    } else {
      sanitized[key] = value
    }
  }
  
  return sanitized
}

// ============================================================================
// VALIDATION MIDDLEWARE
// ============================================================================

export function validate(schema: Record<string, (value: any) => void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      for (const [field, validator] of Object.entries(schema)) {
        validator(req.body[field])
      }
      next()
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({
          error: error.message,
          field: error.field,
          code: error.code
        })
      }
      next(error)
    }
  }
}

// ============================================================================
// COMMON VALIDATION SCHEMAS
// ============================================================================

export const registerSchema = {
  email: (value: any) => {
    validateString(value, 'email', { maxLength: 255 })
    validateEmail(value)
  },
  password: (value: any) => validatePassword(value),
  name: (value: any) => validateString(value, 'name', { minLength: 2, maxLength: 255 }),
  inviteCode: (value: any) => validateString(value, 'inviteCode', { minLength: 6, maxLength: 50 })
}

export const loginSchema = {
  email: (value: any) => {
    validateString(value, 'email', { maxLength: 255 })
    validateEmail(value)
  },
  password: (value: any) => validateString(value, 'password', { minLength: 1 })
}

export const assetUploadSchema = {
  name: (value: any) => validateString(value, 'name', { minLength: 3, maxLength: 255 }),
  description: (value: any) => validateString(value, 'description', { maxLength: 5000, required: false }),
  base_price: (value: any) => validateNumber(value, 'base_price', { min: 0.5, max: 10000 }),
  genre: (value: any) => validateString(value, 'genre', { maxLength: 100 }),
  categories: (value: any) => validateArray(value, 'categories', {
    required: false,
    maxLength: 10,
    itemValidator: (item) => validateString(item, 'category', { maxLength: 100 })
  }),
  tags: (value: any) => validateArray(value, 'tags', {
    required: false,
    maxLength: 20,
    itemValidator: (item) => validateString(item, 'tag', { maxLength: 50 })
  })
}

export const checkoutSchema = {
  user_email: (value: any) => {
    validateString(value, 'user_email', { maxLength: 255 })
    validateEmail(value)
  },
  user_name: (value: any) => validateString(value, 'user_name', { minLength: 2, maxLength: 255 }),
  payment_method: (value: any) => validateEnum(value, 'payment_method', ['stripe', 'paypal']),
  items: (value: any) => validateArray(value, 'items', {
    minLength: 1,
    maxLength: 100,
    itemValidator: (item) => {
      if (!item.asset_id || !item.quantity) {
        throw new ValidationError('Each item must have asset_id and quantity')
      }
      validateUUID(item.asset_id, 'asset_id')
      validateNumber(item.quantity, 'quantity', { min: 1, max: 100, integer: true })
    }
  })
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  ValidationError,
  isValidEmail,
  validateEmail,
  validatePassword,
  validateString,
  validateNumber,
  validateArray,
  validateEnum,
  validateFileType,
  validateFileSize,
  isValidUUID,
  validateUUID,
  isValidURL,
  validateURL,
  sanitizeString,
  sanitizeHTML,
  sanitizeObject,
  validate,
  registerSchema,
  loginSchema,
  assetUploadSchema,
  checkoutSchema
}