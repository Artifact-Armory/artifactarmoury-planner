export type LicenseOption = {
  value: string
  label: string
  description?: string
}

export const LICENSE_OPTIONS: LicenseOption[] = [
  {
    value: 'standard-commercial',
    label: 'Standard Commercial',
    description: 'Commercial use allowed; redistribution prohibited.',
  },
  {
    value: 'personal-use',
    label: 'Personal Use Only',
    description: 'Personal printing permitted. No reselling or commercial usage.',
  },
  { value: 'cc0', label: 'Creative Commons CC0', description: 'Public domain dedication.' },
  {
    value: 'cc-by',
    label: 'Creative Commons CC-BY',
    description: 'Reuse allowed with attribution.',
  },
  {
    value: 'cc-by-sa',
    label: 'Creative Commons CC-BY-SA',
    description: 'Share alike; derivatives must keep same license.',
  },
  {
    value: 'cc-by-nd',
    label: 'Creative Commons CC-BY-ND',
    description: 'No derivatives; attribution required.',
  },
  {
    value: 'cc-by-nc',
    label: 'Creative Commons CC-BY-NC',
    description: 'Non-commercial use with attribution.',
  },
]

const labelMap = LICENSE_OPTIONS.reduce<Record<string, string>>((acc, option) => {
  acc[option.value] = option.label
  return acc
}, {})

export const formatLicense = (code?: string | null): string => {
  if (!code) return 'Unlicensed'
  return labelMap[code] ?? code
}
