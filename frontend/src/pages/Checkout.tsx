import React, { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { loadStripe, StripeCardElementOptions } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import toast from 'react-hot-toast'
import { useCartStore } from '../store/cartStore'
import apiClient from '../api/client'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { formatPrice } from '../utils/format'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '')

type ShippingForm = {
  name: string
  email: string
  line1: string
  line2?: string
  city: string
  state?: string
  postalCode: string
  country: string
}

const defaultShipping: ShippingForm = {
  name: '',
  email: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'US'
}

const cardElementOptions: StripeCardElementOptions = {
  hidePostalCode: true,
  style: {
    base: {
      color: '#111827',
      fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
      fontSize: '16px',
      '::placeholder': {
        color: '#9CA3AF'
      }
    },
    invalid: {
      color: '#DC2626'
    }
  }
}

const CheckoutForm: React.FC = () => {
  const stripe = useStripe()
  const elements = useElements()
  const navigate = useNavigate()
  const location = useLocation()
  const { items, subtotal, clearCart } = useCartStore()
  const queryParams = new URLSearchParams(location.search)

  const [formState, setFormState] = useState<ShippingForm>({
    name: queryParams.get('name') ?? defaultShipping.name,
    email: queryParams.get('email') ?? defaultShipping.email,
    line1: queryParams.get('line1') ?? defaultShipping.line1,
    line2: queryParams.get('line2') ?? defaultShipping.line2,
    city: queryParams.get('city') ?? defaultShipping.city,
    state: queryParams.get('state') ?? defaultShipping.state,
    postalCode: queryParams.get('postalCode') ?? defaultShipping.postalCode,
    country: queryParams.get('country') ?? defaultShipping.country
  })
  const [submitting, setSubmitting] = useState(false)

  const shippingEstimate = useMemo(
    () => (items.length ? Math.max(4.99, items.length * 1.5) : 0),
    [items]
  )
  const total = subtotal + shippingEstimate

  const updateField =
    (field: keyof ShippingForm) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!stripe || !elements) {
      toast.error('Stripe is still loading, please try again in a moment.')
      return
    }

    if (!items.length) {
      toast.error('Your cart is empty.')
      return
    }

    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      toast.error('Payment field unavailable. Please refresh and try again.')
      return
    }

    setSubmitting(true)

    try {
      const orderPayload = {
        items: items.map((item) => ({
          modelId: item.modelId,
          quantity: item.quantity
        })),
        shipping: {
          name: formState.name,
          email: formState.email,
          line1: formState.line1,
          line2: formState.line2,
          city: formState.city,
          state: formState.state,
          postalCode: formState.postalCode,
          country: formState.country
        },
        customerEmail: formState.email
      }

      const { data } = await apiClient.post('/api/orders', orderPayload)
      const orderData = data?.order ?? data?.data ?? data

      const clientSecret = orderData?.clientSecret
      const orderId = orderData?.id ?? orderData?.orderId

      if (!clientSecret) {
        throw new Error('Failed to initialize payment.')
      }

      const paymentResult = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: formState.name,
            email: formState.email,
            address: {
              line1: formState.line1,
              line2: formState.line2 ?? undefined,
              city: formState.city,
              state: formState.state,
              postal_code: formState.postalCode,
              country: formState.country
            }
          }
        }
      })

      if (paymentResult.error) {
        throw paymentResult.error
      }

      clearCart()
      toast.success('Payment successful! Thanks for your order.')
      if (orderId) {
        navigate(`/orders/${orderId}`)
      } else {
        navigate('/dashboard/orders')
      }
    } catch (error: any) {
      console.error('Checkout error', error)
      toast.error(
        error?.message || 'Something went wrong while processing your payment.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 lg:flex-row">
      <form
        onSubmit={handleSubmit}
        className="flex-1 space-y-6 rounded-3xl bg-white p-8 shadow"
      >
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Checkout</h1>
          <p className="mt-1 text-sm text-gray-600">
            Enter your shipping details, then confirm payment to receive your downloads.
          </p>
        </div>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Shipping information</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Full name"
              required
              value={formState.name}
              onChange={updateField('name')}
            />
            <Input
              label="Contact email"
              type="email"
              required
              value={formState.email}
              onChange={updateField('email')}
            />
          </div>
          <Input
            label="Address line 1"
            required
            value={formState.line1}
            onChange={updateField('line1')}
          />
          <Input
            label="Address line 2"
            value={formState.line2}
            onChange={updateField('line2')}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="City"
              required
              value={formState.city}
              onChange={updateField('city')}
            />
            <Input
              label="State / Region"
              value={formState.state}
              onChange={updateField('state')}
            />
            <Input
              label="Postal code"
              required
              value={formState.postalCode}
              onChange={updateField('postalCode')}
            />
          </div>
          <Input
            label="Country"
            required
            value={formState.country}
            onChange={updateField('country')}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Payment details</h2>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <CardElement options={cardElementOptions} />
          </div>
        </section>

        <Button type="submit" loading={submitting} disabled={submitting || !items.length}>
          Pay {formatPrice(total)}
        </Button>
      </form>

      <aside className="w-full rounded-3xl border border-gray-200 bg-white p-6 shadow lg:w-96">
        <h2 className="text-lg font-semibold text-gray-900">Order summary</h2>
        <div className="mt-4 space-y-4">
          {items.length ? (
            items.map((item) => (
              <div key={item.modelId} className="flex justify-between text-sm text-gray-700">
                <div>
                  <p className="font-medium text-gray-900">{item.name}</p>
                  <p className="text-xs">{item.artistName}</p>
                  <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                </div>
                <span className="font-medium text-gray-900">
                  {formatPrice(item.price * item.quantity)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">Your cart is empty.</p>
          )}
        </div>

        <dl className="mt-6 space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="font-medium text-gray-900">{formatPrice(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Shipping</dt>
            <dd className="font-medium text-gray-900">{formatPrice(shippingEstimate)}</dd>
          </div>
        </dl>

        <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4 text-base font-semibold text-gray-900">
          <span>Total due</span>
          <span>{formatPrice(total)}</span>
        </div>
      </aside>
    </div>
  )
}

const CheckoutPage: React.FC = () => {
  if (!stripePromise) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-lg font-semibold text-gray-900">Stripe configuration missing</p>
        <p className="mt-2 text-sm text-gray-600">
          Add <code className="font-mono">VITE_STRIPE_PUBLISHABLE_KEY</code> to your environment to enable
          checkout.
        </p>
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={{ appearance: { theme: 'flat' } }}>
      <CheckoutForm />
    </Elements>
  )
}

export default CheckoutPage

