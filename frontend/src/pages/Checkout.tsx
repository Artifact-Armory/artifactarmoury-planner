import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trash2, CheckCircle } from 'lucide-react'
import { useCartStore, cartKey } from '../store/cartStore'
import { useAuthStore } from '../store/authStore'
import { ordersApi, OrderItemInput } from '../api/endpoints/orders'
import { formatPrice } from '../utils/format'
import Button from '../components/ui/Button'

const Checkout: React.FC = () => {
  const navigate = useNavigate()
  const items = useCartStore((s) => s.items)
  const subtotal = useCartStore((s) => s.subtotal)
  const removeItem = useCartStore((s) => s.removeItem)
  const clearCart = useCartStore((s) => s.clearCart)
  const user = useAuthStore((s) => s.user)

  const [placing, setPlacing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)

  async function handlePay() {
    if (!user) { navigate('/login'); return }
    if (items.length === 0) return
    setPlacing(true)
    setError(null)
    try {
      const orderItems: OrderItemInput[] = items.map((i) =>
        i.kind === 'bundle' ? { bundleId: i.id } : { modelId: i.id },
      )
      // Mock Stripe: create the order, then confirm the (auto-succeeded) payment.
      const order = await ordersApi.createOrder(orderItems, user.email)
      await ordersApi.confirmOrder(order.id, order.paymentIntentId ?? order.clientSecret ?? 'mock')
      clearCart()
      setDone(true)
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
        <h1 className="mt-4 text-2xl font-semibold text-gray-900">Purchase complete</h1>
        <p className="mt-2 text-gray-600">
          Your STL files are now unlocked. Download them any time from your models or your
          purchase history.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/dashboard/purchases" className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">
            My purchases
          </Link>
          <Link to="/browse" className="rounded-md border px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Keep browsing
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900">Checkout</h1>
      <p className="text-gray-600 mt-1">Digital STL downloads — no shipping. You pay once per item.</p>

      {items.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-gray-700 font-medium">Your cart is empty</p>
          <Link to="/browse" className="mt-4 inline-flex rounded-md bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
            Browse models
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1.4fr_0.6fr]">
          <ul className="divide-y rounded-lg border bg-white">
            {items.map((item) => (
              <li key={cartKey(item.kind, item.id)} className="flex items-center gap-4 p-4">
                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[10px] text-gray-400">No image</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-gray-900">{item.name}</span>
                    {item.kind === 'bundle' && (
                      <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">BUNDLE</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{item.artistName}</p>
                </div>
                <span className="font-semibold text-gray-900">{formatPrice(item.price)}</span>
                <button
                  onClick={() => removeItem(cartKey(item.kind, item.id))}
                  className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  aria-label="Remove item"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>

          <aside className="h-fit rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Total</span>
              <span className="text-xl font-bold text-gray-900">{formatPrice(subtotal)}</span>
            </div>
            {!user && (
              <p className="mt-3 text-xs text-amber-700">You'll be asked to sign in to complete your purchase.</p>
            )}
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <Button className="mt-4 w-full" onClick={handlePay} disabled={placing}>
              {placing ? 'Processing…' : `Pay ${formatPrice(subtotal)} (mock)`}
            </Button>
            <p className="mt-2 text-center text-[11px] text-gray-400">
              Test checkout — no real payment is taken.
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}

export default Checkout
