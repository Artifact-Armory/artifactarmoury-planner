import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Wallet, Clock, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { payoutsApi } from '../../api/endpoints/payouts'
import { formatPrice } from '../../utils/format'
import Spinner from '../../components/ui/Spinner'

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  cleared: 'bg-green-100 text-green-700',
  paid: 'bg-indigo-100 text-indigo-700',
  reversed: 'bg-gray-200 text-gray-500',
  failed: 'bg-red-100 text-red-700',
}

const ArtistPayouts: React.FC = () => {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const { data, isLoading } = useQuery({ queryKey: ['artist-payouts'], queryFn: () => payoutsApi.getMine() })

  // On return from Stripe onboarding, re-check status then clean the URL param.
  React.useEffect(() => {
    if (params.get('onboarding')) {
      payoutsApi.checkStatus().then(() => qc.invalidateQueries({ queryKey: ['artist-payouts'] }))
      params.delete('onboarding'); setParams(params, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onboard = useMutation({
    mutationFn: () => payoutsApi.startOnboarding(),
    onSuccess: ({ onboardingUrl }) => { window.location.href = onboardingUrl },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not start onboarding'),
  })

  if (isLoading || !data) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>

  const { summary, earnings, payouts, connect, config } = data

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Payouts</h1>
      <p className="mt-1 text-sm text-gray-500">
        You keep {100 - 15}% of each sale. Earnings clear after a {config.holdDays}-day hold, then pay
        out automatically once your balance passes {formatPrice(config.minPayout)}.
      </p>

      {/* Connect status banner */}
      {!connect.onboardingComplete && (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-amber-500" size={20} />
            <div>
              <p className="font-medium text-amber-900">Set up payouts to get paid</p>
              <p className="text-sm text-amber-700">
                {connect.accountId
                  ? 'Your Stripe account needs a few more details before we can send money.'
                  : 'Connect a Stripe account so we can pay your earnings. Your sales still accrue in the meantime.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => onboard.mutate()}
            disabled={onboard.isPending}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {onboard.isPending ? 'Redirecting…' : connect.accountId ? 'Finish setup' : 'Set up payouts'}
            <ExternalLink size={15} />
          </button>
        </div>
      )}

      {/* Summary tiles */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile icon={<Clock size={16} />} label="Pending" value={summary.pending} sub={`in ${config.holdDays}-day hold`} />
        <SummaryTile icon={<Wallet size={16} />} label="Cleared" value={summary.cleared} sub="awaiting payout" accent="text-green-600" />
        <SummaryTile icon={<CheckCircle2 size={16} />} label="Paid out" value={summary.paid} sub="lifetime" />
        <SummaryTile icon={<XCircle size={16} />} label="Reversed" value={summary.reversed} sub="refunds / takedowns" accent="text-gray-400" />
      </div>

      {/* Earnings ledger */}
      <h2 className="mt-10 text-lg font-semibold text-gray-900">Earnings</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full divide-y text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3 text-right">Sale</th>
              <th className="px-4 py-3 text-right">Your share</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Clears</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {earnings.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No earnings yet — your first sale will show here.</td></tr>
            ) : earnings.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3 font-medium text-gray-900">{e.model_name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{e.order_number ?? '—'}</td>
                <td className="px-4 py-3 text-right text-gray-500">{formatPrice(e.gross_amount)}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatPrice(e.artist_amount)}</td>
                <td className="px-4 py-3"><span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[e.status]}`}>{e.status}</span></td>
                <td className="px-4 py-3 text-gray-500">{e.status === 'pending' ? new Date(e.available_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payout history */}
      {payouts.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-gray-900">Payout history</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full divide-y text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 text-gray-500">{new Date(p.paid_at ?? p.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatPrice(p.amount)}</td>
                    <td className="px-4 py-3"><span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status]}`}>{p.status}</span></td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.stripe_transfer_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const SummaryTile: React.FC<{ icon: React.ReactNode; label: string; value: number; sub: string; accent?: string }> = ({ icon, label, value, sub, accent }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
    <div className="flex items-center gap-1.5 text-gray-400"><span>{icon}</span><span className="text-xs font-medium uppercase tracking-wide">{label}</span></div>
    <p className={`mt-1 text-xl font-semibold ${accent ?? 'text-gray-900'}`}>{formatPrice(value)}</p>
    <p className="text-xs text-gray-400">{sub}</p>
  </div>
)

export default ArtistPayouts
