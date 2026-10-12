// backend/src/middleware/security.ts
// Security headers, rate limiting, and attack prevention

import rateLimit, { MemoryStore, type Options, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import helmet from 'helmet';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';
import { logger } from '../utils/logger';
import { clientIp, clientIpKey } from '../utils/clientIp';
import type { AuthRequest } from './auth';

// ============================================================================
// REDIS CLIENT (shared rate-limit counters across API replicas)
// ============================================================================
//
// Optional: with REDIS_URL unset every limiter counts in this process's memory, which
// is right for a single API replica. Before 2026-10-12 setting it did nothing useful:
// the client connected asynchronously, but every limiter had already been built (at
// import time) while it was still null, and the store was given an option this
// version doesn't take — so the counters were never shared.

const redisClient = process.env.REDIS_URL
  ? createClient({
      url: process.env.REDIS_URL,
      // Fail a command at once while disconnected rather than queueing it, so a Redis
      // outage can't stall requests; ResilientStore then counts in memory instead.
      disableOfflineQueue: true,
    })
  : null;

if (redisClient) {
  let lastErrorLog = 0;
  redisClient.on('error', (err) => {
    // It retries every few hundred ms while down; one line a minute is enough.
    if (Date.now() - lastErrorLog > 60_000) {
      lastErrorLog = Date.now();
      logger.error('Redis (rate limiting) unavailable — counting in memory meanwhile', { error: err });
    }
  });
  redisClient.on('ready', () => logger.info('Redis connected for rate limiting'));
  redisClient.connect().catch(() => { /* reported by the 'error' handler; it keeps retrying */ });
} else {
  logger.info('No REDIS_URL provided, using memory store for rate limiting');
}

/**
 * Counts in Redis while it is connected, and in this process's memory otherwise, so a
 * Redis outage degrades rate limiting to per-replica rather than blocking requests or
 * crashing the server (the Redis store's start-up script load would otherwise end up
 * as an unhandled promise rejection, which this app treats as fatal).
 */
class ResilientStore implements Store {
  private readonly memory = new MemoryStore();
  private redis: RedisStore | null = null;
  private options?: Options;

  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.options = options;
    this.memory.init(options);
  }

  private shared(): RedisStore | null {
    if (!redisClient?.isReady) return null;
    if (!this.redis) {
      const client = redisClient;
      const store = new RedisStore({
        prefix: this.prefix,
        sendCommand: (...args: string[]) => client.sendCommand(args),
      });
      // Script loading starts in the constructor; a failure is retried on the next
      // increment, so just keep it from becoming an unhandled rejection.
      (store as any).incrementScriptSha?.catch?.(() => {});
      (store as any).getScriptSha?.catch?.(() => {});
      if (this.options) store.init(this.options);
      this.redis = store;
    }
    return this.redis;
  }

  async increment(key: string) {
    const shared = this.shared();
    if (shared) {
      try { return await shared.increment(key); } catch { /* fall through to memory */ }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string) {
    const shared = this.shared();
    if (shared) {
      try { return await shared.decrement(key); } catch { /* fall through */ }
    }
    return this.memory.decrement(key);
  }

  async resetKey(key: string) {
    await this.memory.resetKey(key);
    const shared = this.shared();
    if (shared) await shared.resetKey(key).catch(() => {});
  }
}

const storeFor = (prefix: string) => ({ store: new ResilientStore(prefix) });

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],
  // Content-Disposition must be exposed or the frontend can't read the
  // server-chosen filename on a cross-origin download (pages.dev -> railway.app):
  // without this, response.headers['content-disposition'] is always undefined in
  // the browser, silently falling back to a wrong-extension filename (e.g. a
  // multi-part ZIP saved as "model.stl" — the archive is downloaded correctly,
  // it's just misnamed, so it doesn't look/behave like a ZIP to the buyer).
  exposedHeaders: ['X-Total-Count', 'X-Page-Count', 'Content-Disposition'],
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
    ip: clientIp(req),
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
  return userId ? `user:${userId}` : clientIpKey(req);
};

// ============================================================================
// RATE LIMIT CONFIGURATIONS
// ============================================================================

/**
 * General API rate limit, per visitor IP. It runs before any route authenticates, so it
 * can't key by user; it's a flood guard, with the stricter limits on the routes that
 * need them. Planner meshes are skipped here because previewRateLimit counts those —
 * counted twice, one planner table could use up a visitor's whole budget.
 * GENERAL_RATE_LIMIT_MAX: requests per 15 minutes (default 300).
 */
const PREVIEW_GLB_PATH = /^\/api\/models\/(?:parts\/)?[^/]+\/preview\.glb$/;
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.GENERAL_RATE_LIMIT_MAX ?? 300),
  message: 'Too many requests from this IP, please try again later',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  skip: (req) =>
    (process.env.NODE_ENV === 'development' && req.ip === '::1') ||
    req.path === '/health' ||
    req.path === '/health/queues' ||
    PREVIEW_GLB_PATH.test(req.path),
  ...storeFor('rl:general:')
});

/**
 * Preview GLB rate limit — anti-scrape for the planner's public preview meshes.
 * A normal planner session loads a preview only when a piece is PLACED (the palette
 * uses PNG thumbnails), so even heavy use stays well under this; a script trying to
 * vacuum the whole catalogue's meshes trips it and gets logged (rateLimitHandler
 * warns with ip/user), turning silent bulk theft into a visible signal.
 * Tunable via PREVIEW_RATE_LIMIT_MAX (default 150 / 15 min per IP-or-user).
 */
export const previewRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.PREVIEW_RATE_LIMIT_MAX ?? 150),
  message: 'Too many preview requests, please slow down',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  skip: (req) => process.env.NODE_ENV === 'development' && req.ip === '::1',
  ...storeFor('rl:preview:')
});

/**
 * Strict rate limit for authentication endpoints: failed attempts per 15 minutes per
 * visitor IP (AUTH_RATE_LIMIT_MAX, default 15; successful requests don't count).
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 15),
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIpKey(req),
  skip: (req) =>
    process.env.NODE_ENV === 'development' ||
    process.env.DISABLE_AUTH_RATE_LIMIT === 'true',
  ...storeFor('rl:auth:')
});

/**
 * Presigned-URL rate limit. A single grouped listing presigns one URL per file
 * (up to ~60 parts) plus thumbnails, so this is far looser than uploadRateLimit;
 * it exists to stop bulk abuse, not to meter normal listings.
 */
export const presignRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  message: 'Too many upload requests, please try again later',
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  ...storeFor('rl:presign:')
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
  ...storeFor('rl:upload:')
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
  ...storeFor('rl:payment:')
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
  ...storeFor('rl:search:')
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
  ...storeFor('rl:email:')
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
  const ip = clientIp(req);

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
  const ip = clientIp(req);

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
