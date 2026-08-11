import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, Trash2 } from 'lucide-react'
import Button from '../ui/Button'
import { useCartStore, cartKey } from '../../store/cartStore'
import PriceDisplay from '../models/PriceDisplay'
import { Badge } from '../shadcn/badge'

const CartDrawer: React.FC = () => {
  const {
    isOpen,
    items,
    subtotal,
    totalItems,
    toggleCart,
    closeCart,
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
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={() => closeCart()}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-md border-l border-border bg-background shadow-xl transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Shopping Cart</h2>
            <p className="text-sm text-muted-foreground">
              {totalItems} item{totalItems === 1 ? '' : 's'} in your cart
            </p>
          </div>
          <button
            onClick={() => toggleCart()}
            className="rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-hidden focus:ring-2 focus:ring-ring"
            aria-label="Close cart"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex h-[calc(100%-200px)] flex-col overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-base font-medium text-foreground">Your cart is empty</p>
              <p className="mt-2 text-sm text-muted-foreground">
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
                <li key={cartKey(item.kind, item.id)} className="flex items-start justify-between">
                  <div className="flex">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="ml-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">{item.name}</h3>
                        {item.kind === 'bundle' && <Badge className="text-[10px]">BUNDLE</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{item.artistName}</p>
                      <div className="mt-1">
                        <PriceDisplay price={item.price} originalPrice={item.originalPrice} />
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => removeItem(cartKey(item.kind, item.id))}
                    className="ml-4 rounded-full p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus:outline-hidden"
                    aria-label="Remove item"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Subtotal</span>
            <span className="text-lg font-semibold text-foreground">
              £{subtotal.toFixed(2)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
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
