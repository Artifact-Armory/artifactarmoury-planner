import apiClient from '../client'

export interface TaxTerm {
  id: string
  slug: string
  name: string
  path: string
  depth: number
  synonyms: string[] | null
  ratio: string | null
  count?: number
  children: TaxTerm[]
}

export interface TaxFacet {
  id: string
  slug: string
  name: string
  description: string | null
  selectionUi: 'tree' | 'chips' | 'grouped' | 'flat'
  required: boolean
  maxTerms: number | null
  /** Model-class slugs this facet applies to; null/empty = universal (all classes). */
  appliesTo: string[] | null
  terms: TaxTerm[]
}

/** The top-level model classes (slugs match the `model-class` facet terms). */
export const MODEL_CLASS_SLUG = 'model-class'
export const MODEL_CLASSES = [
  { slug: 'terrain', label: 'Terrain' },
  { slug: 'vehicles', label: 'Vehicles' },
  { slug: 'characters', label: 'Characters & Units' },
] as const
export type ModelClassSlug = (typeof MODEL_CLASSES)[number]['slug']

/**
 * Whether a facet is relevant to a given model class. A facet with no `appliesTo`
 * (null/empty) is universal. When no class is selected (`classSlug` null), only
 * universal facets and the `model-class` facet itself are considered applicable.
 */
export function facetAppliesTo(facet: TaxFacet, classSlug: string | null): boolean {
  if (facet.slug === MODEL_CLASS_SLUG) return true
  const scoped = facet.appliesTo && facet.appliesTo.length > 0
  if (!scoped) return true
  if (!classSlug) return false
  return facet.appliesTo!.includes(classSlug)
}

/** A model's tags come back grouped-friendly from GET /api/models/:id. */
export interface ModelTaxonomyTerm {
  facetSlug: string
  facetName: string
  termId: string
  path: string
  name: string
}

/** A selection token is `facetSlug:termPath` — the same wire format browse uses. */
export const termToken = (facetSlug: string, path: string) => `${facetSlug}:${path}`

export interface FacetFilterParams {
  terms?: string // comma-separated facetSlug:path tokens
  search?: string
  category?: string
  minPrice?: number
  maxPrice?: number
  hideZero?: boolean
}

export const taxonomyApi = {
  /** The full facet tree (no counts) — for upload pickers + the rail scaffold. */
  getTree: async (): Promise<TaxFacet[]> => {
    const response = await apiClient.get('/api/taxonomy')
    return response.data?.facets ?? []
  },

  /** The facet tree with live per-term counts for a filter context. */
  getFacetsWithCounts: async (params: FacetFilterParams = {}): Promise<TaxFacet[]> => {
    const response = await apiClient.get('/api/taxonomy/facets', {
      params: {
        terms: params.terms || undefined,
        search: params.search || undefined,
        category: params.category || undefined,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        hideZero: params.hideZero ? '1' : undefined,
      },
    })
    return response.data?.facets ?? []
  },
}
