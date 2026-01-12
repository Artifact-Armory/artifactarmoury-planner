import React from 'react'

const UserProfile: React.FC = () => {
  return (
    <div className="px-4 py-10">
      <h1 className="text-xl font-semibold">Your Profile</h1>
      <p className="text-gray-600 mt-2">Update your account details here.</p>
    </div>
  )
}

export default UserProfile
import React from 'react'
import { useAuthStore } from '../../store/authStore'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'

const UserProfile: React.FC = () => {
  const { user } = useAuthStore()

  if (!user) {
    return (
      <div className="rounded-3xl bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold text-gray-900">Your profile</h1>
        <p className="mt-2 text-sm text-gray-600">Sign in to manage account settings.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold text-gray-900">Account settings</h1>
        <p className="mt-2 text-sm text-gray-600">Manage your contact details and notification preferences.</p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Display name" value={user.name} readOnly />
          <Input label="Email" type="email" value={user.email} readOnly />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-gray-600">
          <div>
            <span className="font-medium text-gray-900">Role:</span> {user.role}
          </div>
          <div>
            <span className="font-medium text-gray-900">Member since:</span>{' '}
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
