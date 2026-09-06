// backend/src/middleware/auth.ts
// JWT authentication and authorization middleware

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import logger from '../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: 'customer' | 'artist' | 'admin';
  account_status: 'active' | 'suspended' | 'banned';
  email_verified?: boolean;
  is_super_admin?: boolean;
  shadow_banned?: boolean;
  totp_enabled?: boolean;
  artist_name?: string;
  artist_bio?: string;
  artist_url?: string;
  stripe_account_id?: string;
  stripe_onboarding_complete?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SessionInfo {
  id: string;
  isAnonymous: boolean;
  tableLimit: number;
}

export interface AuthRequest extends Request {
  user?: User;
  userId?: string;
  session?: SessionInfo;
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

// SECURITY (2026-09-05 audit): this used to fall back to a hardcoded literal
// ('your-secret-key-change-in-production') and only log a warning, so a deploy that
// forgot to set JWT_SECRET (a fresh preview/staging environment, a misconfigured
// container) would silently sign and verify every session with a secret sitting in
// this public repo — anyone could forge an admin JWT. .env.example documents this as
// required for every environment; fail fast instead of ever running on a known secret.
// (NODE_ENV=test is exempted so a future unit-test run that imports this module
// doesn't need a real secret configured.)
if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'test') {
  throw new Error(
    'JWT_SECRET environment variable is required and must not be left unset — refusing to start with a fallback secret.'
  );
}
export const JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-do-not-use-in-real-environments';
// jsonwebtoken@9 types are strict for expiresIn; use a compatible type
const JWT_EXPIRES_IN: jwt.SignOptions['expiresIn'] = (process.env.JWT_EXPIRES_IN as any) || '7d';

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

/**
 * Invalidate every access/refresh token issued for this user BEFORE this call
 * (2026-09-05 audit fix — see migration 060). Call this from password change,
 * password reset, and 2FA disable — the three points where a compromised existing
 * session should stop working, not just future logins requiring the new credential.
 *
 * Must be called BEFORE minting any new token in the same request/response: both
 * `tokens_valid_from` and a JWT's `iat` are compared at whole-second resolution, so
 * a token generated even a few ms after this resolves still passes (see
 * `isTokenStillValid` below) as long as it's generated after, not before.
 */
export async function invalidateUserTokens(userId: string): Promise<void> {
  await db.query('UPDATE users SET tokens_valid_from = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
}

/** Whether a decoded JWT's `iat` is on or after this user's invalidation watermark. */
function isTokenStillValid(decoded: JwtPayload, tokensValidFrom: string | Date | null): boolean {
  if (!tokensValidFrom || !decoded.iat) return true;
  const validFromSeconds = Math.floor(new Date(tokensValidFrom).getTime() / 1000);
  return decoded.iat >= validFromSeconds;
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

    // Fetch user from database
    const result = await db.query(
      `SELECT id, email, display_name, role, account_status, email_verified, is_super_admin, shadow_banned,
              totp_enabled, artist_name, artist_bio, artist_url,
              stripe_account_id, stripe_onboarding_complete,
              created_at, updated_at, tokens_valid_from
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

    const user = result.rows[0] as User & { tokens_valid_from: string | null };

    if (!isTokenStillValid(decoded, user.tokens_valid_from)) {
      res.status(401).json({
        error: 'Session invalidated',
        message: 'Your password or security settings changed — please log in again'
      });
      return;
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
        `SELECT id, email, display_name, role, account_status, email_verified, is_super_admin, shadow_banned,
                totp_enabled, artist_name, artist_bio, artist_url,
                stripe_account_id, stripe_onboarding_complete,
                created_at, updated_at, tokens_valid_from
         FROM users
         WHERE id = $1 AND account_status = 'active'`,
        [decoded.userId]
      );

      if (result.rows.length > 0 && isTokenStillValid(decoded, result.rows[0].tokens_valid_from)) {
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

/**
 * Super-admin (owner) only. Regular admins pass requireAdmin but not this — used
 * to fence off platform financials/analytics. Run after `authenticate`.
 */
export function requireSuperAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', message: 'You must be logged in' });
    return;
  }
  if (!req.user.is_super_admin) {
    res.status(403).json({
      error: 'Forbidden',
      code: 'SUPER_ADMIN_ONLY',
      message: 'This area is restricted to the site owner.'
    });
    return;
  }
  next();
}

// ============================================================================
// EMAIL-VERIFICATION GUARD (soft gate)
// ============================================================================

/**
 * Blocks sensitive actions (uploading models, checkout) until the account's
 * email is verified. Browsing, planner, and login remain open — this is the
 * "soft gate". Must run after `authenticate` (needs req.user populated).
 */
export function requireVerifiedEmail(
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

  if (!req.user.email_verified) {
    res.status(403).json({
      error: 'Email not verified',
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email address before doing this. Check your inbox for the verification link.'
    });
    return;
  }

  next();
}

// ============================================================================
// TWO-FACTOR GUARD (mandatory 2FA for sellers)
// ============================================================================

/**
 * Requires the account to have TOTP two-factor auth enabled before a sensitive
 * seller action (uploading/publishing models, bundles, payouts). Sellers hold
 * earnings and are phishing targets, so 2FA is mandatory for them. Admins are
 * exempt (internal accounts). Run after `authenticate`.
 *
 * On failure returns 403 with code `TWO_FACTOR_REQUIRED` so the client can send
 * the user to the security settings page to enrol.
 */
export function requireTwoFactor(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', message: 'You must be logged in' });
    return;
  }
  // Admins (internal) don't go through the seller 2FA gate.
  if (req.user.role === 'admin') {
    next();
    return;
  }
  if (!req.user.totp_enabled) {
    res.status(403).json({
      error: 'Two-factor authentication required',
      code: 'TWO_FACTOR_REQUIRED',
      message:
        'Set up two-factor authentication before selling on Artifact Armoury. Go to Security in your dashboard to enable it.',
    });
    return;
  }
  next();
}

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
    const result = await db.query(
      `SELECT id, email, display_name, role, account_status, email_verified, is_super_admin, tokens_valid_from
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

    const user = result.rows[0];

    if (!isTokenStillValid(decoded, user.tokens_valid_from)) {
      res.status(401).json({
        error: 'Session invalidated',
        message: 'Your password or security settings changed — please log in again'
      });
      return;
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
          role: user.role,
          emailVerified: user.email_verified,
          isSuperAdmin: user.is_super_admin
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
  requireSuperAdmin,
  requireVerifiedEmail,
  requireTwoFactor,
  requireOwnership,
  requireModelOwnership,
  refreshAccessToken,
  generateToken,
  generateRefreshToken,
  isAdmin,
  isArtist,
  isAuthenticated
};
