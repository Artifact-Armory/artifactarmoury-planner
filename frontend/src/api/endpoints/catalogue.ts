// src/api/endpoints/catalogue.ts
// Bulk edit of an artist's whole catalogue by CSV: download, edit, preview, apply.
import apiClient from '../client'

export interface CatalogueFieldChange {
  field: string
  from: string
  to: string
}

export interface CatalogueProblem {
  line: number
  id?: string
  message: string
}

export interface CataloguePreview {
  rowsRead: number
  unchanged: number
  ignoredColumns: string[]
  errors: CatalogueProblem[]
  warnings: CatalogueProblem[]
  changed: { id: string; line: number; name: string; changes: CatalogueFieldChange[] }[]
}

export const catalogueApi = {
  /** Fetch the CSV with the auth header and save it in the browser. */
  async downloadCsv(): Promise<void> {
    const response = await apiClient.get('/api/catalogue/export.csv', { responseType: 'blob' })
    const date = new Date().toISOString().slice(0, 10)
    const url = window.URL.createObjectURL(response.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `artifact-armoury-catalogue-${date}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  },

  async preview(csv: string): Promise<CataloguePreview> {
    const response = await apiClient.post('/api/catalogue/import/preview', { csv })
    return response.data
  },

  async apply(csv: string): Promise<{ updated: number; message: string }> {
    const response = await apiClient.post('/api/catalogue/import/apply', { csv })
    return response.data
  },
}
