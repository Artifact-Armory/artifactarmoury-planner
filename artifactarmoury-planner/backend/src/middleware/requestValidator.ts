// backend/src/middleware/requestValidator.ts
// Request validation middleware factory for consistent validation across routes

import { Request, Response, NextFunction } from 'express';
import { ValidationError } from './error';
import logger from '../utils/logger';

// ============================================================================
// VALIDATION SCHEMA TYPES
// ============================================================================

export interface ValidationSchema {
  body?: Record<string, ValidationRule>;
  query?: Record<string, ValidationRule>;
  params?: Record<string, ValidationRule>;
}

export interface ValidationRule {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'uuid' | 'url';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  custom?: (value: any) => boolean | string; // Returns true if valid, or error message
  items?: ValidationRule; // For arrays
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

function validateValue(value: any, rule: ValidationRule, fieldName: string): string | null {
  // Check required
  if (rule.required && (value === undefined || value === null || value === '')) {
    return `${fieldName} is required`;
  }

  // Allow undefined/null for optional fields
  if (!rule.required && (value === undefined || value === null)) {
    return null;
  }

  // Type validation
  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') {
        return `${fieldName} must be a string`;
      }
      if (rule.minLength && value.length < rule.minLength) {
        return `${fieldName} must be at least ${rule.minLength} characters`;
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        return `${fieldName} must be at most ${rule.maxLength} characters`;
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        return `${fieldName} has invalid format`;
      }
      break;

    case 'number':
      const num = Number(value);
      if (isNaN(num)) {
        return `${fieldName} must be a number`;
      }
      if (rule.min !== undefined && num < rule.min) {
        return `${fieldName} must be at least ${rule.min}`;
      }
      if (rule.max !== undefined && num > rule.max) {
        return `${fieldName} must be at most ${rule.max}`;
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        return `${fieldName} must be a boolean`;
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return `${fieldName} must be an array`;
      }
      if (rule.minLength && value.length < rule.minLength) {
        return `${fieldName} must have at least ${rule.minLength} items`;
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        return `${fieldName} must have at most ${rule.maxLength} items`;
      }
      if (rule.items) {
        for (let i = 0; i < value.length; i++) {
          const itemError = validateValue(value[i], rule.items, `${fieldName}[${i}]`);
          if (itemError) return itemError;
        }
      }
      break;

    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return `${fieldName} must be a valid email`;
      }
      break;

    case 'uuid':
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        return `${fieldName} must be a valid UUID`;
      }
      break;

    case 'url':
      try {
        new URL(value);
      } catch {
        return `${fieldName} must be a valid URL`;
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `${fieldName} must be an object`;
      }
      break;
  }

  // Enum validation
  if (rule.enum && !rule.enum.includes(value)) {
    return `${fieldName} must be one of: ${rule.enum.join(', ')}`;
  }

  // Custom validation
  if (rule.custom) {
    const result = rule.custom(value);
    if (result !== true) {
      return typeof result === 'string' ? result : `${fieldName} is invalid`;
    }
  }

  return null;
}

// ============================================================================
// VALIDATION MIDDLEWARE FACTORY
// ============================================================================

/**
 * Create validation middleware for a given schema
 * 
 * Usage:
 * router.post('/endpoint', validate(schema), asyncHandler(async (req, res) => {
 *   // req.body, req.query, req.params are now validated
 * }));
 */
export function validate(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Record<string, string> = {};

    // Validate body
    if (schema.body) {
      for (const [field, rule] of Object.entries(schema.body)) {
        const error = validateValue(req.body?.[field], rule, field);
        if (error) errors[field] = error;
      }
    }

    // Validate query
    if (schema.query) {
      for (const [field, rule] of Object.entries(schema.query)) {
        const error = validateValue(req.query?.[field], rule, field);
        if (error) errors[field] = error;
      }
    }

    // Validate params
    if (schema.params) {
      for (const [field, rule] of Object.entries(schema.params)) {
        const error = validateValue(req.params?.[field], rule, field);
        if (error) errors[field] = error;
      }
    }

    // If there are errors, return 400
    if (Object.keys(errors).length > 0) {
      logger.warn('Validation failed', {
        path: req.path,
        method: req.method,
        errors
      });

      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: errors
      });
    }

    next();
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  validate,
  validateValue
};

