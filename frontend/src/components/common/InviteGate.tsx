import React, { useState } from 'react'
import { useInviteGateStore } from '../../store/inviteGateStore'
import Logo from './Logo'
import Button from '../ui/Button'

/**
 * Full-screen pop-up that blocks the entire site behind an invite code.
 *
 * Rendered by `App` in place of the router when the visitor is neither
 * signed in nor already unlocked on this device — see `inviteGateStore` for
 * the "remember on this device" persistence and `config/inviteCodes.ts` for
 * the codes themselves (and its note on this being a frontend-only gate).
 */
const InviteGate: React.FC = () => {
  const tryUnlock = useInviteGateStore((s) => s.tryUnlock)
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (tryUnlock(code)) {
      setError(false)
      return
    }
    setError(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <Logo variant="lockup" className="mx-auto mb-8 h-20 w-auto text-foreground" title="Artifact Armoury" />

        <h1 className="text-lg font-semibold text-foreground">Private access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Artifact Armoury is currently invite-only. Enter your invite code to continue.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              if (error) setError(false)
            }}
            placeholder="Invite code"
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-sm border border-border bg-card px-3 py-2 text-center text-sm tracking-wide text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {error && (
            <p className="text-sm text-destructive">That code isn't valid. Check it and try again.</p>
          )}
          <Button type="submit" className="w-full" disabled={!code.trim()}>
            Enter
          </Button>
        </form>
      </div>
    </div>
  )
}

export default InviteGate
