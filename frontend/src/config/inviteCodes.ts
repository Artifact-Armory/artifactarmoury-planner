/**
 * Invite codes that unlock the site during the private/invite-only period.
 *
 * This is a FRONTEND-ONLY gate (deliberate choice — see the pop-up trade-off
 * discussion that picked this over a backend-verified one): every code below
 * ships inside the public JS bundle, so it's a speed-bump for casual visitors,
 * not real access control. Anyone who opens devtools can read this list, and
 * because there's no server involved there's no way to see who used which
 * code, cap how many times one works, or revoke a single person without
 * redeploying the frontend with them removed.
 *
 * If that ever needs to be real security (e.g. paid-only access, per-user
 * tracking), replace this with a backend-verified check instead: a small
 * `invite_codes` table + `POST /api/invite/verify`, mirroring how e.g.
 * `services/vat.ts` keeps rates server-side so the client can't disagree with
 * the source of truth.
 *
 * To change who can get in: edit this list and redeploy the frontend
 * (`git push` to `main` — see CLAUDE.md).
 */
const RAW_CODES: readonly string[] = [
  'ARMOURY-FOUNDER',
  'ARMOURY-BETA',
  'ARMOURY-ARTIST',
]

export const INVITE_CODES: ReadonlySet<string> = new Set(
  RAW_CODES.map((c) => c.trim().toUpperCase())
)

export function isValidInviteCode(input: string): boolean {
  const normalized = input.trim().toUpperCase()
  return normalized.length > 0 && INVITE_CODES.has(normalized)
}
