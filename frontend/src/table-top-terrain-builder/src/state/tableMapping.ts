// src/state/tableMapping.ts
//
// Map between the planner's native scene (Table + Instance[]) and the server's
// stored table shape (table_config + layout_data.models). Kept separate from the
// store so the persistence format is explicit and versioned.

import type { Table, Instance, Unit } from './store'
import type { Heightmap } from '../core/heightmap'
import { serializeHeightmap, deserializeHeightmap } from '../core/heightmap'
import type { PaintMap } from '../core/paintmap'
import { serializePaint, deserializePaint } from '../core/paintmap'

// Keep in sync with the store's default (state/store.ts) — 0.0127m = 1/2" grid.
const DEFAULT_TABLE: Table = { width: 1.8288, height: 1.2192, unitDisplay: 'ft', gridSize: 0.0127 }

/** Planner scene → server { tableConfig, layoutData }. */
export function serializeLayout(table: Table, tableMaterial: string, instances: Instance[], heightmap?: Heightmap | null, paint?: PaintMap | null) {
  return {
    tableConfig: {
      width: table.width,
      height: table.height,
      unitDisplay: table.unitDisplay,
      gridSize: table.gridSize,
      material: tableMaterial,
    },
    // Backend requires layout_data.models to be an array.
    layoutData: {
      version: 3,
      models: instances.map((i) => ({
        modelId: i.assetId,
        x: i.position.x,
        z: i.position.z,
        rotationDeg: i.rotationDeg,
        pitchDeg: i.pitchDeg ?? 0,
        level: i.level ?? 0,
        groupId: i.groupId ?? null,
      })),
      // Sculpted surface (null/omitted when the table is flat).
      heightmap: serializeHeightmap(heightmap ?? null),
      // Painted ground texture (null/omitted when nothing is painted).
      paint: serializePaint(paint ?? null),
    },
  }
}

/** Server { table_config, layout_data } → planner scene. Tolerant of missing/legacy fields. */
export function deserializeLayout(
  tableConfig: any,
  layoutData: any,
): { table: Table; tableMaterial?: string; instances: Instance[]; heightmap: Heightmap | null; paint: PaintMap | null } {
  const tc = tableConfig ?? {}
  const table: Table = {
    width: Number(tc.width ?? DEFAULT_TABLE.width) || DEFAULT_TABLE.width,
    height: Number(tc.height ?? DEFAULT_TABLE.height) || DEFAULT_TABLE.height,
    unitDisplay: (tc.unitDisplay ?? DEFAULT_TABLE.unitDisplay) as Unit,
    gridSize: Number(tc.gridSize ?? DEFAULT_TABLE.gridSize) || DEFAULT_TABLE.gridSize,
  }

  const rawModels = Array.isArray(layoutData?.models) ? layoutData.models : []
  const instances: Instance[] = rawModels
    .map((m: any, idx: number): Instance => ({
      id: `i_${Date.now().toString(36)}_${idx}`,
      assetId: String(m.modelId ?? m.assetId ?? ''),
      position: { x: Number(m.x ?? m.position?.x ?? 0), z: Number(m.z ?? m.position?.z ?? 0) },
      rotationDeg: Number(m.rotationDeg ?? m.rotation ?? 0),
      pitchDeg: Number(m.pitchDeg ?? 0),
      level: Number(m.level ?? 0),
      groupId: m.groupId ?? undefined,
    }))
    .filter((i: Instance) => i.assetId)

  const heightmap = deserializeHeightmap(layoutData?.heightmap, table)
  const paint = deserializePaint(layoutData?.paint, table)

  return { table, tableMaterial: tc.material, instances, heightmap, paint }
}
