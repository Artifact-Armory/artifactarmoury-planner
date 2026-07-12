// Buyer usage licences (backend migration 030). The per-buyer watermark makes a
// leaked file *traceable*, but it's the licence text here that defines what a buyer
// is actually permitted to do. Neither licence permits redistributing/reselling the
// digital file itself — that's the platform-wide rule the watermark enforces.

export type ModelLicense = 'personal' | 'commercial'

export interface LicenseInfo {
  value: ModelLicense
  label: string
  /** One-line summary for selectors. */
  short: string
  /** Full buyer-facing terms shown on the product page. */
  description: string
}

export const LICENSES: Record<ModelLicense, LicenseInfo> = {
  personal: {
    value: 'personal',
    label: 'Personal use',
    short: 'Print for your own personal use only.',
    description:
      'You may print this model as many times as you like for your own personal, non-commercial use. You may not sell the printed items, and you may not share, resell or redistribute the digital files.',
  },
  commercial: {
    value: 'commercial',
    label: 'Commercial use',
    short: 'Print and sell the physical prints you make.',
    description:
      'You may print this model and sell the physical prints you produce. You may not share, resell or redistribute the digital files themselves.',
  },
}

export const licenseInfo = (value?: string | null): LicenseInfo =>
  LICENSES[(value as ModelLicense)] ?? LICENSES.personal

export const LICENSE_OPTIONS: LicenseInfo[] = [LICENSES.personal, LICENSES.commercial]
