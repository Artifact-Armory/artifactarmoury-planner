import React from 'react'
import toast from 'react-hot-toast'
import { Tag, X, Ticket, Pause, Play } from 'lucide-react'
import { salesApi, SaleRecord, SaleScope, SALE_MAX_DAYS } from '../../api/endpoints/sales'
import {
  promoCodesApi,
  PromoCodeRecord,
  PromoScope,
  PromoDiscountType,
  PROMO_MIN_PERCENT,
  PROMO_MAX_PERCENT,
} from '../../api/endpoints/promoCodes'
import { modelsApi } from '../../api/endpoints/models'
import { bundlesApi } from '../../api/endpoints/bundles'
import { TerrainModel, Bundle } from '../../api/types'
import { formatPrice } from '../../utils/format'
import Button from '../../components/ui/Button'

const stateBadge: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  scheduled: 'bg-blue-100 text-blue-700',
  ended: 'bg-muted text-muted-foreground',
  canceled: 'bg-muted text-muted-foreground',
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

  // Promo codes
  const [codes, setCodes] = React.useState<PromoCodeRecord[]>([])
  const [codeScope, setCodeScope] = React.useState<PromoScope>('model')
  const [codeTargetId, setCodeTargetId] = React.useState('')
  const [codeText, setCodeText] = React.useState('')
  const [discountType, setDiscountType] = React.useState<PromoDiscountType>('percent')
  const [discountValue, setDiscountValue] = React.useState('10')
  const [maxRedemptions, setMaxRedemptions] = React.useState('')
  const [maxPerCustomer, setMaxPerCustomer] = React.useState('1')
  const [codeBusy, setCodeBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [s, m, b, c] = await Promise.all([
        salesApi.mine(),
        modelsApi.getMyModels({ limit: 100 }),
        bundlesApi.getMyBundles(),
        promoCodesApi.mine(),
      ])
      setSales(s)
      setModels((m.models ?? []).filter((x) => x.status === 'published'))
      setBundles((b ?? []).filter((x) => x.status === 'published'))
      setCodes(c)
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
  React.useEffect(() => {
    setCodeTargetId('')
  }, [codeScope])

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

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (codeScope === 'model' && !codeTargetId) {
      toast.error('Choose a model for this code')
      return
    }
    const value = Number(discountValue)
    setCodeBusy(true)
    try {
      await promoCodesApi.create({
        code: codeText,
        scope: codeScope,
        targetId: codeScope === 'model' ? codeTargetId : undefined,
        discountType,
        discountValue: value,
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
        maxRedemptionsPerCustomer: maxPerCustomer ? Number(maxPerCustomer) : undefined,
      })
      toast.success('Promo code created')
      setCodeText('')
      setDiscountValue('10')
      setMaxRedemptions('')
      setMaxPerCustomer('1')
      setCodeTargetId('')
      await load()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not create the code')
    } finally {
      setCodeBusy(false)
    }
  }

  const toggleCode = async (id: string) => {
    try {
      await promoCodesApi.toggle(id)
      await load()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not update the code')
    }
  }

  const live = sales.filter((s) => s.state === 'active' || s.state === 'scheduled')
  const past = sales.filter((s) => s.state === 'ended' || s.state === 'canceled')

  return (
    <div className="px-4 py-10 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-foreground">Promotions &amp; sales</h1>
      <p className="mt-1 text-muted-foreground">
        Put a model, a bundle, or your whole portfolio on sale. On-sale items can appear in the
        front-page sale carousel.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">The rules (so sales stay meaningful):</p>
        <ul className="mt-1 ml-5 list-disc space-y-0.5">
          <li>A sale runs for up to {SALE_MAX_DAYS} days.</li>
          <li>After a sale ends there's a cooldown before you can run another on the same item.</li>
          <li>You can't discount a price you raised in the last 30 days — the “was” price must be genuine.</li>
        </ul>
      </div>

      {/* Create a sale */}
      <form onSubmit={submit} className="mt-6 rounded-2xl border border-border p-5">
        <h2 className="text-base font-semibold text-foreground">Start a sale</h2>

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
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {scope === 'model' && (
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Model</label>
            <select className="w-full border rounded-sm px-3 py-2" value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy}>
              <option value="">Choose a published model…</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {models.length === 0 && <p className="text-xs text-muted-foreground mt-1">You have no published models yet.</p>}
          </div>
        )}
        {scope === 'bundle' && (
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Bundle</label>
            <select className="w-full border rounded-sm px-3 py-2" value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy}>
              <option value="">Choose a published bundle…</option>
              {bundles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {bundles.length === 0 && <p className="text-xs text-muted-foreground mt-1">You have no published bundles yet.</p>}
          </div>
        )}
        {scope === 'portfolio' && (
          <p className="mt-4 text-sm text-muted-foreground">
            The discount applies to every published model and bundle you have.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Discount (%)</label>
            <input type="number" min={5} max={90} step={1} className="w-full border rounded-sm px-3 py-2" value={percent} onChange={(e) => setPercent(e.target.value)} disabled={busy} />
            <p className="text-xs text-muted-foreground mt-1">Between 5% and 90%.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Duration (days)</label>
            <input type="number" min={1} max={SALE_MAX_DAYS} step={1} className="w-full border rounded-sm px-3 py-2" value={days} onChange={(e) => setDays(e.target.value)} disabled={busy} />
            <p className="text-xs text-muted-foreground mt-1">1–{SALE_MAX_DAYS} days.</p>
          </div>
        </div>

        <Button type="submit" className="mt-4" loading={busy} leftIcon={<Tag size={16} />}>
          Start sale
        </Button>
      </form>

      {/* Current + past sales */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-foreground">Your sales</h2>
        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : sales.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No sales yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {[...live, ...past].map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {s.discount_percent}% off · {s.target_name ?? 'Entire portfolio'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className={`mr-2 rounded-full px-2 py-0.5 font-medium ${stateBadge[s.state]}`}>{s.state}</span>
                    ends {new Date(s.ends_at).toLocaleDateString()}
                  </p>
                </div>
                {(s.state === 'active' || s.state === 'scheduled') && (
                  <button onClick={() => cancel(s.id)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-red-600">
                    <X size={14} /> End
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* Promo codes — a private code a buyer must be given, unlike a Sale  */}
      {/* which is automatic and public. The discount comes entirely out of */}
      {/* your own commission share, never the platform's.                 */}
      {/* ================================================================ */}
      <div className="mt-12 border-t border-border pt-8">
        <h1 className="text-xl font-semibold text-foreground">Promo codes</h1>
        <p className="mt-1 text-muted-foreground">
          Give buyers a private code for a discount on one model or your whole portfolio. Unlike a
          sale, nobody sees this unless you share the code — and the discount comes out of your
          own share of the price, never the platform's commission.
        </p>

        <form onSubmit={submitCode} className="mt-6 rounded-2xl border border-border p-5">
          <h2 className="text-base font-semibold text-foreground">Create a code</h2>

          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">Code</label>
            <input
              type="text"
              className="w-full border rounded-sm px-3 py-2 uppercase"
              placeholder="e.g. FRIENDS10"
              value={codeText}
              onChange={(e) => setCodeText(e.target.value)}
              disabled={codeBusy}
              maxLength={40}
            />
            <p className="text-xs text-muted-foreground mt-1">Letters, numbers and hyphens. Buyers enter this exactly at checkout.</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ['model', 'A model'],
              ['portfolio', 'Entire portfolio'],
            ] as [PromoScope, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setCodeScope(value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                  codeScope === value
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {codeScope === 'model' && (
            <div className="mt-4">
              <label className="block text-sm font-medium mb-1">Model</label>
              <select className="w-full border rounded-sm px-3 py-2" value={codeTargetId} onChange={(e) => setCodeTargetId(e.target.value)} disabled={codeBusy}>
                <option value="">Choose a published model…</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Discount type</label>
              <select className="w-full border rounded-sm px-3 py-2" value={discountType} onChange={(e) => setDiscountType(e.target.value as PromoDiscountType)} disabled={codeBusy}>
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{discountType === 'percent' ? 'Percent (%)' : 'Amount (£)'}</label>
              <input
                type="number"
                min={discountType === 'percent' ? PROMO_MIN_PERCENT : 0.01}
                max={discountType === 'percent' ? PROMO_MAX_PERCENT : undefined}
                step={discountType === 'percent' ? 1 : 0.01}
                className="w-full border rounded-sm px-3 py-2"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                disabled={codeBusy}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Max total uses</label>
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Unlimited"
                className="w-full border rounded-sm px-3 py-2"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                disabled={codeBusy}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max uses per customer</label>
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Unlimited"
                className="w-full border rounded-sm px-3 py-2"
                value={maxPerCustomer}
                onChange={(e) => setMaxPerCustomer(e.target.value)}
                disabled={codeBusy}
              />
            </div>
          </div>

          <Button type="submit" className="mt-4" loading={codeBusy} leftIcon={<Ticket size={16} />}>
            Create code
          </Button>
        </form>

        <div className="mt-8">
          <h2 className="text-base font-semibold text-foreground">Your codes</h2>
          {loading ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
          ) : codes.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No promo codes yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {codes.map((c) => {
                const uses = c.max_redemptions != null ? `${c.redemption_count} / ${c.max_redemptions} used` : `${c.redemption_count} used`
                const discount = c.discount_type === 'percent' ? `${c.discount_value}% off` : `${formatPrice(Number(c.discount_value))} off`
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        <span className="font-mono">{c.code}</span> · {discount} · {c.target_name ?? 'Entire portfolio'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className={`mr-2 rounded-full px-2 py-0.5 font-medium ${c.active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                          {c.active ? 'Active' : 'Paused'}
                        </span>
                        {uses}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleCode(c.id)}
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                      title={c.active ? 'Pause this code' : 'Resume this code'}
                    >
                      {c.active ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ArtistPromotions
