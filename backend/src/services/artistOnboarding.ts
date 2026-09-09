// backend/src/services/artistOnboarding.ts
//
// Shared rules for turning an account into a selling artist, so the three ways
// in cannot drift apart:
//   1. POST /auth/register/artist   — new account, invite code
//   2. POST /auth/upgrade-to-artist — existing customer, invite code
//   3. PATCH /admin/users/:id/role  — admin promotes directly, no code
//
// Before this module the invite rules were written out twice (register + verify)
// with subtly different behaviour, which is exactly how a capacity check ends up
// enforced on one path and not the other.

import { ValidationError } from '../middleware/error'

/**
 * Version of the seller terms currently being presented. Bump this whenever the
 * seller terms text materially changes, so `users.artist_terms_version` records
 * WHICH agreement each artist actually accepted — a bare timestamp stops being
 * evidence the moment the text is edited.
 */
export const SELLER_TERMS_VERSION = '2026-09-09'

export interface InviteRow {
  id: string
  max_uses: number
  current_uses: number
  expires_at: string | Date | null
}

export interface InviteCheck {
  valid: boolean
  message: string
}

/**
 * Pure predicate over an invite row. Returns a reason rather than throwing so
 * the "check this code for me" endpoint can answer without an error response,
 * while the redeeming paths turn the same result into a ValidationError.
 *
 * NB deliberately does NOT consider `used_by`: that column records only the
 * FIRST redeemer, so treating it as "spent" broke multi-use codes after one
 * redemption. Capacity is current_uses vs max_uses, nothing else.
 */
export function checkInvite(invite: InviteRow | undefined | null): InviteCheck {
  if (!invite) return { valid: false, message: 'Invalid invite code' }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { valid: false, message: 'Invite code has expired' }
  }
  if (Number(invite.current_uses) >= Number(invite.max_uses)) {
    return { valid: false, message: 'Invite code has reached maximum uses' }
  }
  return { valid: true, message: 'Invite code is valid' }
}

/** Same check, as an assertion, for the paths that are actually redeeming it. */
export function assertInviteUsable(invite: InviteRow | undefined | null): void {
  const result = checkInvite(invite)
  if (!result.valid) throw new ValidationError(result.message)
}

/**
 * Artist display name. Separate from the account's own display name because it
 * is what appears on every listing, so it gets its own length/blank rules.
 */
export function validateArtistName(name: unknown): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('Artist name is required')
  }
  const trimmed = name.trim()
  if (trimmed.length < 2) throw new ValidationError('Artist name must be at least 2 characters')
  if (trimmed.length > 80) throw new ValidationError('Artist name must be 80 characters or fewer')
  return trimmed
}

/**
 * Seller terms must be affirmatively accepted — never defaulted to true.
 * We take commission, hold the artist's files, and pay them out; that agreement
 * needs a real record, and a checkbox the server assumes is ticked is not one.
 */
export function assertTermsAccepted(accepted: unknown): void {
  if (accepted !== true) {
    throw new ValidationError('You must accept the seller terms to sell on the marketplace')
  }
}

/** SQL fragment shared by every path that grants the artist role. */
export const ARTIST_GRANT_COLUMNS = `
  role = 'artist',
  artist_name = $2,
  artist_terms_accepted_at = CURRENT_TIMESTAMP,
  artist_terms_version = $3,
  became_artist_at = COALESCE(became_artist_at, CURRENT_TIMESTAMP)
`
