import React from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { authApi } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'

type FormValues = { email: string; password: string; displayName: string }

const Register: React.FC = () => {
  const { register, handleSubmit, formState } = useForm<FormValues>()
  const { setAuth, setLoading } = useAuthStore()

  const onSubmit = async (values: FormValues) => {
    try {
      setLoading(true)
      const res = await authApi.register(values)
      setAuth({ user: res.user, token: res.accessToken, refreshToken: res.refreshToken })
      toast.success('Account created successfully')
    } catch (e: any) {
      const message = e?.response?.data?.message || 'Registration failed'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

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
          {...register('password', { required: true, minLength: 8 })}
        />
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </div>
  )
}

export default Register
