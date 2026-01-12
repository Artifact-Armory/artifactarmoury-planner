// backend/src/middleware/auth.ts
// JWT authentication and authorization middleware

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import logger from '../utils/logger';
import { getMockUserById, sanitizeMockUser } from '../mock/mockUsers';

// ============================================================================
// TYPES
// ============================================================================

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: 'customer' | 'artist' | 'admin';
  account_status: 'active' | 'suspended' | 'banned';
  artist_name?: string;
  artist_bio?: string;
  artist_url?: string;
  stripe_account_id?: string;
  stripe_onboarding_complete?: boolean;
  creator_verified?: boolean;
  verification_badge?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuthRequest extends Request {
  user?: User
  userId?: string
  session?: {
    id: string
    isAnonymous: boolean
    tableLimit: number
  }
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
const IS_MOCK_DB = process.env.DB_MOCK === 'true';
// jsonwebtoken@9 types are strict for expiresIn; use a compatible type
const JWT_EXPIRES_IN: jwt.SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN as any) || '7d';

if (JWT_SECRET === 'your-secret-key-change-in-production') {
  logger.warn('⚠️  Using default JWT_SECRET - please set a secure secret in production!');
}

// ============================================================================
// TOKEN GENERATION
// ============================================================================

// Accept either separate fields or a user-like object
export function generateToken(
  userOrId: { id: string; email: string; role: string } | string,
  email?: string,
  role?: string
): string {
  const payload =
    typeof userOrId === 'string'
      ? { userId: userOrId, email: email as string, role: role as string }
      : { userId: userOrId.id, email: userOrId.email, role: userOrId.role };

  return jwt.sign(payload, JWT_SECRET as jwt.Secret, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function generateRefreshToken(userIdOrUser: string | { id: string }): string {
  const uid = typeof userIdOrUser === 'string' ? userIdOrUser : userIdOrUser.id;
  return jwt.sign({ userId: uid }, JWT_SECRET as jwt.Secret, { expiresIn: '30d' });
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get token from Authorization header
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
      
      res.status(401).json({ 
        error: 'Invalid token',
        message: 'Authentication failed' 
      });
      return;
    }

    let user: User;
    if (IS_MOCK_DB) {
      const mock = getMockUserById(decoded.userId);
      if (!mock) {
        res.status(401).json({
          error: 'User not found',
          message: 'Authentication failed',
        });
        return;
      }
      user = sanitizeMockUser(mock);
    } else {
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
          message: 'Authentication failed' 
        });
        return;
      }

      user = result.rows[0] as User;
    }

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
        req.user = result.rows[0] as User;
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

// ============================================================================
// CONVENIENCE ROLE GUARDS
// ============================================================================

export const requireArtist = requireRole('artist', 'admin');
export const requireAdmin = requireRole('admin');
export const requireCustomer = requireRole('customer', 'artist', 'admin');

// ============================================================================
// RESOURCE OWNERSHIP MIDDLEWARE
// ============================================================================

export function requireOwnership(
  req: AuthRequest, 
  res: Response, 
  next: NextFunction
): void {
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

// ============================================================================
// MODEL OWNERSHIP MIDDLEWARE
// ============================================================================

export async function requireModelOwnership(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'You must be logged in' 
      });
      return;
    }

    const modelId = req.params.id;

    // Admins can access anything
    if (req.user.role === 'admin') {
      next();
      return;
    }

    if (IS_MOCK_DB) {
      // In mock mode, models are stored in-memory within the routes module.
      // We assume authenticated artists are only acting on their own records.
      next();
      return;
    }

    // Check if user owns the model
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
        message: 'You do not own this model' 
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
// REFRESH TOKEN
// ============================================================================

export async function refreshAccessToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ 
        error: 'Bad request',
        message: 'Refresh token is required' 
      });
      return;
    }

    // Verify refresh token
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload;
    } catch (error) {
      res.status(401).json({ 
        error: 'Invalid token',
        message: 'Refresh token is invalid or expired' 
      });
      return;
    }

    // Fetch user
    let user: User;
    if (IS_MOCK_DB) {
      const mock = getMockUserById(decoded.userId);
      if (!mock || mock.account_status !== 'active') {
        res.status(401).json({
          error: 'User not found',
          message: 'Invalid refresh token',
        });
        return;
      }
      user = sanitizeMockUser(mock);
    } else {
      const result = await db.query(
        `SELECT id, email, display_name, role, account_status
         FROM users 
         WHERE id = $1 AND account_status = 'active'`,
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        res.status(401).json({ 
          error: 'User not found',
          message: 'Invalid refresh token' 
        });
        return;
      }

      user = result.rows[0] as User;
    }

    // Generate new tokens
    const newAccessToken = generateToken(user.id, user.email, user.role);
    const newRefreshToken = generateRefreshToken(user.id);

    logger.info('Token refreshed', { userId: user.id });

    res.json({
      success: true,
      data: {
        token: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role
        }
      }
    });
  } catch (error) {
    logger.error('Token refresh error', { error });
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to refresh token' 
    });
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function isAdmin(req: AuthRequest): boolean {
  return req.user?.role === 'admin';
}

export function isArtist(req: AuthRequest): boolean {
  return req.user?.role === 'artist' || req.user?.role === 'admin';
}

export function isAuthenticated(req: AuthRequest): boolean {
  return !!req.user;
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
  refreshAccessToken,
  generateToken,
  generateRefreshToken,
  isAdmin,
  isArtist,
  isAuthenticated
};
