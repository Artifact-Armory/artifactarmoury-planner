import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { taxApi, type TaxCountry } from '../api/endpoints/tax'

/**
 * The buyer's country and the VAT rate that follows from it.
 *
 * Artist prices are stored NET. Everything the buyer sees is GROSS (net + their
 * country's VAT), so the number on a product card is the number they pay — no fee
 * appearing for the first time at checkout. Artist and admin screens keep showing
 * net, because that's what artists actually earn on.
 */
interface TaxState {
  /** ISO 3166-1 alpha-2, or null until we've guessed or the buyer has chosen. */
  country: string | null
  /** True once the buyer picked explicitly — stops the guess overriding them later. */
  chosen: boolean
  countries: TaxCountry[]
  loaded: boolean

  setCountry: (code: string) => void
  loadCountries: () => Promise<void>
  /** VAT percentage for the current country (0 if unknown or zero-rated). */
  rate: () => number
  /** Net → what the buyer pays. */
  gross: (net: number) => number
}

/**
 * Opening guess from the browser's locale region ('en-GB' → 'GB'). Deliberately
 * only a guess: it's a display default the buyer can change, never evidence of
 * where they are for tax purposes (see the note in Checkout).
 */
function guessCountry(available: TaxCountry[], fallback: string): string {
  const codes = new Set(available.map((c) => c.code))
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean) as string[]

  for (const tag of candidates) {
    const region = tag.split('-')[1]?.toUpperCase()
    if (region && codes.has(region)) return region
  }
  return fallback
}

/**
 * Net → gross, and the ONLY place the storefront does this arithmetic.
 *
 * Must stay byte-for-byte equivalent to `vatPenceOn` in `backend/src/services/vat.ts`,
 * because the buyer is shown this figure and charged that one. They were briefly
 * different — this grossed up in a single step while the backend added a separately
 * rounded VAT line, which disagreed by 1p on floating-point ties (at 25% VAT a £4.10
 * model displayed £5.13 and charged £5.12). Working in integer pence, with the same
 * expression on both sides, is what keeps them identical.
 */
export function grossFromNet(net: number, rate: number): number {
  if (!rate || rate <= 0 || !Number.isFinite(net)) return net
  const netPence = Math.round(net * 100)
  return (netPence + Math.round((netPence * rate) / 100)) / 100
}

/** VAT alone, for the checkout breakdown line. */
export function vatFromNet(net: number, rate: number): number {
  if (!rate || rate <= 0 || !Number.isFinite(net)) return 0
  return Math.round((Math.round(net * 100) * rate) / 100) / 100
}

/**
 * VAT on a basket: **per line, then summed** — never the rate applied to the basket
 * total. Mirrors `vatOnLines` in backend/src/services/vat.ts.
 *
 * Each cart line renders its own gross price, so the total has to be the sum of
 * those lines or the basket visibly fails to add up (two models at £4.10 and £0.58
 * at Swedish 25% show as £5.13 + £0.73 = £5.86, whereas taxing £4.68 as one lump
 * gives £5.85). Pass one entry per *cart line*: a bundle is a single line at its own
 * price, not its constituent models.
 */
export function vatFromLines(nets: number[], rate: number): number {
  if (!rate || rate <= 0) return 0
  const pence = nets.reduce(
    (sum, net) => sum + (Number.isFinite(net) ? Math.round((Math.round(net * 100) * rate) / 100) : 0),
    0,
  )
  return pence / 100
}

/** What the buyer pays for a basket: net lines + their per-line VAT. */
export function grossFromLines(nets: number[], rate: number): number {
  const netPence = nets.reduce((sum, net) => sum + (Number.isFinite(net) ? Math.round(net * 100) : 0), 0)
  return (netPence + Math.round(vatFromLines(nets, rate) * 100)) / 100
}

export const useTaxStore = create<TaxState>()(
  persist(
    (set, get) => ({
      country: null,
      chosen: false,
      countries: [],
      loaded: false,

      setCountry: (code) => set({ country: code.toUpperCase(), chosen: true }),

      loadCountries: async () => {
        if (get().loaded) return
        try {
          const { countries, defaultCountry } = await taxApi.getCountries()
          set((state) => ({
            countries,
            loaded: true,
            // Never overwrite an explicit choice, even a stale persisted one.
            country: state.chosen && state.country
              ? state.country
              : guessCountry(countries, defaultCountry),
          }))
        } catch {
          // Rates unavailable: fall through showing net prices rather than blocking
          // the storefront. `rate()` returns 0 with an empty list, so prices simply
          // read as they did before tax existed.
          set({ loaded: true })
        }
      },

      rate: () => {
        const { country, countries } = get()
        if (!country) return 0
        return countries.find((c) => c.code === country)?.rate ?? 0
      },

      gross: (net) => grossFromNet(net, get().rate()),
    }),
    {
      name: 'tax-storage',
      // Rates are refetched each session so a rate change reaches returning buyers;
      // only the buyer's own choice is worth persisting.
      partialize: (state) => ({ country: state.country, chosen: state.chosen }),
    }
  )
)

/**
 * Subscribing hook for prices. Reads the rate reactively so every price on screen
 * re-renders the moment the buyer switches country.
 */
export function useGrossPrice(): (net: number) => number {
  const rate = useTaxStore((s) => s.rate())
  return (net: number) => grossFromNet(net, rate)
}
