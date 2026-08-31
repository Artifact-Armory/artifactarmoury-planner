import React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Trash2, CheckCircle, Lock, Clock, CreditCard } from 'lucide-react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, AddressElement, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useCartStore, cartKey } from '../store/cartStore'
import { useAuthStore } from '../store/authStore'
import {
  ordersApi,
  OrderItemInput,
  CreatedOrder,
  PaymentMethodChoice,
} from '../api/endpoints/orders'
import { formatPrice } from '../utils/format'
import Button from '../components/ui/Button'
import CountrySelect from '../components/common/CountrySelect'
import { useTaxStore, grossFromLines, vatFromLines } from '../store/taxStore'

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

/** No live Payment Element, so checkout completes through the mock path. */
const testMode = MOCK_CHECKOUT || !stripePromise

/**
 * In-flight confirms for a PayPal redirect return, keyed by PaymentIntent id.
 *
 * StrictMode mounts this page, unmounts it, then mounts it again, so an effect that
 * simply fired the request would send two — and any state the discarded mount set
 * is thrown away with it. Memoising the *promise* at module scope means one request
 * goes out while every mount subscribes to it, so whichever mount survives renders
 * the result. Cleared by a full reload, which is fine: the backend confirm is
 * idempotent and replays the same outcome.
 */
const returnConfirms = new Map<string, Promise<{ pending: boolean }>>()

const Checkout: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
  const [pending, setPending] = React.useState(false)
  const [termsAccepted, setTermsAccepted] = React.useState(false)
  const [method, setMethod] = React.useState<PaymentMethodChoice>('stripe')
  // Real billing address, collected via Stripe's AddressElement in live checkout only
  // (see BillingAddressCapture below). This — not the storefront-wide country picker
  // — is what Stripe Tax actually charges from, so null here blocks "Continue" in
  // live mode until a real address has been entered.
  const [billingAddress, setBillingAddress] = React.useState<{ country: string; postalCode?: string } | null>(null)

  // `subtotal` from the cart is NET. The backend always recomputes tax itself — from
  // the real billing address in live checkout (Stripe Tax), or from this country code
  // as a mock/test fallback — so these figures exist only for the buyer to see a
  // breakdown before that happens, and are never sent as the amount to charge.
  const taxCountry = useTaxStore((s) => s.country)
  const taxRate = useTaxStore((s) => s.rate())
  // Per cart line, matching the gross prices listed above and what the backend
  // charges (services/vat.ts vatOnLines) — so subtotal + VAT reaches exactly the
  // total, and the total is exactly the sum of the line prices on screen.
  const netLines = items.map((i) => i.price)
  const taxAmount = vatFromLines(netLines, taxRate)
  const grossTotal = grossFromLines(netLines, taxRate)

  // Whether this order will collect a real card (Stripe live) or complete via the mock path.
  const realPayment = !!stripePromise && !!order && !isMockSecret(order.clientSecret)

  function finishSuccessfully() {
    clearCart()
    setDone(true)
  }

  // ---------------------------------------------------------------------------
  // Returning from a redirect payment (PayPal).
  //
  // PayPal hands off to its own approval page, so the tab that started checkout is
  // gone by the time payment completes — Stripe sends the buyer back to
  // `/checkout?order=<id>` with its own `payment_intent` params appended. Pick that
  // up and confirm the order, since no in-page `confirmPayment` promise survived.
  // ---------------------------------------------------------------------------
  const returningOrderId = searchParams.get('order')
  const returningIntentId = searchParams.get('payment_intent')
  const redirectStatus = searchParams.get('redirect_status')

  React.useEffect(() => {
    if (!returningOrderId || !returningIntentId) return

    // Tidy the Stripe params off the address bar with `replaceState` rather than
    // `setSearchParams` — the latter is a router navigation, which remounts this page
    // and discards the state we're about to set. `replaceState` emits no popstate, so
    // React Router keeps its own location (and these params stay readable on a
    // remount, which is exactly what the subscribe-per-mount behaviour below needs).
    window.history.replaceState(null, '', window.location.pathname)

    if (redirectStatus === 'failed') {
      setError('Your PayPal payment was declined or cancelled. Your cart is still here — you can try again.')
      return
    }

    let live = true
    let confirm = returnConfirms.get(returningIntentId)
    if (!confirm) {
      confirm = ordersApi.confirmOrder(returningOrderId, returningIntentId)
      returnConfirms.set(returningIntentId, confirm)
    }

    setPlacing(true)
    confirm
      .then((result) => {
        if (!live) return
        if (result.pending) {
          clearCart()
          setPending(true)
        } else {
          finishSuccessfully()
        }
      })
      .catch((err: any) => {
        if (!live) return
        setError(
          err?.response?.data?.message ||
            'We could not confirm your payment. If PayPal took the money it will appear in My Downloads shortly — please check there before paying again.',
        )
      })
      .finally(() => { if (live) setPlacing(false) })

    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returningOrderId, returningIntentId, redirectStatus])

  // Step 1: create the order (and its PaymentIntent). In mock mode we can confirm
  // immediately; in live mode we move to the card-entry step.
  async function handleContinue() {
    if (!user) { navigate('/login'); return }
    if (items.length === 0) return
    if (!termsAccepted) { setError('Please agree to the Terms of Service before purchasing.'); return }
    // Live checkout charges from the real billing address, not the storefront
    // country picker — so it can't proceed without one. Test/mock checkout never hits
    // this (billingAddress stays null, and the backend falls back to taxCountry).
    if (!testMode && !billingAddress) { setError('Please enter your billing address.'); return }
    setPlacing(true)
    setError(null)
    try {
      const orderItems: OrderItemInput[] = items.map((i) =>
        i.kind === 'bundle' ? { bundleId: i.id } : { modelId: i.id },
      )
      const created = await ordersApi.createOrder(orderItems, user.email, termsAccepted, method, taxCountry, billingAddress)
      setOrder(created)

      if (MOCK_CHECKOUT || !stripePromise || isMockSecret(created.clientSecret)) {
        // Mock/test checkout: the payment auto-succeeds, so confirm and finish
        // immediately — no card entry and no PayPal round-trip.
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

  // PayPal can return to the site before the payment has settled. Nothing is
  // unlocked yet — the Stripe webhook finishes the order — so say so honestly
  // rather than showing a success screen over an empty downloads page.
  if (pending) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <Clock className="mx-auto text-amber-500" size={56} />
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Payment processing</h1>
        <p className="mt-2 text-muted-foreground">
          PayPal is still confirming your payment. This usually takes a few moments — your files
          will appear in My Downloads as soon as it clears, and we'll email your receipt. You have
          not been charged twice, so there's no need to pay again.
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
            {/*
              The prices in the list above are already tax-inclusive, so this panel
              exists to *account* for the total, not to add to it — the VAT line
              breaks out tax the buyer has been seeing all along, and the total
              matches what the product page said. Nothing new appears here.

              Live checkout replaces the country picker with a real billing address
              (below): what's actually charged comes from Stripe Tax reading that
              address, not from this picker, so the figures here are an estimate the
              buyer can freely change without it affecting the final charge. Test/mock
              checkout has no Stripe Tax to ask, so it keeps using the picker as the
              real (mock) tax input, same as before Stripe Tax existed.
            */}
            {testMode ? (
              <CountrySelect variant="full" className="mb-4 border-b border-border pb-4" />
            ) : phase === 'review' ? (
              <div className="mb-4 border-b border-border pb-4">
                <p className="text-sm font-medium text-foreground">Billing address</p>
                <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                  Your exact tax is calculated from this address.
                </p>
                <Elements
                  stripe={stripePromise}
                  options={{ mode: 'payment', amount: Math.max(1, Math.round(grossTotal * 100)), currency: 'gbp' }}
                >
                  <BillingAddressCapture onChange={setBillingAddress} />
                </Elements>
              </div>
            ) : null}

            {/* Once a live order exists, its tax/total came back from Stripe Tax and
                are authoritative; before that (or in test mode throughout) these are
                the storefront's own estimate. */}
            {(() => {
              const showingFinal = !testMode && !!order
              const displayTax = showingFinal ? (order!.tax ?? 0) : taxAmount
              const displayTotal = showingFinal ? order!.total : grossTotal
              const displayRate = showingFinal ? (order!.taxRate ?? 0) : taxRate
              return displayRate > 0 ? (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
                    <span className="text-foreground">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">VAT ({displayRate}%){!showingFinal && !testMode ? ' — estimated' : ''}</span>
                    <span className="text-foreground">{formatPrice(displayTax)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <span className="text-sm font-medium text-foreground">Total</span>
                    <span className="text-xl font-bold text-foreground">{formatPrice(displayTotal)}</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-xl font-bold text-foreground">{formatPrice(displayTotal)}</span>
                </div>
              )
            })()}
            {!user && (
              <p className="mt-3 text-xs text-amber-700">You'll be asked to sign in to complete your purchase.</p>
            )}

            {phase === 'review' ? (
              <>
                {/*
                  Live Stripe renders its own method tabs (PayPal included, once it's
                  activated on the account), so this picker exists only for the test
                  checkout — it drives which path the mock takes so the PayPal flow is
                  exercisable without live keys.
                */}
                {testMode ? (
                  <fieldset className="mt-4">
                    <legend className="text-xs font-medium text-muted-foreground">Pay with</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {([
                        { value: 'stripe', label: 'Card', icon: <CreditCard size={14} /> },
                        { value: 'paypal', label: 'PayPal', icon: null },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setMethod(opt.value)}
                          aria-pressed={method === opt.value}
                          className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            method === opt.value
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:bg-accent'
                          }`}
                        >
                          {opt.icon}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Pay by card or PayPal — choose on the next step.
                  </p>
                )}

                <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I agree to the{' '}
                    <Link to="/terms-of-service" target="_blank" className="underline hover:text-foreground">
                      Terms of Service
                    </Link>
                    , including the licence terms for each item in my cart (I will not use a
                    model beyond what its licence permits, e.g. selling prints of a
                    personal-use-only model). I want my download to start immediately and I
                    understand this means I lose my 14-day right to cancel once it begins.
                  </span>
                </label>

                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                <Button
                  className="mt-4 w-full"
                  onClick={handleContinue}
                  disabled={placing || !termsAccepted || (!testMode && !billingAddress)}
                >
                  {placing
                    ? 'Processing…'
                    : !testMode
                      ? `Continue to payment · ${formatPrice(grossTotal)} est.`
                      : `Pay ${formatPrice(grossTotal)} with ${method === 'paypal' ? 'PayPal' : 'card'} (test)`}
                </Button>
                <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
                  <Lock size={11} />
                  {!testMode ? 'Card and PayPal, secured by Stripe' : 'Test checkout — no real payment is taken.'}
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
                    total={order.total}
                    onSuccess={finishSuccessfully}
                    onPending={() => { clearCart(); setPending(true) }}
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
// Live billing-address step, rendered inside its own (deferred, clientSecret-less)
// <Elements> instance ahead of order creation — this is what Stripe Tax computes the
// real charge from, replacing the storefront country picker for this purpose. Only
// reports a value once the buyer has entered a complete address; anything partial or
// cleared reports null so "Continue" stays disabled rather than sending a stale one.
// ---------------------------------------------------------------------------
const BillingAddressCapture: React.FC<{
  onChange: (address: { country: string; postalCode?: string } | null) => void
}> = ({ onChange }) => {
  return (
    <AddressElement
      options={{ mode: 'billing' }}
      onChange={(event) => {
        if (event.complete) {
          onChange({ country: event.value.address.country, postalCode: event.value.address.postal_code || undefined })
        } else {
          onChange(null)
        }
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Live card-entry step. Rendered inside <Elements>, so it can use the Stripe hooks.
// ---------------------------------------------------------------------------
const PaymentForm: React.FC<{
  order: CreatedOrder
  total: number
  onSuccess: () => void
  onPending: () => void
  onBack: () => void
}> = ({ order, total, onSuccess, onPending, onBack }) => {
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
      // `return_url` is mandatory for any method that leaves the site. Cards settle
      // in place and `redirect: 'if_required'` keeps them here, but PayPal always
      // hands off to its approval page — without a return_url Stripe rejects the
      // confirm outright rather than falling back. The order id rides along in the
      // URL so the page we come back to knows what to confirm.
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: `${window.location.origin}/checkout?order=${encodeURIComponent(order.id)}`,
        },
      })

      if (stripeError) {
        setError(stripeError.message || 'Payment could not be completed. Please check your payment details.')
        return
      }

      // Reached only for methods that settled without leaving the page — a redirect
      // method never gets here, it resumes in the return-URL effect above.
      if (paymentIntent?.status === 'succeeded') {
        // Tell our backend to verify the intent and unlock the downloads.
        await ordersApi.confirmOrder(order.id, order.paymentIntentId ?? paymentIntent.id)
        onSuccess()
      } else if (paymentIntent?.status === 'processing') {
        const result = await ordersApi.confirmOrder(order.id, order.paymentIntentId ?? paymentIntent.id)
        result.pending ? onPending() : onSuccess()
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
