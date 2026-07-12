import React from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { authApi } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'

type FormValues = { email: string; password: string }

const Login: React.FC = () => {
  const navigate = useNavigate()
  const { register, handleSubmit, formState } = useForm<FormValues>()
  const { setAuth, setLoading } = useAuthStore()

  // When the account has 2FA on, the password step returns a challenge token and
  // we switch to the code-entry view instead of signing in.
  const [challengeToken, setChallengeToken] = React.useState<string | null>(null)
  const [code, setCode] = React.useState('')
  const [verifying, setVerifying] = React.useState(false)

  const finishLogin = (user: any, token: string, refreshToken: string) => {
    setAuth({ user, token, refreshToken })
    toast.success('Logged in successfully', { duration: 3000 })
    navigate('/')
  }

  const onSubmit = async (values: FormValues) => {
    try {
      setLoading(true)
      const res = await authApi.login(values)
      if (res.twoFactorRequired) {
        setChallengeToken(res.challengeToken)
        return
      }
      finishLogin(res.user, res.accessToken, res.refreshToken)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Unable to login')
    } finally {
      setLoading(false)
    }
  }

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!challengeToken || !code.trim()) return
    try {
      setVerifying(true)
      const res = await authApi.loginTwoFactor(challengeToken, code.trim())
      finishLogin(res.user, res.accessToken, res.refreshToken)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'That code was not accepted')
    } finally {
      setVerifying(false)
    }
  }

  // ── Second step: one-time code ────────────────────────────────────────────
  if (challengeToken) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold text-gray-900">Two-step verification</h1>
        <p className="mt-2 text-sm text-gray-500">
          Enter the 6-digit code from your authenticator app. You can also use one of your backup
          codes.
        </p>
        <form onSubmit={onVerify} className="mt-6 space-y-4">
          <Input
            label="Authentication code"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" className="w-full" loading={verifying}>
            Verify &amp; sign in
          </Button>
          <button
            type="button"
            onClick={() => {
              setChallengeToken(null)
              setCode('')
            }}
            className="w-full text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to sign in
          </button>
        </form>
      </div>
    )
  }

  // ── First step: email + password ──────────────────────────────────────────
  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900">Sign in</h1>
      <p className="mt-2 text-sm text-gray-500">Welcome back! Please enter your details.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          required
          {...register('email', { required: true })}
        />
        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          required
          {...register('password', { required: true })}
        />
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </div>
  )
}

export default Login
