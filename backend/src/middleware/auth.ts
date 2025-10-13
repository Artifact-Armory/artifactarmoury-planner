// backend/src/middleware/auth.ts
// JWT authentication and authorization middleware

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { logger } from '../utils/logger';
import type { User } from '../../../shared/types';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthRequest extends Request {
  user?: User;
  userId?: string;
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (JWT_SECRET === 'your-secret-key-change-in-production') {
  logger.warn('⚠️  Using default JWT_SECRET - please set a secure secret in production!');
}

// ============================================================================
// TOKEN GENERATION
// ============================================================================

export function generateToken(user: User): string {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
}

export function generateRefreshToken(user: User): string {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '30d' // Refresh tokens last longer
  });
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Verify JWT token and attach user to request
 * Returns 401 if token is missing or invalid
 */
export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'No token provided' 
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(401).json({ 
          error: 'Token expired',
          message: 'Please log in again' 
        });
        return;
      }
      
      if (error instanceof jwt.JsonWebTokenError) {
        res.status(401).json({ 
          error: 'Invalid token',
          message: 'Authentication failed' 
        });
        return;
      }

      throw error;
    }

    // Fetch user from database
    const result = await db.query(
      `SELECT id, email, display_name, role, account_status, 
              artist_name, artist_bio, artist_url, 
              stripe_account_id, stripe_onboarding_complete,
              created_at, updated_at
       FROM users 
       WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ 
        error: 'User not found',
        message: 'Invalid authentication credentials' 
      });
      return;
    }

    const user = result.rows[0];

    // Check account status
    if (user.account_status === 'suspended') {
      res.status(403).json({ 
        error: 'Account suspended',
        message: 'Your account has been suspended. Please contact support.' 
      });
      return;
    }

    if (user.account_status === 'banned') {
      res.status(403).json({ 
        error: 'Account banned',
        message: 'Your account has been banned.' 
      });
      return;
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;

    // Log authentication (for security auditing)
    logger.debug('User authenticated', {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip,
      path: req.path
    });

    next();
  } catch (error) {
    logger.error('Authentication error', { error });
    res.status(500).json({ 
      error: 'Authentication failed',
      message: 'An error occurred during authentication' 
    });
  }
}

// ============================================================================
// OPTIONAL AUTHENTICATION
// ============================================================================

/**
 * Attach user to request if token exists, but don't require it
 * Useful for endpoints that work for both authenticated and anonymous users
 */
export async function optionalAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    // No token provided - continue as anonymous
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);

    // Try to verify token
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      
      // Fetch user
      const result = await db.query(
        `SELECT id, email, display_name, role, account_status, 
                artist_name, artist_bio, artist_url, 
                stripe_account_id, stripe_onboarding_complete,
                created_at, updated_at
         FROM users 
         WHERE id = $1 AND account_status = 'active'`,
        [decoded.userId]
      );

      if (result.rows.length > 0) {
        req.user = result.rows[0];
        req.userId = result.rows[0].id;
      }
    } catch (error) {
      // Invalid/expired token - continue as anonymous
      logger.debug('Optional auth: invalid token, continuing as anonymous');
    }

    next();
  } catch (error) {
    logger.error('Optional auth error', { error });
    next(); // Continue even if there's an error
  }
}

// ============================================================================
// AUTHORIZATION MIDDLEWARE
// ============================================================================

/**
 * Require specific role(s)
 * Must be used AFTER authenticate middleware
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'You must be logged in to access this resource' 
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Unauthorized role access attempt', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path
      });

      res.status(403).json({ 
        error: 'Forbidden',
        message: 'You do not have permission to access this resource' 
      });
      return;
    }

    next();
  };
}

/**
 * Require user to be an artist
 */
export const requireArtist = requireRole('artist', 'admin');

/**
 * Require user to be an admin
 */
export const requireAdmin = requireRole('admin');

/**
 * Require user to be either a customer or authenticated
 */
export const requireCustomer = requireRole('customer', 'artist', 'admin');

// ============================================================================
// RESOURCE OWNERSHIP MIDDLEWARE
// ============================================================================

/**
 * Verify user owns the resource
 * Checks if the :id parameter matches the authenticated user's ID
 * Admins can access any resource
 */
export function requireOwnership(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'You must be logged in to access this resource' 
    });
    return;
  }

  const resourceUserId = req.params.userId || req.params.id;

  // Admins can access anything
  if (req.user.role === 'admin') {
    next();
    return;
  }

  // Check ownership
  if (resourceUserId !== req.user.id) {
    logger.warn('Ownership violation attempt', {
      userId: req.user.id,
      resourceUserId,
      path: req.path
    });

    res.status(403).json({ 
      error: 'Forbidden',
      message: 'You can only access your own resources' 
    });
    return;
  }

  next();
}

/**
 * Verify user owns the model
 * Checks database to ensure the model belongs to the authenticated user
 */
export async function requireModelOwnership(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'You must be logged in to access this resource' 
      });
      return;
    }

    const modelId = req.params.id || req.params.modelId;

    // Admins can access anything
    if (req.user.role === 'admin') {
      next();
      return;
    }

    // Check model ownership
    const result = await db.query(
      'SELECT artist_id FROM models WHERE id = $1',
      [modelId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ 
        error: 'Not found',
        message: 'Model not found' 
      });
      return;
    }

    if (result.rows[0].artist_id !== req.user.id) {
      logger.warn('Model ownership violation attempt', {
        userId: req.user.id,
        modelId,
        actualOwnerId: result.rows[0].artist_id
      });

      res.status(403).json({ 
        error: 'Forbidden',
        message: 'You can only modify your own models' 
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Model ownership check error', { error });
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to verify model ownership' 
    });
  }
}

// ============================================================================
// STRIPE CONNECT VERIFICATION
// ============================================================================

/**
 * Verify artist has completed Stripe onboarding
 * Required for artists to receive payments
 */
export function requireStripeConnected(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'You must be logged in' 
    });
    return;
  }

  if (req.user.role !== 'artist' && req.user.role !== 'admin') {
    res.status(403).json({ 
      error: 'Forbidden',
      message: 'Only artists can access this resource' 
    });
    return;
  }

  if (!req.user.stripe_onboarding_complete) {
    res.status(403).json({ 
      error: 'Stripe setup incomplete',
      message: 'Please complete Stripe Connect onboarding to receive payments',
      action: 'complete_stripe_onboarding'
    });
    return;
  }

  next();
}

// ============================================================================
// TOKEN REFRESH
// ============================================================================

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ 
        error: 'Bad request',
        message: 'Refresh token required' 
      });
      return;
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload;

    // Fetch fresh user data
    const result = await db.query(
      `SELECT id, email, display_name, role, account_status,
              artist_name, stripe_onboarding_complete
       FROM users 
       WHERE id = $1 AND account_status = 'active'`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ 
        error: 'Invalid token',
        message: 'User not found or account inactive' 
      });
      return;
    }

    const user = result.rows[0];

    // Generate new access token
    const newAccessToken = generateToken(user);

    res.json({
      accessToken: newAccessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        artistName: user.artist_name,
        stripeOnboardingComplete: user.stripe_onboarding_complete
      }
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ 
        error: 'Token expired',
        message: 'Refresh token has expired. Please log in again.' 
      });
      return;
    }

    logger.error('Token refresh error', { error });
    res.status(401).json({ 
      error: 'Invalid token',
      message: 'Failed to refresh access token' 
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  authenticate,
  optionalAuth,
  requireRole,
  requireArtist,
  requireAdmin,
  requireCustomer,
  requireOwnership,
  requireModelOwnership,
  requireStripeConnected,
  generateToken,
  generateRefreshToken,
  refreshAccessToken
};