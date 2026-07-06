import apiClient from '../client'

export interface AnalyticsRange { from: string; to: string }

export interface PeriodTotals {
  sales: number; gross: number; net: number
  views: number; placements: number; wishlist: number; conversion: number
}

export interface TopModel {
  modelId: string; name: string; isSet: boolean
  units: number; gross: number; views: number; conversion: number
}

export interface SearchRow { query: string; searches: number; zeroResults: number }

export interface AnalyticsSummary {
  range: AnalyticsRange
  totals: PeriodTotals
  prev: PeriodTotals
  rating: { avg: number; count: number; distribution: Record<'1' | '2' | '3' | '4' | '5', number> }
  topModels: TopModel[]
  featuredInTables: number
  mostViewedTable: { id: string; name: string; viewCount: number } | null
  topSearches: SearchRow[]
  zeroResultSearches: SearchRow[]
}

export interface TimeseriesPoint {
  day: string; units: number; gross: number; net: number
  views: number; placements: number; wishlist: number
}

export interface ProductRow {
  modelId: string; name: string; isSet: boolean; basePrice: number; status: string
  units: number; gross: number; net: number; views: number; placements: number; wishlist: number; conversion: number
}

export interface ModelFunnel {
  modelId: string; name: string; range: AnalyticsRange
  funnel: { views: number; wishlist: number; placements: number; sales: number; conversion: number }
  gross: number; net: number
  series: Array<{ day: string; views: number; wishlist: number; placements: number; units: number; gross: number }>
}

const q = (r: AnalyticsRange) => ({ from: r.from, to: r.to })

export const artistAnalyticsApi = {
  summary: async (r: AnalyticsRange): Promise<AnalyticsSummary> =>
    (await apiClient.get('/api/analytics/me/summary', { params: q(r) })).data,

  timeseries: async (r: AnalyticsRange): Promise<TimeseriesPoint[]> =>
    (await apiClient.get('/api/analytics/me/timeseries', { params: q(r) })).data?.series ?? [],

  products: async (r: AnalyticsRange, sort = 'units'): Promise<ProductRow[]> =>
    (await apiClient.get('/api/analytics/me/products', { params: { ...q(r), sort } })).data?.products ?? [],

  searches: async (r: AnalyticsRange): Promise<{ top: SearchRow[]; zero: SearchRow[] }> =>
    (await apiClient.get('/api/analytics/me/searches', { params: q(r) })).data,

  modelFunnel: async (id: string, r: AnalyticsRange): Promise<ModelFunnel> =>
    (await apiClient.get(`/api/analytics/me/model/${id}`, { params: q(r) })).data,
}
