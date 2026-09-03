import apiClient from '../client'

// A stable per-tab session id so placement events can later be deduped into
// "distinct table plans" without identifying the user.
function sessionId(): string {
  try {
    let s = sessionStorage.getItem('aa_sid')
    if (!s) {
      s = Math.random().toString(36).slice(2) + Date.now().toString(36)
      sessionStorage.setItem('aa_sid', s)
    }
    return s
  } catch {
    return 'anon'
  }
}

export const analyticsApi = {
  /** Fire-and-forget: a model was placed on a planner table (purchase intent). */
  placement: (modelId: string): void => {
    apiClient.post('/api/analytics/placement', { modelId, sessionId: sessionId() }).catch(() => {})
  },
}
