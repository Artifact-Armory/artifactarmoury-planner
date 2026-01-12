export const formatPrice = (value: number, currency: string = 'GBP'): string => {
  if (Number.isNaN(value)) return '£0.00'
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

export const formatRating = (rating?: number): string => {
  const numeric = Number(rating)
  if (!Number.isFinite(numeric)) {
    return '—'
  }
  return numeric.toFixed(1)
}
