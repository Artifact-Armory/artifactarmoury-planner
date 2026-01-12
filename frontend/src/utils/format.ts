export const formatPrice = (value: number, currency: string = 'GBP'): string => {
  if (Number.isNaN(value)) return '£0.00'
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

export const formatRating = (rating?: number): string => {
  if (rating === undefined || rating === null) {
    return '—'
  }
  return rating.toFixed(1)
}

