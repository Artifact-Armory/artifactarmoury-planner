// Printability metadata helpers — printer-type labels and a buyer-facing summary
// of the automated mesh-QA result (backend services/meshQA.ts, migration 032).

import type { TerrainModel } from '../api/types'

export type PrinterType = 'fdm' | 'resin' | 'both'

export const PRINTER_TYPE_OPTIONS: { value: PrinterType; label: string; short: string }[] = [
  { value: 'fdm', label: 'FDM', short: 'Designed for filament (FDM) printers' },
  { value: 'resin', label: 'Resin', short: 'Designed for resin (SLA/DLP) printers' },
  { value: 'both', label: 'FDM & resin', short: 'Prints well on both FDM and resin' },
]

export const printerTypeLabel = (t?: string | null): string | null => {
  if (!t) return null
  return PRINTER_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? null
}

export interface MeshQualitySummary {
  tone: 'good' | 'warn' | 'neutral'
  label: string
  detail: string
}

/**
 * Buyer-facing one-liner about the mesh quality. Returns null when the model
 * wasn't analysed (e.g. legacy uploads or meshes too large to check), so callers
 * can simply hide the badge.
 */
export const meshQualitySummary = (model: TerrainModel): MeshQualitySummary | null => {
  if (!model.meshAnalyzed) return null

  if (model.meshIsWatertight) {
    return {
      tone: 'good',
      label: 'Clean mesh',
      detail: 'Watertight and manifold — no holes or non-manifold edges detected.',
    }
  }

  const issues: string[] = []
  if (model.meshOpenEdges && model.meshOpenEdges > 0) {
    issues.push(`${model.meshOpenEdges.toLocaleString()} open edge${model.meshOpenEdges === 1 ? '' : 's'}`)
  }
  if (model.meshIsManifold === false) issues.push('non-manifold edges')

  return {
    tone: 'warn',
    label: 'Mesh has open edges',
    detail: issues.length
      ? `Detected ${issues.join(' and ')}. May need repair in your slicer before printing.`
      : 'The mesh may not be fully watertight. Check it in your slicer before printing.',
  }
}
