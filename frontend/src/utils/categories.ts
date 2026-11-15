// Buyer-facing names for the stored listing categories (models.category).
const LABELS: Record<string, string> = {
  buildings: 'Buildings',
  characters: 'Characters',
  vehicles: 'Vehicles',
  nature: 'Nature',
  scatter: 'Scatter',
  props: 'Props',
  complete_sets: 'Complete sets',
  other: 'Other',
}

export function categoryLabel(category?: string | null): string {
  if (!category) return ''
  return LABELS[category] ?? category.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
