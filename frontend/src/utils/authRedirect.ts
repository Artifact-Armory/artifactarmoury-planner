// Where to send someone after they sign in or create an account.
//
// Pages that need an account (checkout, a protected page) send people to
// /login?next=/checkout or /register?next=/checkout, or (ProtectedRoute) pass
// the page in router state. Only same-site paths are honoured, so a crafted
// link can't bounce a fresh login to another website.

export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  // Don't loop back into the auth pages themselves.
  if (/^\/(login|register|forgot-password|reset-password)(\/|\?|$)/.test(raw)) return null
  return raw
}

/** The post-auth destination from ?next= or router state ({ from: location }). */
export function nextFromLocation(location: { search: string; state?: unknown }): string | null {
  const fromQuery = safeNext(new URLSearchParams(location.search).get('next'))
  if (fromQuery) return fromQuery
  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
  if (from?.pathname) return safeNext(from.pathname + (from.search ?? ''))
  return null
}

/** Build /login or /register with the destination carried along. */
export function authPath(page: 'login' | 'register', next: string | null): string {
  return next ? `/${page}?next=${encodeURIComponent(next)}` : `/${page}`
}
