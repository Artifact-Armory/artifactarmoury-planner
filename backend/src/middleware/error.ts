// backend/src/middleware/error.ts
// Centralized error handling middleware

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import type { AuthRequest } from './auth';

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;
  details?: any;

  constructor(
    message: string,
    statusCode: number = 500,
    code?: string,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Permission denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class PaymentError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 402, 'PAYMENT_ERROR', details);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super(`${service} is temporarily unavailable`, 503, 'SERVICE_UNAVAILABLE');
  }
}

// ============================================================================
// ERROR RESPONSE INTERFACE
// ============================================================================

interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: any;
  stack?: string;
  requestId?: string;
  timestamp: string;
  path: string;
}

// ============================================================================
// NOT FOUND HANDLER
// ============================================================================

/**
 * Handle 404 - Route not found
 * Place this AFTER all route handlers
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const error = new NotFoundError('Endpoint');
  
  logger.warn('Route not found', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  next(error);
}

// ============================================================================
// MAIN ERROR HANDLER
// ============================================================================

/**
 * Centralized error handling middleware
 * Place this LAST in the middleware chain
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Default error values
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';
  let details: any = undefined;
  let stack: string | undefined = undefined;

  // Generate request ID for tracking
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Handle known AppError instances
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.code || errorCode;
    message = err.message;
    details = err.details;
  } 
  // Handle database errors
  else if ((err as any).code) {
    const dbError = handleDatabaseError(err as any);
    statusCode = dbError.statusCode;
    errorCode = dbError.code;
    message = dbError.message;
    details = dbError.details;
  }
  // Handle validation errors from libraries
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = err.message;
  }
  // Handle JSON parsing errors
  else if (err instanceof SyntaxError && 'body' in err) {
    statusCode = 400;
    errorCode = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
  }

  // Log the error
  const logData = {
    requestId,
    statusCode,
    errorCode,
    message: err.message,
    method: req.method,
    path: req.path,
    userId: (req as AuthRequest).userId,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    details,
    stack: err.stack
  };

  if (statusCode >= 500) {
    logger.error('Server error', logData);
  } else {
    logger.warn('Client error', logData);
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    stack = err.stack;
  }

  // Build error response
  const errorResponse: ErrorResponse = {
    error: errorCode,
    message,
    code: errorCode,
    requestId,
    timestamp: new Date().toISOString(),
    path: req.path
  };

  if (details) {
    errorResponse.details = details;
  }

  if (stack) {
    errorResponse.stack = stack;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
}

// ============================================================================
// DATABASE ERROR HANDLER
// ============================================================================

interface DatabaseErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: any;
}

function handleDatabaseError(err: any): DatabaseErrorResponse {
  // PostgreSQL error codes
  switch (err.code) {
    case '23505': // Unique violation
      return {
        statusCode: 409,
        code: 'DUPLICATE_ENTRY',
        message: 'A record with this value already exists',
        details: {
          constraint: err.constraint,
          detail: err.detail
        }
      };

    case '23503': // Foreign key violation
      return {
        statusCode: 400,
        code: 'FOREIGN_KEY_VIOLATION',
        message: 'Referenced record does not exist',
        details: {
          constraint: err.constraint,
          detail: err.detail
        }
      };

    case '23502': // Not null violation
      return {
        statusCode: 400,
        code: 'REQUIRED_FIELD_MISSING',
        message: 'Required field is missing',
        details: {
          column: err.column,
          table: err.table
        }
      };

    case '23514': // Check constraint violation
      return {
        statusCode: 400,
        code: 'CONSTRAINT_VIOLATION',
        message: 'Value does not meet requirements',
        details: {
          constraint: err.constraint
        }
      };

    case '22P02': // Invalid text representation
      return {
        statusCode: 400,
        code: 'INVALID_DATA_TYPE',
        message: 'Invalid data type provided'
      };

    case '42P01': // Undefined table
      return {
        statusCode: 500,
        code: 'DATABASE_ERROR',
        message: 'Database configuration error'
      };

    case '53300': // Too many connections
      return {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database connection pool exhausted'
      };

    case '57P01': // Admin shutdown
    case '57P02': // Crash shutdown
    case '57P03': // Cannot connect now
      return {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database temporarily unavailable'
      };

    case 'ECONNREFUSED':
    case 'ENOTFOUND':
      return {
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Cannot connect to database'
      };

    default:
      return {
        statusCode: 500,
        code: 'DATABASE_ERROR',
        message: 'A database error occurred',
        details: process.env.NODE_ENV === 'development' ? {
          code: err.code,
          detail: err.detail
        } : undefined
      };
  }
}

// ============================================================================
// ASYNC ERROR WRAPPER
// ============================================================================

/**
 * Wrapper for async route handlers to catch errors
 * Eliminates need for try/catch in every route
 * 
 * Usage:
 * router.get('/endpoint', asyncHandler(async (req, res) => {
 *   const data = await someAsyncOperation();
 *   res.json(data);
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ============================================================================
// VALIDATION ERROR FORMATTER
// ============================================================================

/**
 * Format validation errors from express-validator or similar
 */
export function formatValidationErrors(errors: any[]): any {
  return errors.reduce((acc, err) => {
    const field = err.param || err.path || 'unknown';
    if (!acc[field]) {
      acc[field] = [];
    }
    acc[field].push(err.msg || err.message);
    return acc;
  }, {});
}

// ============================================================================
// UNHANDLED REJECTION HANDLERS
// ============================================================================

/**
 * Handle unhandled promise rejections
 */
export function handleUnhandledRejection(): void {
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Promise Rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise
    });

    // In production, you might want to restart the process
    if (process.env.NODE_ENV === 'production') {
      logger.error('Shutting down due to unhandled rejection');
      process.exit(1);
    }
  });
}

/**
 * Handle uncaught exceptions
 */
export function handleUncaughtException(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      message: error.message,
      stack: error.stack
    });

    // Always exit on uncaught exceptions
    logger.error('Shutting down due to uncaught exception');
    process.exit(1);
  });
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(server: any): void {
  const signals = ['SIGTERM', 'SIGINT'];

  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.info(`${signal} received, starting graceful shutdown`);

      // Stop accepting new connections
      server.close(() => {
        logger.info('HTTP server closed');
      });

      // Give existing connections time to finish (30 seconds)
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);

      try {
        // Close database connections
        await require('../db').closePool();
        logger.info('Database connections closed');

        // Additional cleanup can go here
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown', { error });
        process.exit(1);
      }
    });
  });
}

// ============================================================================
// ERROR UTILITIES
// ============================================================================

/**
 * Check if error is operational (expected) or programming error
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Send error to external monitoring service (e.g., Sentry)
 */
export function reportError(error: Error, context?: any): void {
  // In production, send to error tracking service
  if (process.env.NODE_ENV === 'production') {
    // Example: Sentry.captureException(error, { extra: context });
    logger.error('Error reported to monitoring service', {
      error: error.message,
      stack: error.stack,
      context
    });
  }
}

// ============================================================================
// REQUEST CONTEXT (For Better Error Tracking)
// ============================================================================

/**
 * Middleware to add request context to all subsequent logs
 */
export function addRequestContext(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Add request ID to request object
  (req as any).requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Add request start time
  (req as any).startTime = Date.now();

  // Log request completion
  res.on('finish', () => {
    const duration = Date.now() - (req as any).startTime;
    
    logger.info('Request completed', {
      requestId: (req as any).requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: (req as AuthRequest).userId,
      ip: req.ip
    });
  });

  next();
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  PaymentError,
  RateLimitError,
  ServiceUnavailableError,
  notFoundHandler,
  errorHandler,
  asyncHandler,
  formatValidationErrors,
  handleUnhandledRejection,
  handleUncaughtException,
  setupGracefulShutdown,
  isOperationalError,
  reportError,
  addRequestContext
};