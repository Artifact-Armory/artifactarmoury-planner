import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import toast from 'react-hot-toast'
import apiClient from '../api/client'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useCartStore } from '../store/cartStore'
import type { CartItem } from '../store/cartStore'
import { formatPrice } from '../utils/format'

type ShippingFields = {
  name: string
  email: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
}

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null

type CheckoutFormProps = {
  items: CartItem[]
  subtotal: number
  clearCart: () => void
}

const CheckoutForm: React.FC<CheckoutFormProps> = ({ items, subtotal, clearCart }) => {
  const navigate = useNavigate()
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [shipping, setShipping] = useState<ShippingFields>({
    name: '',
    email: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'GB',
  })

  const shippingEstimate = useMemo(
    () => (items.length ? Math.max(4.99, items.length * 1.5) : 0),
    [items.length],
  )

  const total = useMemo(() => subtotal + shippingEstimate, [subtotal, shippingEstimate])

  const handleChange =
    (field: keyof ShippingFields) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setShipping((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!stripe || !elements) {
      toast.error('Payment system is still loading. Please try again in a moment.')
      return
    }

    if (!items.length) {
      toast.error('Your cart is empty.')
      return
    }

    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      toast.error('Unable to load payment form. Please refresh and try again.')
      return
    }

    setProcessing(true)

    try {
      const orderPayload = {
        items: items.map((item) => ({
          modelId: item.modelId,
          quantity: item.quantity,
        })),
        customerEmail: shipping.email.trim(),
        shipping: {
          name: shipping.name.trim(),
          line1: shipping.line1.trim(),
          line2: shipping.line2 ? shipping.line2.trim() : undefined,
          city: shipping.city.trim(),
          state: shipping.state ? shipping.state.trim() : undefined,
          postalCode: shipping.postalCode.trim(),
          country: shipping.country.trim() || 'GB',
        },
      }

      const createResponse = await apiClient.post('/api/orders', orderPayload)
      const order = createResponse.data?.order ?? createResponse.data
      const clientSecret = order?.clientSecret ?? order?.client_secret
      const orderId: string | undefined = order?.id ?? order?.orderId ?? order?.order_id

      if (!clientSecret || !orderId) {
        throw new Error('Order creation failed. Missing payment information.')
      }

      const confirmation = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: shipping.name,
            email: shipping.email,
            address: {
              line1: shipping.line1,
              line2: shipping.line2 || undefined,
              city: shipping.city,
              state: shipping.state || undefined,
              postal_code: shipping.postalCode,
              country: shipping.country || 'GB',
            },
          },
        },
      })

      if (confirmation.error) {
        throw new Error(confirmation.error.message || 'Payment was not successful.')
      }

      const paymentIntentId = confirmation.paymentIntent?.id
      if (!paymentIntentId) {
        throw new Error('Payment confirmation failed. Missing payment intent.')
      }

      await apiClient.post(`/api/orders/${orderId}/confirm`, { paymentIntentId })

      toast.success('Order placed successfully!')
      clearCart()
      navigate(`/orders/${orderId}`)
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : (error as any)?.response?.data?.error ?? 'Checkout failed. Please try again.'
      toast.error(message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Shipping information</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            name="name"
            value={shipping.name}
            onChange={handleChange('name')}
            required
          />
          <Input
            label="Email address"
            name="email"
            type="email"
            value={shipping.email}
            onChange={handleChange('email')}
            required
          />
        </div>
        <div className="mt-4 space-y-4">
          <Input
            label="Address line 1"
            name="line1"
            value={shipping.line1}
            onChange={handleChange('line1')}
            required
          />
          <Input
            label="Address line 2 (optional)"
            name="line2"
            value={shipping.line2}
            onChange={handleChange('line2')}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="City"
            name="city"
            value={shipping.city}
            onChange={handleChange('city')}
            required
          />
          <Input
            label="State / Province"
            name="state"
            value={shipping.state}
            onChange={handleChange('state')}
          />
          <Input
            label="Postal code"
            name="postalCode"
            value={shipping.postalCode}
            onChange={handleChange('postalCode')}
            required
          />
          <Input
            label="Country"
            name="country"
            value={shipping.country}
            onChange={handleChange('country')}
            required
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Payment details</h2>
        <div className="mt-4 rounded-md border border-gray-200 px-4 py-3">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#1f2937',
                  '::placeholder': { color: '#9ca3af' },
                },
                invalid: {
                  color: '#ef4444',
                },
              },
            }}
          />
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Order summary</h2>
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item.modelId} className="flex items-center justify-between text-sm text-gray-600">
              <div>
                <p className="font-medium text-gray-900">{item.name}</p>
                <p className="text-xs text-gray-500">
                  {item.artistName} · Qty {item.quantity}
                </p>
              </div>
              <span className="font-medium text-gray-900">
                {formatPrice(item.price * item.quantity)}
              </span>
            </div>
          ))}
        </div>

        <dl className="mt-6 space-y-2 text-sm text-gray-600">
          <div className="flex items-center justify-between">
            <dt>Items subtotal</dt>
            <dd className="font-medium text-gray-900">{formatPrice(subtotal)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Shipping estimate</dt>
            <dd className="font-medium text-gray-900">{formatPrice(shippingEstimate)}</dd>
          </div>
        </dl>

        <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4 text-base font-semibold text-gray-900">
          <span>Total due</span>
          <span>{formatPrice(total)}</span>
        </div>
      </section>

      <Button type="submit" size="lg" className="w-full" loading={processing}>
        {processing ? 'Processing payment…' : `Pay ${formatPrice(total)}`}
      </Button>
    </form>
  )
}

const Checkout: React.FC = () => {
  const navigate = useNavigate()
  const { items, subtotal, clearCart } = useCartStore((state) => ({
    items: state.items,
    subtotal: state.subtotal,
    clearCart: state.clearCart,
  }))

  useEffect(() => {
    if (!items.length) {
      navigate('/browse', { replace: true })
    }
  }, [items.length, navigate])

  if (!items.length) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Your cart is empty</h1>
        <p className="mt-2 text-sm text-gray-600">Add some terrain to your cart before checking out.</p>
      </div>
    )
  }

  if (!stripePromise) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Stripe not configured</h1>
        <p className="mt-2 text-sm text-gray-600">
          Set <code className="font-mono">VITE_STRIPE_PUBLISHABLE_KEY</code> in your environment to enable checkout.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-semibold text-gray-900">Checkout</h1>
      <p className="mt-2 text-sm text-gray-600">
        Enter your shipping details and payment information to complete your order.
      </p>

      <div className="mt-8">
        <Elements stripe={stripePromise}>
          <CheckoutForm items={items} subtotal={subtotal} clearCart={clearCart} />
        </Elements>
      </div>
    </div>
  )
}

export default Checkout
