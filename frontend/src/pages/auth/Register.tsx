import React from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { authApi } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'
import { SITE_NAME } from '../../config/brand'
import { Card, CardContent } from '../../components/shadcn/card'
import Logo from '../../components/common/Logo'

type FormValues = {
  displayName: string
  email: string
  password: string
  confirmPassword: string
}

// Must mirror the backend rules (validatePassword): 8+ chars, one upper, one
// lower, one number.
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/

const Register: React.FC = () => {
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ mode: 'onTouched' })
  const setAuth = useAuthStore((s) => s.setAuth)
  const password = watch('password')

  const onSubmit = async (values: FormValues) => {
    try {
      const res = await authApi.register({
        email: values.email,
        password: values.password,
        displayName: values.displayName,
      })
      setAuth({ user: res.user, token: res.accessToken, refreshToken: res.refreshToken })
      toast.success('Account created — check your email to verify your address.')
      navigate('/')
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.response?.data?.error || 'Registration failed'
      toast.error(message)
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <Logo variant="lockup" title={SITE_NAME} className="mx-auto mb-8 h-20 w-auto text-foreground" />
      <Card>
        <CardContent>
          <h1 className="text-2xl font-semibold text-foreground">Create an account</h1>
          <p className="mt-2 text-sm text-muted-foreground">Join {SITE_NAME} to access premium 3D terrain.</p>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            <Input
              label="Display name"
              placeholder="Terrain Enthusiast"
              error={errors.displayName?.message}
              {...register('displayName', {
                required: 'Display name is required',
                minLength: { value: 2, message: 'At least 2 characters' },
              })}
            />
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              error={errors.email?.message}
              {...register('email', {
                required: 'Email is required',
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address' },
              })}
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              description="At least 8 characters, including an uppercase letter, a lowercase letter, and a number."
              error={errors.password?.message}
              {...register('password', {
                required: 'Password is required',
                pattern: {
                  value: PASSWORD_RULE,
                  message: 'Needs 8+ characters with an uppercase letter, a lowercase letter, and a number',
                },
              })}
            />
            <Input
              label="Confirm password"
              type="password"
              placeholder="••••••••"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword', {
                required: 'Please re-enter your password',
                validate: (value) => value === password || 'Passwords do not match',
              })}
            />
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Create account
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default Register
