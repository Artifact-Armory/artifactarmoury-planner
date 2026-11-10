import apiClient from '../client'

export type TaxCountry = {
  /** ISO 3166-1 alpha-2. */
  code: string
  name: string
  /** Standard VAT rate as a percentage, e.g. 20 for 20%. */
  rate: number
}

export type TaxCountries = {
  defaultCountry: string
  countries: TaxCountry[]
}

export type FxRates = {
  /** Units of each currency per £1, e.g. { EUR: 1.14 }. */
  rates: Record<string, number>
  /** Tax country code → its currency, e.g. { DE: 'EUR' }. */
  countryCurrency: Record<string, string>
}

export const taxApi = {
  /**
   * VAT rates come from the backend rather than a frontend constant so a rate change
   * ships with a backend deploy, and so the price the buyer is shown can never
   * disagree with the one the order is charged at.
   */
  async getCountries(): Promise<TaxCountries> {
    const response = await apiClient.get('/api/tax/countries')
    return {
      defaultCountry: response.data?.defaultCountry ?? 'GB',
      countries: (response.data?.countries ?? []).map((c: any) => ({
        code: c.code,
        name: c.name,
        rate: Number(c.rate ?? 0),
      })),
    }
  },

  /** Exchange rates for the guide price in the buyer's currency. Display only: checkout always charges GBP. */
  async getFx(): Promise<FxRates> {
    const response = await apiClient.get('/api/tax/fx')
    return {
      rates: response.data?.rates ?? {},
      countryCurrency: response.data?.countryCurrency ?? {},
    }
  },
}
