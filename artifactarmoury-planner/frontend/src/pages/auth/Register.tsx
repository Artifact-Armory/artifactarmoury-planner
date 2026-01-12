import React, { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { authApi } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'
import { useLocation, useNavigate, Location } from 'react-router-dom'

type FormValues = {
  email: string
  password: string
  displayName: string
  humanAnswer: string
}

const Register: React.FC = () => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>()
  const navigate = useNavigate()
  const location = useLocation()
  const { setAuth, setLoading, isAuthenticated } = useAuthStore()
  const [challengeSeed, setChallengeSeed] = useState(() => Date.now())

  const challenge = useMemo(() => {
    const rand = new Date(challengeSeed).getTime()
    const a = (rand % 7) + 3
    const b = (Math.floor(rand / 7) % 5) + 2
    return { a, b, answer: a + b }
  }, [challengeSeed])

  const resetChallenge = () => setChallengeSeed(Date.now())

  const resolveRedirectPath = (): string => {
    const state = location.state as { from?: Location } | null
    const fromState = state?.from
    if (fromState) {
      const search = fromState.search ?? ''
      const hash = fromState.hash ?? ''
      return `${fromState.pathname}${search}${hash}`
    }
    const stored = sessionStorage.getItem('redirectPath')
    return stored || '/dashboard'
  }

  const onSubmit = async (values: FormValues) => {
    try {
      if (Number(values.humanAnswer) !== challenge.answer) {
        toast.error('Please solve the verification question correctly.')
        return
      }
      setLoading(true)
      toast.dismiss()
      const { humanAnswer, ...payload } = values
      const res = await authApi.register(payload)
      setAuth({ user: res.user, token: res.accessToken, refreshToken: res.refreshToken })
      toast.success('Account created successfully', { duration: 3000 })
      const nextPath = resolveRedirectPath()
      sessionStorage.removeItem('redirectPath')
      navigate(nextPath, { replace: true })
      reset()
      resetChallenge()
    } catch (e: any) {
      const details = e?.response?.data?.details
      let message = e?.response?.data?.message || 'Registration failed'
      if (Array.isArray(details)) {
        const passwordError = details.find((detail: any) => detail.field === 'password')
        if (passwordError?.message) {
          message = passwordError.message
        }
      } else if (typeof details === 'object' && details?.password?.message) {
        message = details.password.message
      }
      toast.error(message, { duration: 4000 })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      const nextPath = resolveRedirectPath()
      sessionStorage.removeItem('redirectPath')
      navigate(nextPath, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900">Create an account</h1>
      <p className="mt-2 text-sm text-gray-500">Join Artifact Armoury to access premium 3D terrain.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <Input
          label="Display name"
          placeholder="Terrain Enthusiast"
          required
          {...register('displayName', { required: true, minLength: 2 })}
        />
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
          {...register('password', {
            required: 'Password is required',
            minLength: { value: 8, message: 'Password must be at least 8 characters long' },
            validate: {
              hasUppercase: (value) =>
                /[A-Z]/.test(value) || 'Password must contain at least one uppercase letter',
              hasLowercase: (value) =>
                /[a-z]/.test(value) || 'Password must contain at least one lowercase letter',
              hasNumber: (value) =>
                /\d/.test(value) || 'Password must contain at least one number',
            },
          })}
        />
        {errors.password?.message && (
          <p className="text-xs text-red-600">{errors.password.message}</p>
        )}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Human verification: what is {challenge.a} + {challenge.b}?
          </label>
          <input
            type="number"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Enter the result"
            {...register('humanAnswer', { required: true })}
          />
          {errors.humanAnswer && (
            <p className="text-xs text-red-600">Please answer the verification question.</p>
          )}
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
      <div className="mt-4 text-xs text-gray-500">
        Passwords must include at least one uppercase letter, one lowercase letter, and one number.
      </div>
    </div>
  )
}

export default Register
