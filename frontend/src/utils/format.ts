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

