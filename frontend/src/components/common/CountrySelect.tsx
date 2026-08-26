import React from 'react'
import { Globe } from 'lucide-react'
import { useTaxStore } from '../../store/taxStore'

interface CountrySelectProps {
  /** `compact` for the header strip; `full` for the checkout panel. */
  variant?: 'compact' | 'full'
  className?: string
  id?: string
}

/**
 * Lets the buyer say where they are, which sets the VAT rate baked into every price
 * on the site. Changing it re-renders prices immediately — the whole point is that
 * the buyer sees their real total from the first product card, not at checkout.
 */
const CountrySelect: React.FC<CountrySelectProps> = ({
  variant = 'compact',
  className = '',
  id = 'tax-country',
}) => {
  const country = useTaxStore((s) => s.country)
  const countries = useTaxStore((s) => s.countries)
  const setCountry = useTaxStore((s) => s.setCountry)

  // Nothing useful to offer until the rates have loaded (or if the request failed,
  // in which case prices are showing net and a picker would imply otherwise).
  if (countries.length === 0) return null

  const select = (
    <select
      id={id}
      value={country ?? ''}
      onChange={(e) => setCountry(e.target.value)}
      className={
        variant === 'compact'
          ? 'cursor-pointer rounded-md border-0 bg-transparent py-1 pl-1 pr-6 text-xs text-muted-foreground hover:text-foreground focus:ring-1 focus:ring-primary'
          : 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary'
      }
    >
      {countries.map((c) => (
        <option key={c.code} value={c.code}>
          {variant === 'compact' ? c.code : c.name}
          {c.rate > 0 ? ` — ${c.rate}% VAT` : ''}
        </option>
      ))}
    </select>
  )

  if (variant === 'compact') {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <Globe size={13} className="text-muted-foreground" aria-hidden="true" />
        <label htmlFor={id} className="sr-only">
          Your country, for tax-inclusive prices
        </label>
        {select}
      </span>
    )
  }

  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        Your country
      </label>
      <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
        Sets the VAT rate included in the prices shown.
      </p>
      {select}
    </div>
  )
}

export default CountrySelect
