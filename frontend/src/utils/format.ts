export const formatPrice = (value: number | string, currency: string = 'GBP'): string => {
  const n = Number(value)
  if (Number.isNaN(n)) return '£0.00'
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(n)
}

export const formatRating = (rating?: number | string | null): string => {
  if (rating === undefined || rating === null) {
    return '—'
  }
  const n = Number(rating)
  return Number.isNaN(n) ? '—' : n.toFixed(1)
}

/** "482 KB" / "3.02 GB" — binary-ish (1000-based, matches how R2/network sizes are usually quoted) file size. */
export const formatBytes = (bytes?: number | string | null): string | null => {
  if (bytes === undefined || bytes === null) return null
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 1000) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`
}

