import React from 'react'
import { useLocalPrice } from '../../store/taxStore'

/**
 * "About €8.90" under a basket total for buyers outside the UK. Display only: the
 * order is always charged in pounds and the buyer's bank does the conversion, so we
 * say so plainly rather than let the guide figure read as the charge.
 */
const LocalPriceNote: React.FC<{ gbp: number; className?: string }> = ({ gbp, className }) => {
  const local = useLocalPrice()(gbp)
  if (!local) return null
  return (
    <p className={className ?? 'mt-1 text-xs text-muted-foreground'}>
      About {local}. You pay the pound price shown; your bank turns it into your currency at its own rate.
    </p>
  )
}

export default LocalPriceNote
