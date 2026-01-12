import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, Trash2, Minus, Plus } from 'lucide-react'
import Button from '../ui/Button'
import { useCartStore } from '../../store/cartStore'

const CartDrawer: React.FC = () => {
  const {
    isOpen,
    items,
    subtotal,
    totalItems,
    toggleCart,
    closeCart,
    updateQuantity,
    removeItem,
  } = useCartStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalOverflow
      }
    }
    return
  }, [isOpen])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-50 transition ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={() => closeCart()}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Shopping Cart</h2>
            <p className="text-sm text-gray-500">
              {totalItems} item{totalItems === 1 ? '' : 's'} in your cart
            </p>
          </div>
          <button
            onClick={() => toggleCart()}
            className="rounded-full p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            aria-label="Close cart"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex h-[calc(100%-200px)] flex-col overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-base font-medium text-gray-700">Your cart is empty</p>
              <p className="mt-2 text-sm text-gray-500">
                Browse models and add them to your cart to begin checkout.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => closeCart()}
              >
                Continue browsing
              </Button>
            </div>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={item.modelId} className="flex items-start justify-between">
                  <div className="flex">
                    <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="ml-4">
                      <h3 className="text-sm font-medium text-gray-900">{item.name}</h3>
                      <p className="text-xs text-gray-500">{item.artistName}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        £{item.price.toFixed(2)}
                      </p>

                      <div className="mt-2 inline-flex items-center rounded-md border border-gray-200">
                        <button
                          className="px-2 py-1 text-gray-600 hover:bg-gray-50"
                          onClick={() => updateQuantity(item.modelId, item.quantity - 1)}
                          aria-label="Decrease quantity"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="px-3 text-sm font-medium">{item.quantity}</span>
                        <button
                          className="px-2 py-1 text-gray-600 hover:bg-gray-50"
                          onClick={() => updateQuantity(item.modelId, item.quantity + 1)}
                          aria-label="Increase quantity"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => removeItem(item.modelId)}
                    className="ml-4 rounded-full p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 focus:outline-none"
                    aria-label="Remove item"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500">Subtotal</span>
            <span className="text-lg font-semibold text-gray-900">
              £{subtotal.toFixed(2)}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Taxes and discounts calculated at checkout.
          </p>
          <Button
            className="mt-4 w-full"
            disabled={items.length === 0}
            onClick={() => {
              closeCart()
              navigate('/checkout')
            }}
          >
            Go to checkout
          </Button>
        </footer>
      </aside>
    </div>,
    document.body
  )
}

export default CartDrawer
