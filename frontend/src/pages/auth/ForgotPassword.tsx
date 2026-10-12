import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { Card, CardContent } from '../../components/shadcn/card'
import Logo from '../../components/common/Logo'
import Seo from '../../components/common/Seo'
import { authApi } from '../../api/endpoints/auth'
import { SITE_NAME } from '../../config/brand'

type FormValues = { email: string }

const ForgotPassword: React.FC = () => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ mode: 'onTouched' })
  const [sent, setSent] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)

  const onSubmit = async (values: FormValues) => {
    setRateLimited(false)
    try {
      await authApi.requestPasswordReset(values.email.trim())
    } catch (err: any) {
      // Too many requests means NO email went out, so saying "sent" would leave
      // them waiting for nothing. It reveals nothing about which emails have
      // accounts: the limit applies to every address alike.
      if (err?.response?.status === 429) {
        setRateLimited(true)
        return
      }
      // Anything else: the backend answers the same for known and unknown
      // addresses (no account enumeration), so fall through to the generic
      // confirmation.
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        <Seo title="Forgot Password" noindex />
        <Logo variant="lockup" title={SITE_NAME} className="mx-auto mb-8 h-20 w-auto text-foreground" />
        <Card>
          <CardContent className="text-center">
            <h1 className="text-2xl font-semibold text-foreground">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              If an account exists for that address, we've sent a link to reset your password. It
              expires in 60 minutes.
            </p>
            <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
              ← Back to sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <Seo title="Forgot Password" noindex />
      <Logo variant="lockup" title={SITE_NAME} className="mx-auto mb-8 h-20 w-auto text-foreground" />
      <Card>
        <CardContent>
          <h1 className="text-2xl font-semibold text-foreground">Forgot your password?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the email address on your account and we'll send you a link to reset it.
          </p>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              autoFocus
              error={errors.email?.message}
              {...register('email', {
                required: 'Email is required',
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address' },
              })}
            />
            {rateLimited && (
              <p className="text-sm text-destructive" role="alert">
                Too many reset requests. Please wait an hour and try again.
              </p>
            )}
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Send reset link
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link to="/login" className="font-medium text-primary hover:underline">
              ← Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default ForgotPassword
