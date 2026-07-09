import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import { authApi } from '../../api/endpoints/auth'

/**
 * Soft-gate banner: shown site-wide while the signed-in user hasn't verified
 * their email. Browsing stays open, but uploading models and checkout are
 * blocked by the backend until they click the link. Lets them re-send it.
 */
const VerifyEmailBanner: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [sending, setSending] = useState(false)

  // Only nag verified-pending accounts. `emailVerified === undefined` (e.g. an
  // older cached session before the field existed) is treated as "unknown" and
  // hidden to avoid a false alarm — /me refresh will populate it.
  if (!isAuthenticated || !user || user.emailVerified !== false) return null

  const resend = async () => {
    setSending(true)
    try {
      const res = await authApi.resendVerification()
      toast.success(res.message || 'Verification email sent — check your inbox.')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not send the email. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-amber-800">
        <span>
          <strong className="font-semibold">Verify your email</strong> to unlock uploading and
          purchasing. We sent a link to {user.email}.
        </span>
        <button
          type="button"
          onClick={resend}
          disabled={sending}
          className="font-medium underline underline-offset-2 hover:text-amber-900 disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Resend email'}
        </button>
      </div>
    </div>
  )
}

export default VerifyEmailBanner
