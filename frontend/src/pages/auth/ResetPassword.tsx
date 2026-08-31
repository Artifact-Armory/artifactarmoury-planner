import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { Card, CardContent } from '../../components/shadcn/card'
import Logo from '../../components/common/Logo'
import Seo from '../../components/common/Seo'
import { authApi } from '../../api/endpoints/auth'
import { SITE_NAME } from '../../config/brand'

type FormValues = { password: string; confirmPassword: string }

// Must mirror the backend rules (validatePassword): 8+ chars, one upper, one
// lower, one number. Kept identical to Register.tsx's PASSWORD_RULE.
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/

const ResetPassword: React.FC = () => {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ mode: 'onTouched' })
  const password = watch('password')
  const [done, setDone] = useState(false)

  const onSubmit = async (values: FormValues) => {
    if (!token) return
    try {
      await authApi.resetPassword(token, values.password)
      setDone(true)
      toast.success('Password reset — you can now sign in.')
    } catch (e: any) {
      toast.error(
        e?.response?.data?.message || 'This reset link is invalid or has expired.',
      )
    }
  }

  // No token in the URL at all — someone landed here directly rather than via
  // the emailed link.
  if (!token) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center">
        <Seo title="Reset Password" noindex />
        <Logo variant="lockup" title={SITE_NAME} className="mx-auto mb-8 h-20 w-auto text-foreground" />
        <Card>
          <CardContent>
            <h1 className="text-2xl font-semibold text-foreground">Reset link required</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This page needs the link from your password reset email.
            </p>
            <Link to="/forgot-password" className="mt-6 inline-block">
              <Button>Request a new link</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center">
        <Seo title="Reset Password" noindex />
        <Logo variant="lockup" title={SITE_NAME} className="mx-auto mb-8 h-20 w-auto text-foreground" />
        <Card>
          <CardContent>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-2xl text-emerald-600 dark:text-emerald-400">
              ✓
            </div>
            <h1 className="text-2xl font-semibold text-foreground">Password reset</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your password has been changed. Sign in with your new password.
            </p>
            <Button className="mt-6" onClick={() => navigate('/login')}>
              Go to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <Seo title="Reset Password" noindex />
      <Logo variant="lockup" title={SITE_NAME} className="mx-auto mb-8 h-20 w-auto text-foreground" />
      <Card>
        <CardContent>
          <h1 className="text-2xl font-semibold text-foreground">Choose a new password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link expires 60 minutes after it was sent.
          </p>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            <Input
              label="New password"
              type="password"
              placeholder="••••••••"
              autoFocus
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
              label="Confirm new password"
              type="password"
              placeholder="••••••••"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword', {
                required: 'Please re-enter your password',
                validate: (value) => value === password || 'Passwords do not match',
              })}
            />
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Reset password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default ResetPassword
