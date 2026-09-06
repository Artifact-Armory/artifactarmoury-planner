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
  refreshAccessToken,
  invalidateUserTokens,
  JWT_SECRET,
} from '../middleware/auth';
import { authRateLimit, emailRateLimit } from '../middleware/security';
import { asyncHandler } from '../middleware/error';
import { ValidationError, ConflictError, AuthenticationError } from '../middleware/error';
import { sendVerificationEmail, sendPasswordResetEmail, sendPasswordChangedEmail } from '../services/email';
import {
  generateTotpSecret,
  buildOtpauthUrl,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  hashBackupCode,
} from '../services/totp';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';

const router = Router();

// Same secret the auth middleware verifies with (imported, not re-read from env here —
// 2026-09-05 audit: this used to be its own independent `process.env.JWT_SECRET ||
// 'your-secret-...'` fallback, a second copy of the same weak-default footgun) — used
// to sign the short-lived "2FA challenge" token issued between the password step and
// the code step.

/**
 * Finish a successful sign-in: record last-login, log the activity, mint the
 * session tokens and send the standard login response. Shared by the normal
 * password login and the 2FA-completion step so both return an identical shape.
 */
async function completeLogin(user: any, req: any, res: any): Promise<void> {
  await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address, user_agent)
     VALUES ($1, 'user.login', 'user', $2, $3)`,
    [user.id, req.ip, req.get('user-agent')]
  );

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
      emailVerified: user.email_verified,
      isSuperAdmin: user.is_super_admin,
      artistName: user.artist_name,
      artistBio: user.artist_bio,
      artistUrl: user.artist_url,
      stripeOnboardingComplete: user.stripe_onboarding_complete,
      twoFactorEnabled: user.totp_enabled ?? false,
    },
    accessToken,
    refreshToken,
  });
}

// ============================================================================
// EMAIL VERIFICATION HELPERS
// ============================================================================

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a fresh verification token, persist its HASH (+ 24h expiry) on the
 * user, and email the raw token as a link. Fire-and-forget on the email itself
 * so a mail hiccup never fails signup — the user can always request a resend.
 */
async function issueVerificationEmail(user: {
  id: string;
  email: string;
  display_name: string;
}): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

  await db.query(
    `UPDATE users
       SET email_verification_token = $1, email_verification_expires = $2
     WHERE id = $3`,
    [tokenHash, expires, user.id]
  );

  sendVerificationEmail({
    to: user.email,
    name: user.display_name,
    token: rawToken,
  }).catch((err) =>
    logger.error('Failed to send verification email', { error: err, userId: user.id })
  );
}

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

  // Send the email-verification link (async, don't block the response).
  await issueVerificationEmail(user);

  res.status(201).json({
    message: 'Account created successfully. Please check your email to verify your address.',
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      emailVerified: false
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

  // Validate invite code. Note: we deliberately do NOT filter on `used_by IS NULL`
  // here — that column only records the *first* redeemer, so filtering on it broke
  // multi-use codes (max_uses > 1) after a single redemption. Capacity is enforced
  // by the `current_uses >= max_uses` check below instead.
  const inviteResult = await db.query(
    `SELECT id, max_uses, current_uses, expires_at
     FROM invite_codes
     WHERE code = $1`,
    [inviteCode]
  );

  if (inviteResult.rows.length === 0) {
    throw new ValidationError('Invalid invite code');
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

    // Update invite code. Record the first redeemer only (COALESCE), so a multi-use
    // code keeps a stable `used_by`/`used_at` while `current_uses` tracks the count.
    await client.query(
      `UPDATE invite_codes
       SET used_by = COALESCE(used_by, $1),
           current_uses = current_uses + 1,
           used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
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

    // Send the email-verification link (the user row is committed at this point).
    await issueVerificationEmail(user);

    res.status(201).json({
      message: 'Artist account created successfully. Please check your email to verify your address.',
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        artistName: user.artist_name,
        emailVerified: false,
        stripeOnboardingComplete: false,
        twoFactorEnabled: false
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
            email_verified, is_super_admin, artist_name, artist_bio, artist_url,
            stripe_account_id, stripe_onboarding_complete, totp_enabled
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

  // Two-factor gate: if the account has 2FA on, the password alone isn't enough.
  // Issue a short-lived challenge token instead of the real session, and require
  // the code via POST /login/2fa. We reveal nothing extra — the password was valid.
  if (user.totp_enabled) {
    const challengeToken = jwt.sign(
      { purpose: '2fa', userId: user.id },
      JWT_SECRET as jwt.Secret,
      { expiresIn: '5m' }
    );
    logger.info('2FA challenge issued at login', { userId: user.id });
    res.json({ twoFactorRequired: true, challengeToken });
    return;
  }

  await completeLogin(user, req, res);
}));

// ============================================================================
// LOGIN — 2FA STEP (complete a sign-in that requires a one-time code)
// ============================================================================

router.post('/login/2fa', authRateLimit, asyncHandler(async (req, res) => {
  const { challengeToken, code } = req.body;

  if (!challengeToken || !code) {
    throw new ValidationError('A code and challenge token are required');
  }

  // The challenge token proves the password step just succeeded for this user.
  let payload: any;
  try {
    payload = jwt.verify(challengeToken, JWT_SECRET);
  } catch {
    throw new AuthenticationError('Your sign-in session expired — please log in again.');
  }
  if (payload?.purpose !== '2fa' || !payload?.userId) {
    throw new AuthenticationError('Invalid sign-in session — please log in again.');
  }

  const result = await db.query(
    `SELECT id, email, password_hash, display_name, role, account_status,
            email_verified, is_super_admin, artist_name, artist_bio, artist_url,
            stripe_account_id, stripe_onboarding_complete,
            totp_enabled, totp_secret, totp_backup_codes
     FROM users
     WHERE id = $1`,
    [payload.userId]
  );

  if (result.rows.length === 0 || !result.rows[0].totp_enabled || !result.rows[0].totp_secret) {
    throw new AuthenticationError('Two-factor authentication is not set up for this account.');
  }

  const user = result.rows[0];

  // Re-check account status (it may have changed since the password step).
  if (user.account_status === 'suspended') {
    throw new AuthenticationError('Your account has been suspended. Please contact support.');
  }
  if (user.account_status === 'banned') {
    throw new AuthenticationError('Your account has been banned.');
  }

  const submitted = String(code).replace(/\s+/g, '');

  // Try the TOTP code first, then fall back to a single-use backup code.
  let ok = verifyTotp(decryptSecret(user.totp_secret), submitted);

  if (!ok && /^[A-Za-z0-9-]{6,}$/.test(submitted)) {
    const codes: string[] = Array.isArray(user.totp_backup_codes) ? user.totp_backup_codes : [];
    const submittedHash = hashBackupCode(submitted);
    const idx = codes.indexOf(submittedHash);
    if (idx !== -1) {
      ok = true;
      // Burn the used backup code so it can't be reused.
      const remaining = codes.filter((_, i) => i !== idx);
      await db.query('UPDATE users SET totp_backup_codes = $1 WHERE id = $2', [
        JSON.stringify(remaining),
        user.id,
      ]);
      logger.info('2FA backup code used at login', { userId: user.id, remaining: remaining.length });
    }
  }

  if (!ok) {
    logger.warn('Failed 2FA attempt', { userId: user.id, ip: req.ip });
    throw new AuthenticationError('That code is incorrect or has expired.');
  }

  await completeLogin(user, req, res);
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
            email_verified, is_super_admin, artist_name, artist_bio, artist_url,
            stripe_account_id, stripe_onboarding_complete, totp_enabled,
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
      emailVerified: user.email_verified,
      isSuperAdmin: user.is_super_admin,
      artistName: user.artist_name,
      artistBio: user.artist_bio,
      artistUrl: user.artist_url,
      stripeOnboardingComplete: user.stripe_onboarding_complete,
      twoFactorEnabled: user.totp_enabled ?? false,
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

  // Store reset token hash (never the raw token — mirrors email verification)
  await db.query(
    `UPDATE users
     SET password_reset_token = $1, password_reset_expires = $2
     WHERE id = $3`,
    [resetTokenHash, resetTokenExpiry, user.id]
  );

  // Send reset email
  await sendPasswordResetEmail({
    to: user.email,
    name: user.display_name,
    token: resetToken,
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

  // SECURITY (2026-09-05 audit): a password reset is the exact moment an account may
  // have just been recovered from a compromise — any session token issued before this
  // must stop working, not just future logins with the old password.
  await invalidateUserTokens(user.id);

  // Log activity
  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address)
     VALUES ($1, 'password.reset', 'user', $2)`,
    [user.id, req.ip]
  );

  logger.info('Password reset completed', { userId: user.id });

  // Send confirmation email (best-effort — the reset already succeeded)
  sendPasswordChangedEmail({ to: user.email, name: user.display_name })
    .catch(err => logger.error('Failed to send password changed email', { error: err }));

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

  // SECURITY (2026-09-05 audit): invalidate every OTHER session — the current
  // request already passed `authenticate` before this handler ran, so it isn't
  // affected, but any other captured/leaked token for this account stops working
  // as of now rather than surviving up to its full 7/30-day lifetime.
  await invalidateUserTokens((req as any).userId);

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
// VERIFY EMAIL
// ============================================================================

// Public: the token itself is the proof of ownership (the user may not be logged
// in when they click the link from their inbox).
router.post('/verify-email', authRateLimit, asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    throw new ValidationError('Verification token is required');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const result = await db.query(
    `SELECT id, email, email_verified
       FROM users
      WHERE email_verification_token = $1
        AND email_verification_expires > CURRENT_TIMESTAMP`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    // Either the token never matched, or it expired / was already consumed.
    throw new ValidationError('This verification link is invalid or has expired. Please request a new one.');
  }

  const user = result.rows[0];

  await db.query(
    `UPDATE users
        SET email_verified = true,
            email_verification_token = NULL,
            email_verification_expires = NULL
      WHERE id = $1`,
    [user.id]
  );

  logger.info('Email verified', { userId: user.id, email: user.email });

  res.json({ message: 'Email verified successfully', emailVerified: true });
}));

// ============================================================================
// RESEND VERIFICATION EMAIL
// ============================================================================

router.post('/resend-verification', authenticate, emailRateLimit, asyncHandler(async (req, res) => {
  const userId = (req as any).userId;

  const result = await db.query(
    'SELECT id, email, display_name, email_verified FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AuthenticationError('User not found');
  }

  const user = result.rows[0];

  if (user.email_verified) {
    res.json({ message: 'Your email is already verified' });
    return;
  }

  await issueVerificationEmail(user);

  logger.info('Verification email resent', { userId: user.id, email: user.email });

  res.json({ message: 'Verification email sent. Please check your inbox.' });
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

// ============================================================================
// TWO-FACTOR AUTHENTICATION (TOTP) — enrolment & management
// ============================================================================

// Current 2FA state for the signed-in user (drives the security settings UI).
router.get('/2fa/status', authenticate, asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT totp_enabled, totp_secret, totp_backup_codes, totp_enrolled_at FROM users WHERE id = $1',
    [(req as any).userId]
  );
  if (result.rows.length === 0) throw new AuthenticationError('User not found');
  const u = result.rows[0];
  res.json({
    enabled: !!u.totp_enabled,
    // A secret exists but isn't confirmed yet → the user began setup and stopped.
    pending: !u.totp_enabled && !!u.totp_secret,
    enrolledAt: u.totp_enrolled_at ?? null,
    backupCodesRemaining: Array.isArray(u.totp_backup_codes) ? u.totp_backup_codes.length : 0,
  });
}));

// Begin enrolment: mint a fresh secret (stored pending, encrypted), and return the
// otpauth URL + a scannable QR + the manual-entry key. Does NOT enable 2FA yet.
router.post('/2fa/setup', authenticate, asyncHandler(async (req, res) => {
  const userId = (req as any).userId;

  const cur = await db.query('SELECT email, totp_enabled FROM users WHERE id = $1', [userId]);
  if (cur.rows.length === 0) throw new AuthenticationError('User not found');
  if (cur.rows[0].totp_enabled) {
    throw new ConflictError('Two-factor authentication is already enabled. Disable it first to re-enrol.');
  }

  const secret = generateTotpSecret();
  const otpauthUrl = buildOtpauthUrl(secret, cur.rows[0].email);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });

  // Store the pending (not-yet-confirmed) secret encrypted at rest.
  await db.query('UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2', [
    encryptSecret(secret),
    userId,
  ]);

  res.json({ secret, otpauthUrl, qrDataUrl });
}));

// Confirm enrolment: verify a code against the pending secret, turn 2FA on, and
// return one-time backup codes (shown to the user ONCE — we only store hashes).
router.post('/2fa/enable', authenticate, asyncHandler(async (req, res) => {
  const userId = (req as any).userId;
  const { code } = req.body;
  if (!code) throw new ValidationError('Enter the 6-digit code from your authenticator app');

  const cur = await db.query('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId]);
  if (cur.rows.length === 0) throw new AuthenticationError('User not found');
  if (cur.rows[0].totp_enabled) {
    throw new ConflictError('Two-factor authentication is already enabled.');
  }
  if (!cur.rows[0].totp_secret) {
    throw new ValidationError('Start two-factor setup first.');
  }

  const secret = decryptSecret(cur.rows[0].totp_secret);
  if (!verifyTotp(secret, String(code))) {
    throw new ValidationError('That code is incorrect or has expired — try the current one.');
  }

  const { plain, hashed } = generateBackupCodes(10);
  await db.query(
    `UPDATE users
        SET totp_enabled = true,
            totp_backup_codes = $1,
            totp_enrolled_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [JSON.stringify(hashed), userId]
  );

  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address)
     VALUES ($1, '2fa.enabled', 'user', $2)`,
    [userId, req.ip]
  );
  logger.info('2FA enabled', { userId });

  res.json({ message: 'Two-factor authentication is on.', backupCodes: plain });
}));

// Turn 2FA off. Requires the account password as a re-authentication step so a
// hijacked session can't quietly strip the protection.
router.post('/2fa/disable', authenticate, asyncHandler(async (req, res) => {
  const userId = (req as any).userId;
  const { password } = req.body;
  if (!password) throw new ValidationError('Enter your password to disable two-factor authentication');

  const cur = await db.query('SELECT password_hash, totp_enabled FROM users WHERE id = $1', [userId]);
  if (cur.rows.length === 0) throw new AuthenticationError('User not found');
  if (!cur.rows[0].totp_enabled) {
    res.json({ message: 'Two-factor authentication is already off.' });
    return;
  }

  const valid = await bcrypt.compare(password, cur.rows[0].password_hash);
  if (!valid) throw new AuthenticationError('Password is incorrect');

  await db.query(
    `UPDATE users
        SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL, totp_enrolled_at = NULL
      WHERE id = $1`,
    [userId]
  );

  // SECURITY (2026-09-05 audit): disabling 2FA removes a factor an attacker with a
  // captured token would otherwise still need — invalidate other sessions here too,
  // same reasoning as password change/reset above.
  await invalidateUserTokens(userId);

  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, ip_address)
     VALUES ($1, '2fa.disabled', 'user', $2)`,
    [userId, req.ip]
  );
  logger.info('2FA disabled', { userId });

  res.json({ message: 'Two-factor authentication has been turned off.' });
}));

export default router;
