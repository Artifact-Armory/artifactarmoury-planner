// src/ui/Basket.tsx
import React from 'react'
import { useAppStore } from '@state/store'
import { calculateBasketTotal, calculatePricing } from '@core/pricing'

export function Basket() {
  const basket = useAppStore((s) => s.basket)
  const assets = useAppStore((s) => s.assets)
  const removeFromBasket = useAppStore((s) => s.actions.removeFromBasket)
  const clearBasket = useAppStore((s) => s.actions.clearBasket)
  const markAsPurchased = useAppStore((s) => s.actions.markAsPurchased)

  const assetsById = React.useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])

  const summary = React.useMemo(() => {
    if (basket.length === 0) return null
    try {
      return calculateBasketTotal(basket, assetsById)
    } catch (error) {
      console.error('Error calculating basket total:', error)
      return null
    }
  }, [basket, assetsById])

  // Calculate savings from repeat purchases
  const repeatSavings = React.useMemo(() => {
    if (!summary) return 0
    let savings = 0
    summary.items.forEach((item) => {
      const repeatQty = (item as any).repeatQty || 0
      if (repeatQty > 0) {
        const pricing = calculatePricing(item.asset)
        const savingsPerUnit = pricing.firstPurchase.total - pricing.repeatPurchase.total
        savings += savingsPerUnit * repeatQty
      }
    })
    return savings
  }, [summary])

  const handleCheckout = () => {
    if (!summary) return
    const assetIds = basket.map((item) => item.assetId)
    markAsPurchased(assetIds)
    alert(`Order placed! Total: \\u00a3${summary.subtotal.toFixed(2)}\\n\\nIn a real app, this would process payment.`)
    clearBasket()
  }

  if (basket.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Basket</h3>
        <div className="tb-small" style={{ color: '#9fb2c8', marginBottom: 12 }}>
          Your basket is empty. Place buildings on the table to add them here.
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Basket ({basket.length})</h3>
        <button className="tb-btn" onClick={clearBasket} style={{ padding: '4px 8px', fontSize: 12 }}>
          Clear All
        </button>
      </div>

      <div style={{ marginBottom: 12, maxHeight: 300, overflowY: 'auto' }}>
        {summary?.items.map((item) => {
          const pricing = calculatePricing(item.asset)
          const firstQty = (item as any).firstQty || 0
          const repeatQty = (item as any).repeatQty || 0

          return (
            <div
              key={item.asset.id}
              style={{
                background: '#0e141c',
                padding: 8,
                borderRadius: 6,
                marginBottom: 6,
                border: '1px solid #243246',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{item.asset.name}</div>
                  <div className="tb-small" style={{ color: '#9fb2c8', marginTop: 2 }}>
                    {firstQty > 0 && repeatQty > 0 ? (
                      <>
                        <span style={{ color: '#4da3ff' }}>
                          {firstQty} x \\u00a3{pricing.firstPurchase.total.toFixed(2)}
                        </span>
                        {' + '}
                        <span style={{ color: '#3fbf5a' }}>
                          {repeatQty} x \\u00a3{pricing.repeatPurchase.total.toFixed(2)}
                        </span>
                      </>
                    ) : firstQty > 0 ? (
                      <span style={{ color: '#4da3ff' }}>
                        {firstQty} x \\u00a3{pricing.firstPurchase.total.toFixed(2)}
                      </span>
                    ) : (
                      <span style={{ color: '#3fbf5a' }}>
                        {repeatQty} x \\u00a3{pricing.repeatPurchase.total.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="tb-btn"
                  onClick={() => removeFromBasket(item.asset.id)}
                  style={{ padding: '2px 6px', fontSize: 12 }}
                  title="Remove all from table and basket"
                >
                  Remove
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <div className="tb-small" style={{ color: '#9fb2c8' }}>
                  Total: {item.quantity} {item.quantity === 1 ? 'building' : 'buildings'}
                </div>
                <div style={{ fontWeight: 600 }}>
                  \u00a3{item.lineTotal.toFixed(2)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {summary && (
        <>
          <div style={{ borderTop: '1px solid #243246', paddingTop: 12, marginBottom: 12 }}>
            {repeatSavings > 0 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                  padding: 8,
                  background: '#0e3a1f',
                  borderRadius: 6,
                  border: '1px solid #3fbf5a',
                }}
              >
                <span className="tb-small" style={{ color: '#3fbf5a', fontWeight: 500 }}>
                  Repeat Building Discount:
                </span>
                <span className="tb-small" style={{ color: '#3fbf5a', fontWeight: 600 }}>
                  -\u00a3{repeatSavings.toFixed(2)}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 600 }}>
              <span>Total:</span>
              <span>\u00a3{summary.subtotal.toFixed(2)}</span>
            </div>
          </div>

          <button
            className="tb-btn"
            onClick={handleCheckout}
            style={{
              width: '100%',
              background: '#4da3ff',
              color: '#fff',
              fontWeight: 600,
              padding: 12,
            }}
          >
            Checkout
          </button>
        </>
      )}
    </div>
  )
}
