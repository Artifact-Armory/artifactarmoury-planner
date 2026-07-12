import React from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, ShieldAlert, Copy, Check } from 'lucide-react'
import { authApi, TwoFactorStatus, TwoFactorSetup } from '../../api/endpoints/auth'
import { useAuthStore } from '../../store/authStore'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'

type Phase = 'idle' | 'enrolling' | 'showing-codes'

const SecuritySettings: React.FC = () => {
  const { user, setUser } = useAuthStore()
  const [status, setStatus] = React.useState<TwoFactorStatus | null>(null)
  const [loading, setLoading] = React.useState(true)

  const [phase, setPhase] = React.useState<Phase>('idle')
  const [setup, setSetup] = React.useState<TwoFactorSetup | null>(null)
  const [code, setCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [backupCodes, setBackupCodes] = React.useState<string[]>([])
  const [copied, setCopied] = React.useState(false)

  const [disablePassword, setDisablePassword] = React.useState('')
  const [showDisable, setShowDisable] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await authApi.twoFactor.status())
    } catch {
      toast.error('Could not load your security settings')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // Keep the cached user's flag in sync so other screens react to the change.
  const syncUserFlag = (enabled: boolean) => {
    if (user) setUser({ ...user, twoFactorEnabled: enabled })
  }

  const startEnrol = async () => {
    setBusy(true)
    try {
      setSetup(await authApi.twoFactor.setup())
      setPhase('enrolling')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not start setup')
    } finally {
      setBusy(false)
    }
  }

  const confirmEnrol = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    try {
      const res = await authApi.twoFactor.enable(code.trim())
      setBackupCodes(res.backupCodes)
      setPhase('showing-codes')
      setCode('')
      syncUserFlag(true)
      toast.success('Two-factor authentication is on')
      await load()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'That code was not accepted')
    } finally {
      setBusy(false)
    }
  }

  const disable2fa = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!disablePassword) return
    setBusy(true)
    try {
      await authApi.twoFactor.disable(disablePassword)
      setDisablePassword('')
      setShowDisable(false)
      syncUserFlag(false)
      toast.success('Two-factor authentication turned off')
      await load()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not disable two-factor authentication')
    } finally {
      setBusy(false)
    }
  }

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select and copy the codes manually')
    }
  }

  if (loading) {
    return <div className="px-4 py-10 max-w-2xl mx-auto text-gray-500">Loading…</div>
  }

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900">Security</h1>
      <p className="mt-1 text-gray-600">Protect your account with two-factor authentication (2FA).</p>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          {status?.enabled ? (
            <ShieldCheck className="mt-0.5 shrink-0 text-green-600" />
          ) : (
            <ShieldAlert className="mt-0.5 shrink-0 text-amber-500" />
          )}
          <div className="flex-1">
            <h2 className="text-base font-semibold text-gray-900">
              Two-factor authentication is {status?.enabled ? 'on' : 'off'}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {status?.enabled
                ? 'You’ll enter a code from your authenticator app each time you sign in. This is strongly recommended for sellers — your account holds your earnings.'
                : 'Add a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password…). Strongly recommended if you sell on Artifact Armoury.'}
            </p>
            {status?.enabled && (
              <p className="mt-2 text-xs text-gray-400">
                {status.backupCodesRemaining} backup code{status.backupCodesRemaining === 1 ? '' : 's'} remaining
              </p>
            )}
          </div>
        </div>

        {/* ── ENABLED: offer disable ─────────────────────────────────────── */}
        {status?.enabled && phase !== 'showing-codes' && (
          <div className="mt-5 border-t border-gray-100 pt-5">
            {!showDisable ? (
              <Button variant="outline" onClick={() => setShowDisable(true)}>
                Turn off two-factor authentication
              </Button>
            ) : (
              <form onSubmit={disable2fa} className="space-y-3">
                <p className="text-sm text-gray-600">Confirm your password to turn 2FA off.</p>
                <Input
                  label="Password"
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="••••••••"
                />
                <div className="flex gap-3">
                  <Button type="submit" variant="outline" loading={busy}>
                    Turn off 2FA
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowDisable(false)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ── DISABLED + idle: offer enable ──────────────────────────────── */}
        {!status?.enabled && phase === 'idle' && (
          <div className="mt-5 border-t border-gray-100 pt-5">
            <Button onClick={startEnrol} loading={busy} leftIcon={<ShieldCheck size={16} />}>
              Set up two-factor authentication
            </Button>
          </div>
        )}

        {/* ── Enrolment: scan QR + confirm a code ────────────────────────── */}
        {phase === 'enrolling' && setup && (
          <div className="mt-5 border-t border-gray-100 pt-5">
            <ol className="space-y-4 text-sm text-gray-700">
              <li>
                <p className="font-medium">1. Scan this QR code with your authenticator app</p>
                <img
                  src={setup.qrDataUrl}
                  alt="2FA QR code"
                  className="mt-2 h-44 w-44 rounded-lg border border-gray-200"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Can’t scan? Enter this key manually:{' '}
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">{setup.secret}</code>
                </p>
              </li>
              <li>
                <p className="font-medium">2. Enter the 6-digit code it shows</p>
                <form onSubmit={confirmEnrol} className="mt-2 flex items-end gap-3">
                  <div className="flex-1">
                    <Input
                      label=""
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </div>
                  <Button type="submit" loading={busy}>Verify</Button>
                </form>
              </li>
            </ol>
            <button
              type="button"
              onClick={() => { setPhase('idle'); setSetup(null); setCode('') }}
              className="mt-3 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel setup
            </button>
          </div>
        )}

        {/* ── Backup codes (shown once) ──────────────────────────────────── */}
        {phase === 'showing-codes' && (
          <div className="mt-5 border-t border-gray-100 pt-5">
            <h3 className="text-sm font-semibold text-gray-900">Save your backup codes</h3>
            <p className="mt-1 text-sm text-gray-600">
              Store these somewhere safe. Each code can be used once to sign in if you lose access to
              your authenticator app. <strong>They won’t be shown again.</strong>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-4 font-mono text-sm text-gray-800">
              {backupCodes.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
            <div className="mt-3 flex gap-3">
              <Button
                variant="outline"
                onClick={copyCodes}
                leftIcon={copied ? <Check size={16} /> : <Copy size={16} />}
              >
                {copied ? 'Copied' : 'Copy codes'}
              </Button>
              <Button onClick={() => setPhase('idle')}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SecuritySettings
