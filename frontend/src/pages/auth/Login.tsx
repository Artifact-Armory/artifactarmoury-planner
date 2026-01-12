import React from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { authApi } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'

type FormValues = { email: string; password: string }

const Login: React.FC = () => {
  const { register, handleSubmit, formState } = useForm<FormValues>()
  const { setAuth, setLoading } = useAuthStore()

  const onSubmit = async (values: FormValues) => {
    try {
      setLoading(true)
      const res = await authApi.login(values)
      setAuth({ user: res.user, token: res.accessToken, refreshToken: res.refreshToken })
    } catch (e: any) {
      const message = e?.response?.data?.message || 'Unable to login'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

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
