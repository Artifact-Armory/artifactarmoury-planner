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
import type { TerrainFeature } from '../core/terrainFeatures'
import { serializeFeatures, deserializeFeatures, compositeHeightmap } from '../core/terrainFeatures'
import type { TerrainPath } from '../core/terrainPaths'
import { serializePaths, deserializePaths } from '../core/terrainPaths'

// Keep in sync with the store's default (state/store.ts) — 0.0127m = 1/2" grid.
const DEFAULT_TABLE: Table = { width: 1.8288, height: 1.2192, unitDisplay: 'ft', gridSize: 0.0127 }

/** Planner scene → server { tableConfig, layoutData }. */
export function serializeLayout(
  table: Table,
  tableMaterial: string,
  instances: Instance[],
  heightmap?: Heightmap | null,
  paint?: PaintMap | null,
  terrainFeatures?: TerrainFeature[],
  terraceStep?: number,
  terrainDetail?: Heightmap | null,
  terrainPaths?: TerrainPath[],
) {
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
      })),
      // `heightmap` is always the FINAL composited surface (stamps + detail
      // brush + terrace quantisation) — this is the only key the backend's
      // tile-export pipeline needs to read, unchanged since before landform
      // stamps existed. `heightmap` here is the caller's `heightmap` param,
      // which App.tsx always passes as `store().heightmap` (the derived/cached
      // grid) — never the raw detail layer.
      heightmap: serializeHeightmap(heightmap ?? null),
      // The re-editable authored layers, so re-opening this table in the
      // planner gets its landform stamps back as movable/resizable objects
      // instead of a frozen grid. `terrainDetail` is the freehand-brush layer
      // (what the old `heightmap` key meant before stamps existed — see
      // deserializeLayout's legacy-table fallback below).
      terrainFeatures: serializeFeatures(terrainFeatures ?? []),
      terrainPaths: serializePaths(terrainPaths ?? []),
      terrainDetail: serializeHeightmap(terrainDetail ?? null),
      terraceStep: terraceStep || undefined,
      // Painted ground texture (null/omitted when nothing is painted).
      paint: serializePaint(paint ?? null),
    },
  }
}

/** Server { table_config, layout_data } → planner scene. Tolerant of missing/legacy fields. */
export function deserializeLayout(
  tableConfig: any,
  layoutData: any,
): {
  table: Table
  tableMaterial?: string
  instances: Instance[]
  heightmap: Heightmap | null
  terrainDetail: Heightmap | null
  terrainFeatures: TerrainFeature[]
  terrainPaths: TerrainPath[]
  terraceStep: number
  paint: PaintMap | null
} {
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
    }))
    .filter((i: Instance) => i.assetId)

  const paint = deserializePaint(layoutData?.paint, table)

  // New-format table: the authored layers (stamps + detail) round-trip so
  // they stay editable. Legacy table (saved before landform stamps existed):
  // no `terrainFeatures` key at all, so its old `heightmap` key — which back
  // then meant "the whole brush-authored surface" — becomes the detail layer
  // (features = [], terraceStep = 0), and compositing it reproduces the exact
  // same final surface. Zero regression for tables sculpted before this.
  const hasFeatureLayer = Array.isArray(layoutData?.terrainFeatures)
  const terrainFeatures = hasFeatureLayer ? deserializeFeatures(layoutData.terrainFeatures) : []
  const terrainPaths = hasFeatureLayer ? deserializePaths(layoutData?.terrainPaths) : []
  const terraceStep = hasFeatureLayer ? Number(layoutData?.terraceStep) || 0 : 0
  const terrainDetail = hasFeatureLayer
    ? deserializeHeightmap(layoutData?.terrainDetail, table)
    : deserializeHeightmap(layoutData?.heightmap, table)
  const heightmap = compositeHeightmap(terrainFeatures, terrainPaths, terrainDetail, table, terraceStep)

  return { table, tableMaterial: tc.material, instances, heightmap, terrainDetail, terrainFeatures, terrainPaths, terraceStep, paint }
}
