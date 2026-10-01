import React from 'react'
import toast from 'react-hot-toast'
import { emailPrefsApi } from '../../api/endpoints/emailPrefs'
import { useAuthStore } from '../../store/authStore'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'

const UserProfile: React.FC = () => {
  const { user } = useAuthStore()
  const [followUpdates, setFollowUpdates] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    if (!user) return
    emailPrefsApi.get().then((p) => setFollowUpdates(p.followUpdates)).catch(() => {})
  }, [user?.id])

  const toggleFollowUpdates = async (next: boolean) => {
    setFollowUpdates(next)
    try {
      await emailPrefsApi.setFollowUpdates(next)
      toast.success(next ? 'Artist update emails on' : 'Artist update emails off')
    } catch {
      setFollowUpdates(!next)
      toast.error('Could not save your preference')
    }
  }

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

      <section className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <h2 className="text-lg font-semibold text-foreground">Email notifications</h2>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={followUpdates ?? true}
            disabled={followUpdates === null}
            onChange={(e) => toggleFollowUpdates(e.target.checked)}
          />
          <span>
            <span className="font-medium text-foreground">Artists I follow</span>
            <span className="block text-muted-foreground">
              Email me when an artist I follow releases a new model or starts a sale. You'll still see
              these in your notifications on the site.
            </span>
          </span>
        </label>
      </section>
    </div>
  )
}

export default UserProfile
