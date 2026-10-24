import React from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { authApi } from '../../api/endpoints/auth'
import { emailPrefsApi } from '../../api/endpoints/emailPrefs'
import { useAuthStore } from '../../store/authStore'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'

const UserProfile: React.FC = () => {
  const { user, setUser, setTokens } = useAuthStore()
  const [followUpdates, setFollowUpdates] = React.useState<boolean | null>(null)
  const [displayName, setDisplayName] = React.useState(user?.name ?? '')
  const [savingName, setSavingName] = React.useState(false)
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [savingPassword, setSavingPassword] = React.useState(false)

  React.useEffect(() => {
    setDisplayName(user?.name ?? '')
  }, [user?.name])

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

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault()
    const next = displayName.trim()
    if (next.length < 2 || next.length > 100) {
      toast.error('Display name must be between 2 and 100 characters')
      return
    }
    setSavingName(true)
    try {
      setUser(await authApi.updateProfile({ displayName: next }))
      toast.success('Profile updated')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not update your profile')
    } finally {
      setSavingName(false)
    }
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    setSavingPassword(true)
    try {
      const result = await authApi.changePassword(currentPassword, newPassword)
      // The server ended every session on the change; keep this one signed in.
      if (result.accessToken) setTokens(result.accessToken, result.refreshToken)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed. Other devices have been signed out.')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not change your password')
    } finally {
      setSavingPassword(false)
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

      <form onSubmit={saveName} className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <h2 className="text-lg font-semibold text-foreground">Profile</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input
            label="Display name"
            name="displayName"
            value={displayName}
            maxLength={100}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Input
            label="Email"
            name="email"
            type="email"
            value={user.email}
            readOnly
            description="Need to change it? Contact us and we'll update it for you."
          />
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

        {user.role === 'artist' && (
          <p className="mt-4 text-sm text-muted-foreground">
            Your shop name, bio, avatar and banner are in{' '}
            <Link to="/artist/settings" className="font-medium text-primary hover:underline">
              Artist settings
            </Link>
            .
          </p>
        )}

        <Button
          type="submit"
          className="mt-6"
          disabled={savingName || displayName.trim() === user.name}
        >
          {savingName ? 'Saving…' : 'Save profile'}
        </Button>
      </form>

      <form onSubmit={changePassword} className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <h2 className="text-lg font-semibold text-foreground">Change password</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 sm:max-w-sm">
            <Input
              label="Current password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <Input
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            label="Confirm new password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          className="mt-6"
          variant="outline"
          disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
        >
          {savingPassword ? 'Saving…' : 'Change password'}
        </Button>
      </form>

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
