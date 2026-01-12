import React, { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { useLocation, useNavigate, Location } from 'react-router-dom'
import { authApi } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'

type FormValues = { email: string; password: string }

const Login: React.FC = () => {
  const { register, handleSubmit, formState } = useForm<FormValues>()
  const navigate = useNavigate()
  const location = useLocation()
  const { setAuth, setLoading, isAuthenticated } = useAuthStore()

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
      setLoading(true)
      toast.dismiss()
      const res = await authApi.login(values)
      setAuth({ user: res.user, token: res.accessToken, refreshToken: res.refreshToken })
      const nextPath = resolveRedirectPath()
      sessionStorage.removeItem('redirectPath')
      navigate(nextPath, { replace: true })
    } catch (e: any) {
      const message = e?.response?.data?.message || 'Unable to login'
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
