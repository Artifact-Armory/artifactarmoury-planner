// backend/src/middleware/security.ts
// Security headers, rate limiting, and attack prevention

import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import helmet from 'helmet';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';
import { logger } from '../utils/logger';
import type { AuthRequest } from './auth';

// ============================================================================
// REDIS CLIENT (For distributed rate limiting)
// ============================================================================

let redisClient: ReturnType<typeof createClient> | null = null;

async function initRedis() {
  if (process.env.REDIS_URL) {
    try {
      redisClient = createClient({
        url: process.env.REDIS_URL
      });

      redisClient.on('error', (err) => {
        logger.error('Redis client error', { error: err });
      });

      await redisClient.connect();
      logger.info('Redis connected for rate limiting');
    } catch (error) {
      logger.warn('Redis connection failed, using memory store for rate limiting', { error });
      redisClient = null;
    }
  } else {
    logger.info('No REDIS_URL provided, using memory store for rate limiting');
  }
}

initRedis();

// ============================================================================
// CORS CONFIGURATION
// ============================================================================

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173'];

export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400 // 24 hours
};

// ============================================================================
// HELMET CONFIGURATION (Security Headers)
// ============================================================================

export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false, // Allow loading external resources
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
});

// ============================================================================
// RATE LIMITING
// ============================================================================

/**
 * Standard rate limit handler
 */
const rateLimitHandler = (req: Request, res: Response) => {
  logger.warn('Rate limit exceeded', {
    ip: req.ip,
    path: req.path,
    userId: (req as AuthRequest).userId
  });

  res.status(429).json({
    error: 'Too many requests',
    message: 'You have exceeded the rate limit. Please try again later.',
    retryAfter: res.getHeader('Retry-After')
  });
};

/**
 * Skip rate limiting for successful requests (only count failures)
 */
const skipSuccessfulRequests = (req: Request, res: Response) => {
  return res.statusCode < 400;
};

/**
 * Key generator - use userId if authenticated, otherwise IP
 */
const rateLimitKeyGenerator = (req: Request) => {
  const userId = (req as AuthRequest).userId;
  return userId ? `user:${userId}` : `ip:${req.ip}`;
};

// ============================================================================
// RATE LIMIT CONFIGURATIONS
// ============================================================================

/**
 * General API rate limit
 * 100 requests per 15 minutes per IP/user
 */
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  skip: (req) => process.env.NODE_ENV === 'development' && req.ip === '::1',
  ...(redisClient && {
    store: new RedisStore({
      // @ts-expect-error - RedisStore types not perfect
      client: redisClient,
      prefix: 'rl:general:'
    })
  })
});

/**
 * Strict rate limit for authentication endpoints
 * 5 requests per 15 minutes per IP
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip}`,
  ...(redisClient && {
    store: new RedisStore({
      // @ts-expect-error
      client: redisClient,
      prefix: 'rl:auth:'
    })
  })
});

/**
 * File upload rate limit
 * 20 uploads per hour per user
 */
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Upload limit exceeded, please try again later',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  ...(redisClient && {
    store: new RedisStore({
      // @ts-expect-error
      client: redisClient,
      prefix: 'rl:upload:'
    })
  })
});

/**
 * Payment/checkout rate limit
 * 10 payment attempts per hour per user
 */
export const paymentRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: false,
  message: 'Too many payment attempts, please contact support',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  ...(redisClient && {
    store: new RedisStore({
      // @ts-expect-error
      client: redisClient,
      prefix: 'rl:payment:'
    })
  })
});

/**
 * Search rate limit
 * 60 searches per minute per IP/user
 */
export const searchRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: 'Too many search requests',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  ...(redisClient && {
    store: new RedisStore({
      // @ts-expect-error
      client: redisClient,
      prefix: 'rl:search:'
    })
  })
});

/**
 * Email rate limit
 * 3 emails per hour per user
 */
export const emailRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Email limit exceeded',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  ...(redisClient && {
    store: new RedisStore({
      // @ts-expect-error
      client: redisClient,
      prefix: 'rl:email:'
    })
  })
});

// ============================================================================
// IP WHITELIST/BLACKLIST
// ============================================================================

const blacklistedIPs = new Set<string>(
  process.env.BLACKLISTED_IPS?.split(',') || []
);

const whitelistedIPs = new Set<string>(
  process.env.WHITELISTED_IPS?.split(',') || ['127.0.0.1', '::1']
);

/**
 * Block requests from blacklisted IPs
 */
export function checkIPBlacklist(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const ip = req.ip;

  if (blacklistedIPs.has(ip)) {
    logger.warn('Blocked request from blacklisted IP', { ip, path: req.path });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied'
    });
    return;
  }

  next();
}

/**
 * Allow only whitelisted IPs (for admin endpoints)
 */
export function requireWhitelistedIP(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const ip = req.ip;

  if (!whitelistedIPs.has(ip) && process.env.NODE_ENV === 'production') {
    logger.warn('Blocked request from non-whitelisted IP', { ip, path: req.path });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied'
    });
    return;
  }

  next();
}

// ============================================================================
// REQUEST SANITIZATION
// ============================================================================

/**
 * Sanitize request body to prevent NoSQL/SQL injection
 */
export function sanitizeRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.body) {
    sanitizeObject(req.body);
  }

  if (req.query) {
    sanitizeObject(req.query);
  }

  if (req.params) {
    sanitizeObject(req.params);
  }

  next();
}

function sanitizeObject(obj: any): void {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      // Remove potential SQL injection patterns
      obj[key] = obj[key]
        .replace(/[;\-\-]/g, '') // Remove semicolons and SQL comments
        .trim();
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizeObject(obj[key]);
    }
  }
}

// ============================================================================
// XSS PROTECTION
// ============================================================================

/**
 * Prevent XSS in user input
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return input;

  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// ============================================================================
// PREVENT PARAMETER POLLUTION
// ============================================================================

/**
 * Prevent HTTP parameter pollution attacks
 */
export function preventParameterPollution(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Check for duplicate parameters
  for (const key in req.query) {
    if (Array.isArray(req.query[key])) {
      logger.warn('Parameter pollution attempt detected', {
        key,
        values: req.query[key],
        ip: req.ip
      });

      // Take the first value only
      req.query[key] = (req.query[key] as string[])[0];
    }
  }

  next();
}

// ============================================================================
// REQUEST SIZE LIMITS
// ============================================================================

/**
 * Prevent large payload attacks
 */
export function checkPayloadSize(maxSize: number = 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.get('content-length') || '0');

    if (contentLength > maxSize) {
      logger.warn('Request payload too large', {
        contentLength,
        maxSize,
        ip: req.ip,
        path: req.path
      });

      res.status(413).json({
        error: 'Payload too large',
        message: `Request body must be less than ${maxSize / 1024 / 1024}MB`,
        maxSize
      });
      return;
    }

    next();
  };
}

// ============================================================================
// SLOW DOWN MIDDLEWARE
// ============================================================================

/**
 * Gradually slow down requests after limit
 * Useful for expensive operations
 */
export function createSlowDown(options: {
  windowMs: number;
  delayAfter: number;
  delayMs: number;
}) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = rateLimitKeyGenerator(req);
    const now = Date.now();
    const record = requests.get(key);

    // Reset if window expired
    if (!record || now > record.resetTime) {
      requests.set(key, {
        count: 1,
        resetTime: now + options.windowMs
      });
      next();
      return;
    }

    // Increment count
    record.count++;

    // Apply delay if over threshold
    if (record.count > options.delayAfter) {
      const delay = (record.count - options.delayAfter) * options.delayMs;
      
      logger.debug('Slowing down request', {
        key,
        count: record.count,
        delay
      });

      setTimeout(() => next(), Math.min(delay, 10000)); // Max 10s delay
    } else {
      next();
    }
  };
}

// ============================================================================
// SECURITY MONITORING
// ============================================================================

/**
 * Log suspicious activity
 */
export function monitorSuspiciousActivity(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const suspiciousPatterns = [
    /(\.\.|\/\/)/g, // Path traversal
    /(union|select|insert|update|delete|drop|create|alter|exec|script)/gi, // SQL injection
    /(<script|<iframe|javascript:|onerror=)/gi, // XSS
    /(eval\(|expression\()/gi // Code injection
  ];

  const checkString = `${req.path}${JSON.stringify(req.query)}${JSON.stringify(req.body)}`;

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(checkString)) {
      logger.warn('Suspicious request pattern detected', {
        pattern: pattern.source,
        ip: req.ip,
        path: req.path,
        userAgent: req.get('user-agent'),
        userId: (req as AuthRequest).userId
      });
      break;
    }
  }

  next();
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  corsOptions,
  helmetConfig,
  generalRateLimit,
  authRateLimit,
  uploadRateLimit,
  paymentRateLimit,
  searchRateLimit,
  emailRateLimit,
  checkIPBlacklist,
  requireWhitelistedIP,
  sanitizeRequest,
  sanitizeInput,
  preventParameterPollution,
  checkPayloadSize,
  createSlowDown,
  monitorSuspiciousActivity
};