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
}
