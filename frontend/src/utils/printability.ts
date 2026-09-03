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
 * Buyer-facing one-liner about mesh quality — trust signal ONLY. It only ever
 * returns the positive "Clean mesh" case; any issue at all (serious or not) is
 * withheld from buyers by design (see meshSeriousWarning below). Non-manifold
 * and degenerate-triangle findings are routine CAD noise that slicers repair
 * silently in the overwhelming majority of cases, and surfacing them here just
 * made artists look bad for something buyers were unlikely to ever notice.
 * Returns null when there's nothing to say, so callers can simply hide the badge.
 */
export const meshQualitySummary = (model: TerrainModel): MeshQualitySummary | null => {
  if (!model.meshAnalyzed) return null
  if (!model.meshIsWatertight) return null

  return {
    tone: 'good',
    label: 'Clean mesh',
    detail: 'Watertight and manifold — no holes or non-manifold edges detected.',
  }
}

export interface MeshSeriousWarning {
  /** How many boundary (open/hole) edges were detected. Always > 0. */
  openEdges: number
  detail: string
  acknowledged: boolean
  acknowledgedAt: string | null
}

/**
 * Artist-facing only. The one mesh QA finding treated as "product breaking":
 * real open edges (the shell has an actual hole, so a slicer's inside/outside
 * test can fail outright). Non-manifold-only or degenerate-only results are
 * NOT surfaced anywhere — see meshQualitySummary's doc comment for why. Returns
 * null when there's no serious issue (nothing to acknowledge / no warning to show).
 */
export const meshSeriousWarning = (model: TerrainModel): MeshSeriousWarning | null => {
  if (!model.meshAnalyzed) return null
  const openEdges = model.meshOpenEdges ?? 0
  if (openEdges <= 0) return null

  return {
    openEdges,
    detail:
      `Detected ${openEdges.toLocaleString()} open edge${openEdges === 1 ? '' : 's'} — the mesh has ` +
      `an actual hole in it, not just a modelling quirk. This can cause real print failures ` +
      `(leaks, missing walls, a slicer that can't tell inside from outside). Check it in your ` +
      `slicer before publishing.`,
    acknowledged: !!model.meshWarningAcknowledged,
    acknowledgedAt: model.meshWarningAcknowledgedAt ?? null,
  }
}
