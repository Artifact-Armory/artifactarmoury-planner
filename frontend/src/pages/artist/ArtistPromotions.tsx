import React from 'react'
import toast from 'react-hot-toast'
import { Tag, X } from 'lucide-react'
import { salesApi, SaleRecord, SaleScope, SALE_MAX_DAYS } from '../../api/endpoints/sales'
import { modelsApi } from '../../api/endpoints/models'
import { bundlesApi } from '../../api/endpoints/bundles'
import { TerrainModel, Bundle } from '../../api/types'
import Button from '../../components/ui/Button'

const stateBadge: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  scheduled: 'bg-blue-100 text-blue-700',
  ended: 'bg-gray-100 text-gray-500',
  canceled: 'bg-gray-100 text-gray-400',
}

const ArtistPromotions: React.FC = () => {
  const [sales, setSales] = React.useState<SaleRecord[]>([])
  const [models, setModels] = React.useState<TerrainModel[]>([])
  const [bundles, setBundles] = React.useState<Bundle[]>([])
  const [loading, setLoading] = React.useState(true)

  const [scope, setScope] = React.useState<SaleScope>('model')
  const [targetId, setTargetId] = React.useState('')
  const [percent, setPercent] = React.useState('20')
  const [days, setDays] = React.useState('7')
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [s, m, b] = await Promise.all([
        salesApi.mine(),
        modelsApi.getMyModels({ limit: 100 }),
        bundlesApi.getMyBundles(),
      ])
      setSales(s)
      setModels((m.models ?? []).filter((x) => x.status === 'published'))
      setBundles((b ?? []).filter((x) => x.status === 'published'))
    } catch {
      toast.error('Could not load your promotions')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // Reset the target when switching scope.
  React.useEffect(() => {
    setTargetId('')
  }, [scope])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const pct = Number(percent)
    const dur = Number(days)
    if (scope !== 'portfolio' && !targetId) {
      toast.error(`Choose a ${scope} to put on sale`)
      return
    }
    setBusy(true)
    try {
      await salesApi.create({
        scope,
        targetId: scope === 'portfolio' ? undefined : targetId,
        discountPercent: pct,
        durationDays: dur,
      })
      toast.success('Sale started')
      setPercent('20')
      setDays('7')
      setTargetId('')
      await load()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not start the sale')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: string) => {
    if (!confirm('End this sale now?')) return
    try {
      await salesApi.cancel(id)
      toast.success('Sale ended')
      await load()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not end the sale')
    }
  }

  const live = sales.filter((s) => s.state === 'active' || s.state === 'scheduled')
  const past = sales.filter((s) => s.state === 'ended' || s.state === 'canceled')

  return (
    <div className="px-4 py-10 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900">Promotions &amp; sales</h1>
      <p className="mt-1 text-gray-600">
        Put a model, a bundle, or your whole portfolio on sale. On-sale items can appear in the
        front-page sale carousel.
      </p>

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
        <p className="font-medium text-gray-800">The rules (so sales stay meaningful):</p>
        <ul className="mt-1 ml-5 list-disc space-y-0.5">
          <li>A sale runs for up to {SALE_MAX_DAYS} days.</li>
          <li>After a sale ends there's a cooldown before you can run another on the same item.</li>
          <li>You can't discount a price you raised in the last 30 days — the “was” price must be genuine.</li>
        </ul>
      </div>

      {/* Create a sale */}
      <form onSubmit={submit} className="mt-6 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-900">Start a sale</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          {([
            ['model', 'A model'],
            ['bundle', 'A bundle'],
            ['portfolio', 'Entire portfolio'],
          ] as [SaleScope, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                scope === value
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {scope === 'model' && (
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Model</label>
            <select className="w-full border rounded px-3 py-2" value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy}>
              <option value="">Choose a published model…</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {models.length === 0 && <p className="text-xs text-gray-500 mt-1">You have no published models yet.</p>}
          </div>
        )}
        {scope === 'bundle' && (
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Bundle</label>
            <select className="w-full border rounded px-3 py-2" value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy}>
              <option value="">Choose a published bundle…</option>
              {bundles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {bundles.length === 0 && <p className="text-xs text-gray-500 mt-1">You have no published bundles yet.</p>}
          </div>
        )}
        {scope === 'portfolio' && (
          <p className="mt-4 text-sm text-gray-600">
            The discount applies to every published model and bundle you have.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Discount (%)</label>
            <input type="number" min={5} max={90} step={1} className="w-full border rounded px-3 py-2" value={percent} onChange={(e) => setPercent(e.target.value)} disabled={busy} />
            <p className="text-xs text-gray-500 mt-1">Between 5% and 90%.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Duration (days)</label>
            <input type="number" min={1} max={SALE_MAX_DAYS} step={1} className="w-full border rounded px-3 py-2" value={days} onChange={(e) => setDays(e.target.value)} disabled={busy} />
            <p className="text-xs text-gray-500 mt-1">1–{SALE_MAX_DAYS} days.</p>
          </div>
        </div>

        <Button type="submit" className="mt-4" loading={busy} leftIcon={<Tag size={16} />}>
          Start sale
        </Button>
      </form>

      {/* Current + past sales */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-gray-900">Your sales</h2>
        {loading ? (
          <p className="mt-3 text-sm text-gray-500">Loading…</p>
        ) : sales.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No sales yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {[...live, ...past].map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {s.discount_percent}% off · {s.target_name ?? 'Entire portfolio'}
                  </p>
                  <p className="text-xs text-gray-500">
                    <span className={`mr-2 rounded-full px-2 py-0.5 font-medium ${stateBadge[s.state]}`}>{s.state}</span>
                    ends {new Date(s.ends_at).toLocaleDateString()}
                  </p>
                </div>
                {(s.state === 'active' || s.state === 'scheduled') && (
                  <button onClick={() => cancel(s.id)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-red-600">
                    <X size={14} /> End
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ArtistPromotions
