import React from 'react'
import { useTaxStore } from '../../store/taxStore'

interface CountrySelectProps {
  /** `compact` for the header strip; `full` for the checkout panel. */
  variant?: 'compact' | 'full'
  className?: string
  id?: string
}

/**
 * ISO 3166-1 alpha-2 → flag emoji, via the regional-indicator-symbol trick
 * (each letter A-Z maps to U+1F1E6.. by offsetting from 'A'). Every code this
 * store deals with is a real alpha-2, so this always yields a valid flag.
 */
function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
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

  if (variant === 'compact') {
    // Just a country picker here — the flag identifies the selection, no VAT
    // number attached. The rate still applies to prices; it's just not spelled
    // out in the nav bar (that detail belongs to the checkout breakdown).
    const current = countries.find((c) => c.code === country)
    return (
      <span className={`relative inline-flex items-center ${className}`}>
        <span className="pointer-events-none text-base leading-none" aria-hidden="true">
          {current ? flagEmoji(current.code) : '🏳️'}
        </span>
        <label htmlFor={id} className="sr-only">
          Your country, for tax-inclusive prices
        </label>
        <select
          id={id}
          value={country ?? ''}
          onChange={(e) => setCountry(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {flagEmoji(c.code)} {c.name}
            </option>
          ))}
        </select>
      </span>
    )
  }

  const select = (
    <select
      id={id}
      value={country ?? ''}
      onChange={(e) => setCountry(e.target.value)}
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary"
    >
      {countries.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
          {c.rate > 0 ? ` — ${c.rate}% VAT` : ''}
        </option>
      ))}
    </select>
  )

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
