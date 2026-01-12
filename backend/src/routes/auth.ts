// backend/src/routes/auth.ts
// Authentication routes: register, login, password reset, etc.

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db';
import logger from '../utils/logger';
import { validateEmail, validatePassword, sanitizeString } from '../utils/validation';
import { 
  generateToken, 
  generateRefreshToken, 
  authenticate,
  refreshAccessToken 
} from '../middleware/auth';
import { authRateLimit, emailRateLimit } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { ValidationError, ConflictError, AuthenticationError } from '../middleware/error';
import { sendEmail } from '../services/email';
import crypto from 'crypto';

const router = Router();

// ============================================================================
// REGISTER (Customer)
// ============================================================================

router.post('/register', authRateLimit, asyncHandler(async (req, res) => {
  const { email, password, displayName } = req.body;

  // Validate input
  if (!email || !password || !displayName) {
    throw new ValidationError('Email, password, and display name are required');
  }

  validateEmail(email);
  validatePassword(password);

  if (displayName.length < 2 || displayName.length > 100) {
    throw new ValidationError('Display name must be between 2 and 100 characters');
  }

  // Check if user already exists
  const existingUser = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (existingUser.rows.length > 0) {
    throw new ConflictError('An account with this email already exists');
  }

  // Hash password
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Create user
  const result = await db.query(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'customer')
     RETURNING id, email, display_name, role, created_at`,
    [email.toLowerCase(), passwordHash, sanitizeString(displayName)]
  );

  const user = result.rows[0];

  // Generate tokens
  const accessToken = generateToken(user);
  const refreshToken = generateRefreshToken(user);

  // Log activity
  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address, user_agent)
     VALUES ($1, 'user.registered', 'user', $2, $3)`,
    [user.id, req.ip, req.get('user-agent')]
  );

  logger.info('User registered', { userId: user.id, email: user.email });

  // Send welcome email (async, don't wait)
  sendEmail({
    to: user.email,
    subject: 'Welcome to Terrain Builder',
    html: `<p>Hi ${user.display_name}, welcome to Terrain Builder!</p>`
  }).catch(err => logger.error('Failed to send welcome email', { error: err }));

  res.status(201).json({
    message: 'Account created successfully',
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role
    },
    accessToken,
    refreshToken
  });
}));

// ============================================================================
// REGISTER (Artist - With Invite Code)
// ============================================================================

router.post('/register/artist', authRateLimit, asyncHandler(async (req, res) => {
  const { email, password, displayName, artistName, inviteCode } = req.body;

  // Validate input
  if (!email || !password || !displayName || !artistName || !inviteCode) {
    throw new ValidationError('All fields are required including invite code');
  }

  validateEmail(email);
  validatePassword(password);

  // Validate invite code
  const inviteResult = await db.query(
    `SELECT id, max_uses, current_uses, expires_at 
     FROM invite_codes 
     WHERE code = $1 AND used_by IS NULL`,
    [inviteCode]
  );

  if (inviteResult.rows.length === 0) {
    throw new ValidationError('Invalid or already used invite code');
  }

  const invite = inviteResult.rows[0];

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    throw new ValidationError('Invite code has expired');
  }

  if (invite.current_uses >= invite.max_uses) {
    throw new ValidationError('Invite code has reached maximum uses');
  }

  // Check if user already exists
  const existingUser = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (existingUser.rows.length > 0) {
    throw new ConflictError('An account with this email already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Create artist user (with transaction)
  const client = await (db as any).getClient?.() ?? await db.connect();
  
  try {
    await client.query('BEGIN');

    // Create user
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, display_name, role, artist_name)
       VALUES ($1, $2, $3, 'artist', $4)
       RETURNING id, email, display_name, role, artist_name, created_at`,
      [email.toLowerCase(), passwordHash, sanitizeString(displayName), sanitizeString(artistName)]
    );

    const user = userResult.rows[0];

    // Update invite code
    await client.query(
      `UPDATE invite_codes 
       SET used_by = $1, current_uses = current_uses + 1, used_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [user.id, invite.id]
    );

    // Log activity
    await client.query(
      `INSERT INTO activity_log (user_id, action, resource_type, metadata, ip_address, user_agent)
       VALUES ($1, 'artist.registered', 'user', $2, $3, $4)`,
      [user.id, JSON.stringify({ inviteCode }), req.ip, req.get('user-agent')]
    );

    await client.query('COMMIT');

    // Generate tokens
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    logger.info('Artist registered', { userId: user.id, email: user.email, artistName: user.artist_name });

    // Send welcome email
    sendEmail({
      to: user.email,
      subject: 'Welcome to Terrain Builder - Artist Account',
      html: `<p>Hi ${user.display_name}, your artist account (${user.artist_name}) is ready.</p>`
    }).catch(err => logger.error('Failed to send artist welcome email', { error: err }));

    res.status(201).json({
      message: 'Artist account created successfully',
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        artistName: user.artist_name,
        stripeOnboardingComplete: false
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// ============================================================================
// LOGIN
// ============================================================================

router.post('/login', authRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ValidationError('Email and password are required');
  }

  // Find user
  const result = await db.query(
    `SELECT id, email, password_hash, display_name, role, account_status,
            artist_name, artist_bio, artist_url, 
            stripe_account_id, stripe_onboarding_complete
     FROM users 
     WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw new AuthenticationError('Invalid email or password');
  }

  const user = result.rows[0];

  // Check account status
  if (user.account_status === 'suspended') {
    throw new AuthenticationError('Your account has been suspended. Please contact support.');
  }

  if (user.account_status === 'banned') {
    throw new AuthenticationError('Your account has been banned.');
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password_hash);

  if (!isValidPassword) {
    logger.warn('Failed login attempt', { email, ip: req.ip });
    throw new AuthenticationError('Invalid email or password');
  }

  // Update last login
  await db.query(
    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
    [user.id]
  );

  // Log activity
  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address, user_agent)
     VALUES ($1, 'user.login', 'user', $2, $3)`,
    [user.id, req.ip, req.get('user-agent')]
  );

  // Generate tokens
  const accessToken = generateToken(user);
  const refreshToken = generateRefreshToken(user);

  logger.info('User logged in', { userId: user.id, email: user.email });

  res.json({
    message: 'Login successful',
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      artistName: user.artist_name,
      artistBio: user.artist_bio,
      artistUrl: user.artist_url,
      stripeOnboardingComplete: user.stripe_onboarding_complete
    },
    accessToken,
    refreshToken
  });
}));

// ============================================================================
// REFRESH TOKEN
// ============================================================================

router.post('/refresh', refreshAccessToken);

// ============================================================================
// LOGOUT
// ============================================================================

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  // Log activity
  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address)
     VALUES ($1, 'user.logout', 'user', $2)`,
    [(req as any).userId, req.ip]
  );

  logger.info('User logged out', { userId: (req as any).userId });

  res.json({ message: 'Logged out successfully' });
}));

// ============================================================================
// GET CURRENT USER
// ============================================================================

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, email, display_name, role, account_status,
            artist_name, artist_bio, artist_url,
            stripe_account_id, stripe_onboarding_complete,
            created_at, updated_at
     FROM users 
     WHERE id = $1`,
    [(req as any).userId]
  );

  if (result.rows.length === 0) {
    throw new AuthenticationError('User not found');
  }

  const user = result.rows[0];

  res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      accountStatus: user.account_status,
      artistName: user.artist_name,
      artistBio: user.artist_bio,
      artistUrl: user.artist_url,
      stripeOnboardingComplete: user.stripe_onboarding_complete,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    }
  });
}));

// ============================================================================
// REQUEST PASSWORD RESET
// ============================================================================

router.post('/password-reset/request', emailRateLimit, asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ValidationError('Valid email address is required');
  }
  validateEmail(email);

  // Find user
  const result = await db.query(
    'SELECT id, email, display_name FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  // Always return success to prevent email enumeration
  if (result.rows.length === 0) {
    logger.info('Password reset requested for non-existent email', { email });
    res.json({ message: 'If an account exists, a password reset email has been sent' });
    return;
  }

  const user = result.rows[0];

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Store reset token (you might want to add a password_reset_tokens table)
  await db.query(
    `UPDATE users 
     SET password_reset_token = $1, password_reset_expires = $2
     WHERE id = $3`,
    [resetTokenHash, resetTokenExpiry, user.id]
  );

  // Send reset email
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  await sendEmail({
    to: user.email,
    subject: 'Password Reset Request',
    html: `<p>Hi ${user.display_name}, reset your password using <a href="${resetUrl}">this link</a>. The link expires in 60 minutes.</p>`
  });

  logger.info('Password reset email sent', { userId: user.id, email: user.email });

  res.json({ message: 'If an account exists, a password reset email has been sent' });
}));

// ============================================================================
// RESET PASSWORD
// ============================================================================

router.post('/password-reset/confirm', authRateLimit, asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    throw new ValidationError('Reset token and new password are required');
  }

  validatePassword(newPassword);

  // Hash the token to compare with stored hash
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with valid reset token
  const result = await db.query(
    `SELECT id, email, display_name 
     FROM users 
     WHERE password_reset_token = $1 
       AND password_reset_expires > CURRENT_TIMESTAMP`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    throw new ValidationError('Invalid or expired reset token');
  }

  const user = result.rows[0];

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 12);

  // Update password and clear reset token
  await db.query(
    `UPDATE users 
     SET password_hash = $1, 
         password_reset_token = NULL, 
         password_reset_expires = NULL
     WHERE id = $2`,
    [passwordHash, user.id]
  );

  // Log activity
  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address)
     VALUES ($1, 'password.reset', 'user', $2)`,
    [user.id, req.ip]
  );

  logger.info('Password reset completed', { userId: user.id });

  // Send confirmation email
  sendEmail({
    to: user.email,
    subject: 'Password Changed Successfully',
    html: `<p>Hi ${user.display_name}, your password has been changed successfully.</p>`
  }).catch(err => logger.error('Failed to send password changed email', { error: err }));

  res.json({ message: 'Password has been reset successfully' });
}));

// ============================================================================
// CHANGE PASSWORD (Authenticated)
// ============================================================================

router.post('/password/change', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ValidationError('Current password and new password are required');
  }

  validatePassword(newPassword);

  // Get user's current password
  const result = await db.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [(req as any).userId]
  );

  const user = result.rows[0];

  // Verify current password
  const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);

  if (!isValidPassword) {
    throw new AuthenticationError('Current password is incorrect');
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 12);

  // Update password
  await db.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [passwordHash, (req as any).userId]
  );

  // Log activity
  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address)
     VALUES ($1, 'password.changed', 'user', $2)`,
    [(req as any).userId, req.ip]
  );

  logger.info('Password changed', { userId: (req as any).userId });

  res.json({ message: 'Password changed successfully' });
}));

// ============================================================================
// VERIFY INVITE CODE
// ============================================================================

router.post('/invite/verify', asyncHandler(async (req, res) => {
  const { code } = req.body;

  if (!code) {
    throw new ValidationError('Invite code is required');
  }

  const result = await db.query(
    `SELECT id, max_uses, current_uses, expires_at, created_by
     FROM invite_codes 
     WHERE code = $1`,
    [code]
  );

  if (result.rows.length === 0) {
    res.json({ valid: false, message: 'Invalid invite code' });
    return;
  }

  const invite = result.rows[0];

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    res.json({ valid: false, message: 'Invite code has expired' });
    return;
  }

  if (invite.current_uses >= invite.max_uses) {
    res.json({ valid: false, message: 'Invite code has reached maximum uses' });
    return;
  }

  res.json({ valid: true, message: 'Invite code is valid' });
}));

export default router;
