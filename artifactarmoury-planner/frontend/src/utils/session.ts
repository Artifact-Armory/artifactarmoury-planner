const SESSION_STORAGE_KEY = 'terrain_builder_session'
const SESSION_HEADER = 'x-session-id'

const hasWindow = typeof window !== 'undefined'

export function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const random = Math.random().toString(16).slice(2)
  return `${Date.now()}-${random}`
}

export function readSessionId(): string | null {
  if (!hasWindow) {
    return null
  }
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeSessionId(id: string): void {
  if (!hasWindow) {
    return
  }
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, id)
  } catch {
    // ignore storage failures
  }
}

export function ensureSessionId(): string | null {
  if (!hasWindow) return null
  let id = readSessionId()
  if (!id) {
    id = generateSessionId()
    storeSessionId(id)
  }
  return id
}

export function applySessionHeader(headers: Record<string, unknown>): void {
  const id = ensureSessionId()
  if (id) {
    headers[SESSION_HEADER] = id
  }
}

export function syncSessionFromResponse(headerValue?: string | null): void {
  if (!headerValue) return
  const current = readSessionId()
  if (headerValue && headerValue !== current) {
    storeSessionId(headerValue)
  }
}

export { SESSION_HEADER, SESSION_STORAGE_KEY }
