import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, ArrowRight, X } from 'lucide-react'
import { authApi } from '../../api/endpoints/auth'
import { artistsApi } from '../../api/endpoints/artists'
import { modelsApi } from '../../api/endpoints/models'
import { payoutsApi } from '../../api/endpoints/payouts'
import { useAuthStore } from '../../store/authStore'

/**
 * First-run checklist for a new artist, shown above the sales tiles until it is
 * finished (then it disappears for good).
 *
 * Every step is derived from REAL account state — 2FA actually enabled, a bio
 * actually saved, a model actually uploaded — never from a "user clicked next"
 * flag. So it cannot claim someone is set up when they aren't, it survives a
 * new device or a re-install, and it needs no extra column to persist.
 *
 * The upload step is also where we explain, in plain language, what happens to
 * a file after it's handed over. That belongs here rather than on a security
 * page: it lands at the moment an artist is actually deciding to trust us, and
 * it reads as part of getting set up rather than as a sales pitch about safety.
 */

const HIDDEN_KEY = 'aa.artist.gettingStarted.hidden'

interface Step {
  key: string
  title: string
  /** Plain-language why — no jargon, this is read by non-technical makers. */
  body: React.ReactNode
  done: boolean
  to: string
  action: string
}

const GettingStarted: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const [hidden, setHidden] = React.useState(
    () => localStorage.getItem(HIDDEN_KEY) === 'true',
  )

  const twoFactor = useQuery({
    queryKey: ['two-factor-status'],
    queryFn: () => authApi.twoFactor.status(),
  })

  const profile = useQuery({
    queryKey: ['artist-profile', user?.id],
    queryFn: () => artistsApi.getArtistProfile(user!.id as string),
    enabled: !!user?.id,
  })

  const myModels = useQuery({
    queryKey: ['my-models', 'getting-started'],
    queryFn: () => modelsApi.getMyModels({ limit: 100 }),
  })

  // Same key as the dashboard's own payouts query, so the two share one request.
  const payouts = useQuery({
    queryKey: ['artist-payouts-summary'],
    queryFn: () => payoutsApi.getMine(),
  })

  // Show this only once every answer is actually in. Anything short of that —
  // still loading, errored, or sitting in a retry backoff (where a query is
  // neither loading nor errored) — leaves steps reading as "not done", which
  // would tell a fully set-up artist they have done nothing at all.
  const ready =
    twoFactor.isSuccess && profile.isSuccess && myModels.isSuccess && payouts.isSuccess

  const models = myModels.data?.models ?? []
  const steps: Step[] = [
    {
      key: 'two-factor',
      title: 'Turn on two-step sign-in',
      body: 'Your account holds your models and your earnings, so we ask for a code from your phone as well as your password. It takes a minute, and you will need it before you can upload.',
      done: !!twoFactor.data?.enabled,
      to: '/dashboard/security',
      action: 'Set it up',
    },
    {
      key: 'profile',
      title: 'Add your name and a few words about you',
      body: 'Buyers see this on your storefront and next to every model. A photo and a short bio make a noticeable difference to how much people buy.',
      done: !!profile.data?.bio && !!profile.data?.profileImageUrl,
      to: '/artist/settings',
      action: 'Edit storefront',
    },
    {
      key: 'first-model',
      title: 'Upload your first model',
      body: (
        <>
          Drop in your file and we will make the 3D preview and print estimate for you.
          <span className="mt-1.5 block">
            While we are at it: people browsing the site never receive your actual file —
            they see a low-detail stand-in that cannot be printed. Each buyer&apos;s
            download is prepared just for them, so a file that ends up somewhere it
            shouldn&apos;t can be traced back to the sale it came from. And we check every
            upload against the whole marketplace, so nobody can list your work as theirs.{' '}
            <Link to="/creator-protection" className="text-primary hover:underline">
              More on how we look after your files
            </Link>
          </span>
        </>
      ),
      done: models.length > 0,
      to: '/artist/models/new',
      action: 'Upload a model',
    },
    {
      key: 'publish',
      title: 'Publish it',
      body: 'Uploads start as drafts, so nothing goes live until you say so. Publishing puts it in front of buyers and into the 3D planner.',
      done: models.some((m) => m.status === 'published'),
      to: '/artist/models',
      action: 'Go to my models',
    },
    {
      key: 'payouts',
      title: 'Tell us where to send your money',
      body: 'Earnings sit in your account until you connect a payout method. You keep 85% of every sale, paid out after a short holding period.',
      done: !!payouts.data?.connect.onboardingComplete,
      to: '/artist/payouts',
      action: 'Set up payouts',
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const complete = doneCount === steps.length

  if (!ready || complete || hidden) return null

  const dismiss = () => {
    localStorage.setItem(HIDDEN_KEY, 'true')
    setHidden(true)
  }

  const current = steps.findIndex((s) => !s.done)

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Getting started</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {doneCount === 0
              ? 'Five things to do before your first sale.'
              : `${doneCount} of ${steps.length} done — nearly there.`}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Hide getting started"
          title="Hide this"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ol className="mt-5 space-y-3">
        {steps.map((step, i) => {
          const isCurrent = i === current
          return (
            <li
              key={step.key}
              className={`rounded-xl border p-4 ${
                isCurrent ? 'border-primary/30 bg-primary/5' : 'border-transparent'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    step.done
                      ? 'bg-green-100 text-green-700'
                      : isCurrent
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {step.done ? <Check size={12} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3
                    className={`text-sm font-medium ${
                      step.done ? 'text-muted-foreground line-through' : 'text-foreground'
                    }`}
                  >
                    {step.title}
                  </h3>
                  {!step.done && (
                    <>
                      <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {step.body}
                      </div>
                      <Link
                        to={step.to}
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        {step.action}
                        <ArrowRight size={14} />
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default GettingStarted
