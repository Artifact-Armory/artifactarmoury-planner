import React from 'react'
import { formatPrice } from '../../utils/format'
import { Badge } from '../shadcn/badge'
import { cn } from '../../utils/cn'

interface PriceDisplayProps {
  price: number
  /** Pre-sale price — when present and higher than `price`, renders struck-through. */
  originalPrice?: number
  /** Percent-off badge; only shown when the item is actually on sale. */
  salePercent?: number | null
  size?: 'sm' | 'lg'
  className?: string
}

/**
 * Single source of truth for the current-price / struck-through-original /
 * percent-off-badge pattern — previously duplicated across ModelCard,
 * SaleCarousel, ModelDetails and BundleDetails.
 */
const PriceDisplay: React.FC<PriceDisplayProps> = ({
  price,
  originalPrice,
  salePercent,
  size = 'sm',
  className,
}) => {
  const onSale = originalPrice != null && originalPrice > price

  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span
        className={cn(
          size === 'lg' ? 'text-3xl font-bold' : 'text-sm font-semibold',
          onSale ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
        )}
      >
        {formatPrice(price)}
      </span>
      {onSale && (
        <span
          className={cn(
            'text-muted-foreground line-through',
            size === 'lg' ? 'text-lg' : 'text-xs'
          )}
        >
          {formatPrice(originalPrice)}
        </span>
      )}
      {onSale && salePercent != null && (
        <Badge className="bg-rose-600/90 text-white dark:bg-rose-500/90">-{salePercent}%</Badge>
      )}
    </span>
  )
}

export default PriceDisplay
