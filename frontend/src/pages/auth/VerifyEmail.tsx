import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import Button from '../../components/ui/Button'
import { authApi } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'

type Status = 'idle' | 'verifying' | 'success' | 'error'

const VerifyEmail: React.FC = () => {
  const [params] = useSearchParams()
  const token = params.get('token')
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const setUser = useAuthStore((s) => s.setUser)

  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'idle')
  const [message, setMessage] = useState('')
  const [resending, setResending] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (!token || ran.current) return
    ran.current = true // StrictMode double-invoke guard — the token is single-use

    ;(async () => {
      try {
        await authApi.verifyEmail(token)
        setStatus('success')
        // Refresh the cached user so the "verify your email" banner clears and
        // gated actions unlock without a re-login (only if they're signed in).
        if (isAuthenticated) {
          try {
            const fresh = await authApi.getProfile()
            setUser(fresh)
          } catch {
            /* non-fatal — banner clears on next load */
          }
        }
      } catch (e: any) {
        setStatus('error')
        setMessage(
          e?.response?.data?.message ||
            'This verification link is invalid or has expired.',
        )
      }
    })()
  }, [token, isAuthenticated, setUser])

  const resend = async () => {
    setResending(true)
    try {
      const res = await authApi.resendVerification()
      toast.success(res.message || 'Verification email sent — check your inbox.')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not send the email. Please try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12 text-center">
      {status === 'verifying' && (
        <>
          <h1 className="text-2xl font-semibold text-gray-900">Verifying your email…</h1>
          <p className="mt-2 text-sm text-gray-500">This will only take a moment.</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl">
            ✓
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Email verified!</h1>
          <p className="mt-2 text-sm text-gray-500">
            Thanks — your account is fully unlocked. You can now upload models and make purchases.
          </p>
          <Link to="/" className="mt-6 inline-block">
            <Button>Continue</Button>
          </Link>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
            !
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Verification failed</h1>
          <p className="mt-2 text-sm text-gray-500">{message}</p>
          {isAuthenticated ? (
            <Button className="mt-6" onClick={resend} loading={resending}>
              Send a new link
            </Button>
          ) : (
            <p className="mt-6 text-sm text-gray-500">
              <Link to="/login" className="font-medium text-indigo-600 hover:underline">
                Sign in
              </Link>{' '}
              to request a new verification link.
            </p>
          )}
        </>
      )}

      {status === 'idle' && (
        <>
          <h1 className="text-2xl font-semibold text-gray-900">Verify your email</h1>
          <p className="mt-2 text-sm text-gray-500">
            We've sent a verification link to your email address. Click it to unlock uploading and
            purchasing.
          </p>
          {isAuthenticated ? (
            <Button className="mt-6" onClick={resend} loading={resending}>
              Resend verification email
            </Button>
          ) : (
            <p className="mt-6 text-sm text-gray-500">
              Didn't get it?{' '}
              <Link to="/login" className="font-medium text-indigo-600 hover:underline">
                Sign in
              </Link>{' '}
              to resend.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default VerifyEmail
