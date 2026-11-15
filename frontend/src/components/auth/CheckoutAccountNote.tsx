import React from 'react'
import { ShieldCheck } from 'lucide-react'

/**
 * Why a buyer needs an account, shown on checkout and on the sign-in /
 * sign-up pages when they came from checkout. Downloads are watermarked to
 * the buyer's account, so a purchase can't be anonymous.
 */
const CheckoutAccountNote: React.FC<{ className?: string }> = ({ className = 'mt-3' }) => (
  <div className={`${className} flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground`}>
    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
    <p>
      <span className="font-medium text-foreground">One quick step to finish your order.</span> Your files are
      watermarked to your account, so you need a free account to buy. Your downloads stay in your library to
      re-download any time, and your basket is saved.
    </p>
  </div>
)

export default CheckoutAccountNote
