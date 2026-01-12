import React, { useEffect, useMemo, useRef } from 'react'
import { ShoppingCart, Trash2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'

import { useAppStore } from '@state/store'
import { useBuilderUIStore } from '@state/uiStore'
import { calculateBasketTotal } from '@core/pricing'

interface BasketPillProps {
  inline?: boolean
}

function BasketThumbnail({ label, thumbnail }: { label: string; thumbnail?: string }) {
  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt="Model thumbnail"
        className="h-[60px] w-[60px] rounded-md object-cover"
      />
    )
  }

  return (
    <div className="flex h-[60px] w-[60px] items-center justify-center rounded-md bg-gradient-to-br from-slate-700 via-slate-600 to-slate-500 text-base font-semibold text-white/80">
      {label.slice(0, 2)}
    </div>
  )
}

export function BasketPill({ inline = false }: BasketPillProps) {
  const basket = useAppStore((s) => s.basket)
  const assets = useAppStore((s) => s.assets)
  const removeFromBasket = useAppStore((s) => s.actions.removeFromBasket)
  const clearBasket = useAppStore((s) => s.actions.clearBasket)

  const basketOpen = useBuilderUIStore((s) => s.basketOpen)
  const setBasketOpen = useBuilderUIStore((s) => s.setBasketOpen)
  const setActivePanel = useBuilderUIStore((s) => s.setActivePanel)

  const totalItems = basket.reduce((sum, item) => sum + item.quantity, 0)
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])

  const summary = useMemo(() => {
    if (!basket.length || assetsById.size === 0) return null
    return calculateBasketTotal(basket, assetsById)
  }, [basket, assetsById])

  const prevCountRef = useRef(totalItems)
  useEffect(() => {
    if (totalItems > prevCountRef.current && totalItems > 0) {
      toast.success('Added to basket', { duration: 2000 })
    }
    prevCountRef.current = totalItems
  }, [totalItems])

  useEffect(() => {
    if (!basketOpen) return
    const handleClickAway = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-basket-pill]')) return
      setBasketOpen(false)
    }
    window.addEventListener('mousedown', handleClickAway)
    return () => window.removeEventListener('mousedown', handleClickAway)
  }, [basketOpen, setBasketOpen])

  const subtotal = summary?.subtotal ?? 0

  const containerClasses = inline
    ? 'pointer-events-auto relative flex items-center'
    : 'pointer-events-auto absolute right-6 top-6 z-30 flex items-center'

  return (
    <div className={containerClasses} data-basket-pill>
      <button
        type="button"
        onClick={() => setBasketOpen(!basketOpen)}
        aria-label="View basket"
        className="relative flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/85 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-slate-900/40 backdrop-blur-md transition-all duration-200 hover:bg-slate-800/90 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/20 text-sky-200">
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          {totalItems > 0 && (
            <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white" aria-live="polite">
              {totalItems}
            </span>
          )}
        </span>
        <span className="text-left leading-snug">
          <span className="block text-xs text-slate-400">Basket</span>
          <span className="block text-sm font-semibold">{totalItems} items · £{subtotal.toFixed(2)}</span>
        </span>
      </button>

      <span className="sr-only" role="status" aria-live="polite">
        {totalItems} items in basket
      </span>

      {basketOpen && (
        <>
          <div className="pointer-events-none fixed inset-0 z-10 bg-black/40" />
          <div
            className="absolute right-0 top-[calc(100%+12px)] z-20 w-[380px] max-w-[calc(100vw-32px)] rounded-xl border border-white/10 bg-slate-900/95 p-4 text-sm text-white shadow-xl shadow-black/50 backdrop-blur-lg transition-transform duration-200 ease-out"
          >
            <header className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-base font-semibold">Basket</p>
                <p className="text-xs text-slate-400">Review your selected models</p>
              </div>
              {basket.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearBasket()}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-800/80 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300 transition-all duration-200 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear All
                </button>
              )}
            </header>

            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {summary && summary.items.length > 0 ? (
                summary.items.map((item) => {
                  const asset = item.asset
                  const creator = asset ? asset.name.split(' ')[0] : 'Creator'
                  return (
                    <div
                      key={asset.id}
                      className="flex items-center gap-3 rounded-lg border border-white/10 bg-slate-800/70 px-3 py-2 shadow-md transition-all duration-200 hover:shadow-lg"
                    >
                      <BasketThumbnail label={asset.name} thumbnail={asset.thumbnail} />
                      <div className="flex-1">
                        <p className="truncate text-sm font-semibold text-slate-100">{asset.name}</p>
                        <p className="text-xs text-slate-400">{creator}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm font-semibold text-slate-100">£{item.lineTotal.toFixed(2)}</span>
                        <button
                          type="button"
                          onClick={() => removeFromBasket(asset.id)}
                          aria-label={`Remove ${asset.name} from basket`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-300 transition-colors duration-200 hover:bg-red-500/20 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 bg-slate-800/60 p-4 text-center text-xs text-slate-300">
                  <ShoppingCart className="h-5 w-5 text-slate-500" />
                  <p>Your basket is empty. Add models from the marketplace.</p>
                </div>
              )}
            </div>

            <footer className="mt-4 space-y-3">
              <button
                type="button"
                onClick={() => {
                  setBasketOpen(false)
                  setActivePanel('marketplace')
                }}
                className="w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm font-semibold text-slate-200 transition-all duration-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                Continue Shopping
              </button>

              <div className="border-t border-white/10 pt-3 text-right text-base font-semibold text-slate-100">
                Subtotal: £{subtotal.toFixed(2)}
              </div>

              <button
                type="button"
                onClick={() => toast('Checkout coming soon!')}
                className="w-full rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/40 transition-all duration-200 hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                Checkout
              </button>
            </footer>
          </div>
        </>
      )}
    </div>
  )
}
