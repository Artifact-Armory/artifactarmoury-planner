import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Ticket, Loader2 } from 'lucide-react'
import { authApi } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'

/**
 * Redeems an invite code against the account the user is ALREADY signed in with.
 *
 * This is the piece that was missing: the backend has always had
 * POST /auth/register/artist, and admins could mint codes, but nothing in the UI
 * ever collected one — so every artist still had to be created by hand-run SQL.
 * Upgrading in place (rather than sending them to a second registration) matters
 * because users.email is UNIQUE: a buyer who starts selling would otherwise have
 * to abandon the account holding their purchases, downloads and saved tables.
 */
const RedeemArtistInvite: React.FC = () => {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const setAuth = useAuthStore((s) => s.setAuth)

  const [inviteCode, setInviteCode] = useState('')
  const [artistName, setArtistName] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (user?.role === 'artist') {
    return (
      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">You already sell here</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This account is an artist account.
        </p>
        <Button className="mt-4" variant="primary" onClick={() => navigate('/artist/models')}>
          Go to My Models
        </Button>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!inviteCode.trim()) return setError('Enter the invite code you were sent.')
    if (artistName.trim().length < 2) return setError('Enter the store name buyers will see.')
    if (!accepted) return setError('You need to accept the seller terms to sell here.')

    setSubmitting(true)
    try {
      const res = await authApi.upgradeToArtist({
        artistName: artistName.trim(),
        inviteCode: inviteCode.trim(),
        acceptTerms: true,
      })
      // Swap in the fresh tokens before navigating: the old JWT still says
      // 'customer', so the artist dashboard would bounce us straight back.
      setAuth({ user: res.user, token: res.accessToken, refreshToken: res.refreshToken })
      toast.success('You can now sell on Artifact Armoury.')
      navigate('/artist/models')
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Could not redeem that code.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-6">
      <div className="flex items-center gap-2">
        <Ticket className="text-primary" size={18} />
        <h2 className="text-sm font-semibold text-foreground">Have an invite code?</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter it here to turn <span className="font-medium text-foreground">{user?.email}</span> into a
        seller account. You keep your existing purchases, downloads and saved tables.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="inviteCode" className="block text-sm font-medium text-foreground">
            Invite code
          </label>
          <Input
            id="inviteCode"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="e.g. AA-XXXX-XXXX"
            autoComplete="off"
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="artistName" className="block text-sm font-medium text-foreground">
            Store name
          </label>
          <Input
            id="artistName"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
            placeholder="The name buyers will see"
            className="mt-1"
          />
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border"
        />
        <span>
          I agree to the{' '}
          <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
            seller terms
          </a>
          . I understand my listed prices are what I earn commission on before tax, that VAT is added
          on top for buyers, and that Artifact Armoury takes its commission from each sale.
        </span>
      </label>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className="mt-4" disabled={submitting}>
        {submitting ? (
          <span className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Setting up your store…
          </span>
        ) : (
          'Start selling'
        )}
      </Button>
    </form>
  )
}

export default RedeemArtistInvite
