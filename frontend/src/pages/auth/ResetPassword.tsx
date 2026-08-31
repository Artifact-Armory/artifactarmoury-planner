import React from 'react'
import Seo from '../../components/common/Seo'

const ResetPassword: React.FC = () => {
  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <Seo title="Reset Password" noindex />
      <h1 className="text-xl font-semibold text-foreground mb-4">Reset Password</h1>
      <p className="text-muted-foreground">Check your email for reset instructions.</p>
    </div>
  )
}

export default ResetPassword
