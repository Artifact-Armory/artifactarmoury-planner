import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trash2, CheckCircle, Lock } from 'lucide-react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useCartStore, cartKey } from '../store/cartStore'
import { useAuthStore } from '../store/authStore'
import { ordersApi, OrderItemInput, CreatedOrder } from '../api/endpoints/orders'
import { formatPrice } from '../utils/format'
import Button from '../components/ui/Button'

// Load Stripe.js once, only if a publishable key is configured. When it's absent
// (or the backend is running in STRIPE_MOCK mode) checkout falls back to the mock
// flow — create the order then confirm the auto-succeeded payment, no card needed.
const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined
const stripePromise: Promise<Stripe | null> | null = PUBLISHABLE_KEY
  ? loadStripe(PUBLISHABLE_KEY)
  : null

// Payments are mocked while the marketplace is pre-launch, so checkout completes
// WITHOUT a card — you can "buy" models to test purchases (reviews, downloads,
// entitlements). This defaults on; to collect real cards later, set
// VITE_MOCK_CHECKOUT=false and provide VITE_STRIPE_PUBLISHABLE_KEY (the backend
// must also leave STRIPE_MOCK/PAYMENTS_ENABLED unset).
const MOCK_CHECKOUT = import.meta.env.VITE_MOCK_CHECKOUT !== 'false'

/** A client secret from the mock Stripe path — no real card entry is possible. */
const isMockSecret = (secret?: string) => !secret || secret.startsWith('cs_mock')

const Checkout: React.FC = () => {
  const navigate = useNavigate()
  const items = useCartStore((s) => s.items)
  const subtotal = useCartStore((s) => s.subtotal)
  const removeItem = useCartStore((s) => s.removeItem)
  const clearCart = useCartStore((s) => s.clearCart)
  const user = useAuthStore((s) => s.user)

  const [phase, setPhase] = React.useState<'review' | 'pay'>('review')
  const [order, setOrder] = React.useState<CreatedOrder | null>(null)
  const [placing, setPlacing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)
  const [consent, setConsent] = React.useState(false)

  // Whether this order will collect a real card (Stripe live) or complete via the mock path.
  const realPayment = !!stripePromise && !!order && !isMockSecret(order.clientSecret)

  function finishSuccessfully() {
    clearCart()
    setDone(true)
  }

  // Step 1: create the order (and its PaymentIntent). In mock mode we can confirm
  // immediately; in live mode we move to the card-entry step.
  async function handleContinue() {
    if (!user) { navigate('/login'); return }
    if (items.length === 0) return
    if (!consent) { setError('Please confirm you agree to your download starting immediately.'); return }
    setPlacing(true)
    setError(null)
    try {
      const orderItems: OrderItemInput[] = items.map((i) =>
        i.kind === 'bundle' ? { bundleId: i.id } : { modelId: i.id },
      )
      const created = await ordersApi.createOrder(orderItems, user.email, consent)
      setOrder(created)

      if (MOCK_CHECKOUT || !stripePromise || isMockSecret(created.clientSecret)) {
        // Mock/test checkout: the payment auto-succeeds, so confirm and finish
        // immediately — no card entry.
        await ordersApi.confirmOrder(created.id, created.paymentIntentId ?? created.clientSecret ?? 'mock')
        finishSuccessfully()
      } else {
        // Live Stripe: collect the card next.
        setPhase('pay')
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Checkout failed — please try again.')
    } finally {
      setPlacing(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <CheckCircle className="mx-auto text-green-500" size={56} />
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Purchase complete</h1>
        <p className="mt-2 text-muted-foreground">
          Your STL files are now unlocked. Download them any time from My Downloads — we've also
          emailed your receipt with download links.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/dashboard/downloads" className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            My downloads
          </Link>
          <Link to="/browse" className="rounded-md border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent">
            Keep browsing
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Checkout</h1>
      <p className="text-muted-foreground mt-1">Digital STL downloads — no shipping. You pay once per item.</p>

      {items.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <p className="text-foreground font-medium">Your cart is empty</p>
          <Link to="/browse" className="mt-4 inline-flex rounded-md bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20">
            Browse models
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <ul className="divide-y rounded-lg border bg-card">
            {items.map((item) => (
              <li key={cartKey(item.kind, item.id)} className="flex items-center gap-4 p-4">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-sm bg-muted">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[10px] text-muted-foreground">No image</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{item.name}</span>
                    {item.kind === 'bundle' && (
                      <span className="rounded-sm bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">BUNDLE</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{item.artistName}</p>
                </div>
                {item.originalPrice != null && item.originalPrice > item.price ? (
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-semibold text-rose-600">{formatPrice(item.price)}</span>
                    <span className="text-xs text-muted-foreground line-through">{formatPrice(item.originalPrice)}</span>
                  </span>
                ) : (
                  <span className="font-semibold text-foreground">{formatPrice(item.price)}</span>
                )}
                {phase === 'review' && (
                  <button
                    onClick={() => removeItem(cartKey(item.kind, item.id))}
                    className="rounded-full p-2 text-muted-foreground hover:bg-red-50 hover:text-red-500"
                    aria-label="Remove item"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <aside className="h-fit rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-xl font-bold text-foreground">{formatPrice(subtotal)}</span>
            </div>
            {!user && (
              <p className="mt-3 text-xs text-amber-700">You'll be asked to sign in to complete your purchase.</p>
            )}

            {phase === 'review' ? (
              <>
                <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I want my download to start immediately and I understand I lose my 14-day right
                    to cancel once it begins.
                  </span>
                </label>

                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                <Button className="mt-4 w-full" onClick={handleContinue} disabled={placing || !consent}>
                  {placing
                    ? 'Processing…'
                    : stripePromise && !MOCK_CHECKOUT
                      ? `Continue to payment · ${formatPrice(subtotal)}`
                      : `Pay ${formatPrice(subtotal)} (test)`}
                </Button>
                <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
                  <Lock size={11} />
                  {stripePromise && !MOCK_CHECKOUT ? 'Payments secured by Stripe' : 'Test checkout — no real payment is taken.'}
                </p>
              </>
            ) : (
              order && realPayment && (
                <Elements
                  stripe={stripePromise}
                  options={{ clientSecret: order.clientSecret, appearance: { theme: 'stripe' } }}
                >
                  <PaymentForm
                    order={order}
                    total={subtotal}
                    onSuccess={finishSuccessfully}
                    onBack={() => { setPhase('review'); setOrder(null) }}
                  />
                </Elements>
              )
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live card-entry step. Rendered inside <Elements>, so it can use the Stripe hooks.
// ---------------------------------------------------------------------------
const PaymentForm: React.FC<{
  order: CreatedOrder
  total: number
  onSuccess: () => void
  onBack: () => void
}> = ({ order, total, onSuccess, onBack }) => {
  const stripe = useStripe()
  const elements = useElements()
  const [paying, setPaying] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setPaying(true)
    setError(null)
    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      })

      if (stripeError) {
        setError(stripeError.message || 'Payment could not be completed. Please check your card details.')
        return
      }

      if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
        // Tell our backend to verify the intent and unlock the downloads.
        await ordersApi.confirmOrder(order.id, order.paymentIntentId ?? paymentIntent.id)
        onSuccess()
      } else {
        setError('Payment did not complete. Please try again.')
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Payment failed — please try again.')
    } finally {
      setPaying(false)
    }
  }

  return (
    <form onSubmit={handlePay} className="mt-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <Button type="submit" className="mt-4 w-full" disabled={!stripe || paying}>
        {paying ? 'Processing payment…' : `Pay ${formatPrice(total)}`}
      </Button>
      <button
        type="button"
        onClick={onBack}
        disabled={paying}
        className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Back to cart
      </button>
      <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
        <Lock size={11} /> Payments secured by Stripe
      </p>
    </form>
  )
}

export default Checkout
