import React from 'react'
import { useAuthStore } from '../../store/authStore'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'

const UserProfile: React.FC = () => {
  const { user } = useAuthStore()

  if (!user) {
    return (
      <div className="rounded-3xl bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">Your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to manage account settings.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">Account settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage your contact details and notification preferences.</p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Display name" value={user.name} readOnly />
          <Input label="Email" type="email" value={user.email} readOnly />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">Role:</span> {user.role}
          </div>
          <div>
            <span className="font-medium text-foreground">Member since:</span>{' '}
            {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
          </div>
        </div>

        <Button className="mt-6" variant="outline" disabled>
          Update profile (coming soon)
        </Button>
      </section>
    </div>
  )
}

export default UserProfile
