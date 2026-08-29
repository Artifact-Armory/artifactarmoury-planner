import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isValidInviteCode } from '../config/inviteCodes'

/**
 * Whether this browser has already unlocked the site with a valid invite
 * code. Persisted so a visitor only has to enter it once per device — see
 * `InviteGate.tsx` for where this gets checked and rendered.
 */
interface InviteGateState {
  unlocked: boolean
  /** Validates `code`; unlocks and returns true on a match, else false. */
  tryUnlock: (code: string) => boolean
}

export const useInviteGateStore = create<InviteGateState>()(
  persist(
    (set) => ({
      unlocked: false,
      tryUnlock: (code: string) => {
        const ok = isValidInviteCode(code)
        if (ok) set({ unlocked: true })
        return ok
      },
    }),
    {
      name: 'invite-gate-storage',
    }
  )
)
