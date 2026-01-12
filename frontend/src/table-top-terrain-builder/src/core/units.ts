/* Unit conversion helpers (same as scaffold text) */
// src/core/units.ts
export type Unit = 'm' | 'cm' | 'ft' | 'in'

export function unitLabel(u: Unit) {
  return u
}

export function fromMetres(value: number, unit: Unit) {
  switch (unit) {
    case 'm':
      return value
    case 'cm':
      return value * 100
    case 'ft':
      return value / 0.3048
    case 'in':
      return value / 0.0254
  }
}

/** Convert a numeric value in the given unit to metres. */
export function toMetres(value: number, unit: Unit) {
  switch (unit) {
    case 'm':  return value
    case 'cm': return value / 100
    case 'ft': return value * 0.3048
    case 'in': return value * 0.0254
  }
}

/** Parse a string like "6" using the provided unit and return metres. Non-numbers -> 0. */
export function parseDimensionToMetres(text: string, unit: Unit) {
  const v = parseFloat(text)
  if (Number.isNaN(v)) return 0
  return toMetres(v, unit)
}
