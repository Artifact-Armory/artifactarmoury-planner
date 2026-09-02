// src/store/unitsStore.ts
//
// The planner's display-unit preference (imperial ⇄ metric). Purely a display
// choice — every measurement is still stored/computed internally in metres
// (see the mm→m conversion in table-top-terrain-builder/core/assets.ts and the
// table's own width/height), so switching this can never change a table's or a
// piece's actual real-world size, only how the numbers are shown.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UnitSystem = 'imperial' | 'metric'

const M_PER_FT = 0.3048
const M_PER_IN = 0.0254

interface UnitsState {
  system: UnitSystem
  setSystem: (system: UnitSystem) => void
  toggle: () => void
}

export const useUnitsStore = create<UnitsState>()(
  persist(
    (set, get) => ({
      system: 'imperial',
      setSystem: (system) => set({ system }),
      toggle: () => set({ system: get().system === 'imperial' ? 'metric' : 'imperial' }),
    }),
    { name: 'planner-units' },
  ),
)

export function unitLabel(system: UnitSystem): string {
  return system === 'imperial' ? 'ft' : 'm'
}

/** Table-scale length (metres) → the editable number shown in the current
 *  system: feet for imperial, metres for metric. */
export function metresToDisplay(m: number, system: UnitSystem): number {
  const v = system === 'imperial' ? m / M_PER_FT : m
  return Math.round(v * 100) / 100
}

/** The inverse of metresToDisplay — back to metres for storing/comparing. */
export function displayToMetres(value: number, system: UnitSystem): number {
  return system === 'imperial' ? value * M_PER_FT : value
}

/**
 * Compact real-world size of a piece (small scale — terrain, not tables): mm
 * for metric, inches for imperial. Mirrors the "180 × 120 × 80 mm" format the
 * marketplace product page already uses for width × depth × height, so a piece
 * reads the same figure whether you're looking at it there or in the planner.
 */
export function formatPieceDims(aabb: { x: number; y: number; z: number }, system: UnitSystem): string {
  const one = (m: number) => (system === 'imperial' ? `${(m / M_PER_IN).toFixed(1)}"` : `${Math.round(m * 1000)}mm`)
  return `${one(aabb.x)} × ${one(aabb.z)} × ${one(aabb.y)}`
}
