import React from 'react'
import { formatPrice } from '../../utils/format'
import { Badge } from '../shadcn/badge'
import { cn } from '../../utils/cn'
import { useGrossPrice, useTaxStore } from '../../store/taxStore'

interface PriceDisplayProps {
  /** NET price as the artist set it. VAT for the buyer's country is added here. */
  price: number
  /** Pre-sale price — when present and higher than `price`, renders struck-through. */
  originalPrice?: number
  /** Percent-off badge; only shown when the item is actually on sale. */
  salePercent?: number | null
  size?: 'sm' | 'lg'
  className?: string
  /**
   * Show the "incl. 20% VAT" note under the price. On for prominent prices (product
   * and bundle pages); off in dense lists where one note per row would be noise —
   * the cart and checkout state it once for the whole basket instead.
   */
  showTaxNote?: boolean
}

/**
 * Single source of truth for the current-price / struck-through-original /
 * percent-off-badge pattern — previously duplicated across ModelCard,
 * SaleCarousel, ModelDetails and BundleDetails.
 *
 * It is also where NET artist prices become the GROSS price the buyer pays, which is
 * why every buyer-facing surface routes through it: the figure on a product card is
 * the figure charged at checkout, with no fee appearing later. Artist and admin
 * screens deliberately do NOT use this component — they show net, because net is
 * what an artist earns on.
 */
const PriceDisplay: React.FC<PriceDisplayProps> = ({
  price,
  originalPrice,
  salePercent,
  size = 'sm',
  className,
  showTaxNote = false,
}) => {
  const gross = useGrossPrice()
  const rate = useTaxStore((s) => s.rate())

  const onSale = originalPrice != null && originalPrice > price
  // Both figures are grossed up, so the struck-through original stays comparable.
  const shownPrice = gross(price)
  const shownOriginal = originalPrice != null ? gross(originalPrice) : undefined

  return (
    <span className={cn('inline-flex flex-col', className)}>
      <span className="inline-flex items-baseline gap-1.5">
        <span
          className={cn(
            size === 'lg' ? 'text-3xl font-bold' : 'text-sm font-semibold',
            onSale ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
          )}
        >
          {formatPrice(shownPrice)}
        </span>
        {onSale && shownOriginal != null && (
          <span
            className={cn(
              'text-muted-foreground line-through',
              size === 'lg' ? 'text-lg' : 'text-xs'
            )}
          >
            {formatPrice(shownOriginal)}
          </span>
        )}
        {onSale && salePercent != null && (
          <Badge className="bg-rose-600/90 text-white dark:bg-rose-500/90">-{salePercent}%</Badge>
        )}
      </span>
      {showTaxNote && rate > 0 && (
        <span className="text-xs text-muted-foreground">incl. {rate}% VAT</span>
      )}
    </span>
  )
}

export default PriceDisplay
