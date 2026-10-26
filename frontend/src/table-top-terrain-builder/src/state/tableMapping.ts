// src/state/tableMapping.ts
//
// Map between the planner's native scene (Table + Instance[]) and the server's
// stored table shape (table_config + layout_data.models). Kept separate from the
// store so the persistence format is explicit and versioned.
//
// Terrain format (layout_data version 4, 2026-10-15):
//   heightmap        — the COMPOSITE surface (landforms + freehand detail), in mm.
//                      Same field and meaning as before, so the backend's tile
//                      export and older planner builds still see the full terrain.
//   terrainFeatures  — editable landforms. Its presence marks the v4 format.
//   terrainDetail    — the freehand layer on its own (only when it isn't flat).
// A table without `terrainFeatures` is pre-landform: its heightmap IS the detail.

import type { Table, Instance, Unit } from './store'
import type { Heightmap } from '../core/heightmap'
import { serializeHeightmap, deserializeHeightmap } from '../core/heightmap'
import type { PaintMap } from '../core/paintmap'
import { serializePaint, deserializePaint } from '../core/paintmap'
import {
  type TerrainFeature, serializeFeatures, deserializeFeatures, compositeHeightmap,
} from '../core/terrainFeatures'

// Keep in sync with the store's default (state/store.ts) — 0.0127m = 1/2" grid.
const DEFAULT_TABLE: Table = { width: 1.8288, height: 1.2192, unitDisplay: 'ft', gridSize: 0.0127 }

export interface LayoutTerrain {
  /** Freehand sculpt layer. */
  terrainDetail?: Heightmap | null
  /** Editable landforms. */
  terrainFeatures?: TerrainFeature[]
  paint?: PaintMap | null
}

/** Table-wide look: piece colour and lighting. */
export interface LayoutLook {
  modelColor?: string | null
  brightness?: number
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i
function readColour(v: unknown): string | undefined {
  return typeof v === 'string' && HEX_COLOUR.test(v) ? v.toLowerCase() : undefined
}

/** Planner scene → server { tableConfig, layoutData }. */
export function serializeLayout(table: Table, tableMaterial: string, instances: Instance[], terrain: LayoutTerrain = {}, look: LayoutLook = {}) {
  const features = terrain.terrainFeatures ?? []
  const detail = terrain.terrainDetail ?? null
  const surface = features.length ? compositeHeightmap(features, detail, table) : detail
  return {
    tableConfig: {
      width: table.width,
      height: table.height,
      unitDisplay: table.unitDisplay,
      gridSize: table.gridSize,
      material: tableMaterial,
      // Only written when changed, so untouched tables save as before.
      ...(look.modelColor ? { modelColor: look.modelColor } : {}),
      ...(look.brightness != null && look.brightness !== 1 ? { brightness: look.brightness } : {}),
    },
    // Backend requires layout_data.models to be an array.
    layoutData: {
      version: features.length ? 4 : 3,
      models: instances.map((i) => ({
        modelId: i.assetId,
        x: i.position.x,
        z: i.position.z,
        rotationDeg: i.rotationDeg,
        pitchDeg: i.pitchDeg ?? 0,
        level: i.level ?? 0,
        groupId: i.groupId ?? null,
        // Only written when set, so tables without mirrored pieces save as before.
        ...(i.mirrored ? { mirrored: true } : {}),
        ...(i.color ? { color: i.color } : {}),
      })),
      // Sculpted surface (null/omitted when the table is flat).
      heightmap: serializeHeightmap(surface),
      // Landform layers — omitted entirely for a table without landforms, so it
      // saves exactly as it did before landforms existed.
      ...(features.length ? {
        terrainFeatures: serializeFeatures(features),
        terrainDetail: serializeHeightmap(detail),
      } : {}),
      // Painted ground texture (null/omitted when nothing is painted).
      paint: serializePaint(terrain.paint ?? null),
    },
  }
}

/** Server { table_config, layout_data } → planner scene. Tolerant of missing/legacy fields. */
export function deserializeLayout(
  tableConfig: any,
  layoutData: any,
): { table: Table; tableMaterial?: string; instances: Instance[]; terrainDetail: Heightmap | null; terrainFeatures: TerrainFeature[]; paint: PaintMap | null; modelColor: string | null; brightness: number } {
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
      ...(m.mirrored === true ? { mirrored: true } : {}),
      ...(readColour(m.color) ? { color: readColour(m.color) } : {}),
    }))
    .filter((i: Instance) => i.assetId)

  const layered = Array.isArray(layoutData?.terrainFeatures)
  const terrainFeatures = layered ? deserializeFeatures(layoutData.terrainFeatures) : []
  // v4 stores the detail layer separately (heightmap there is the composite);
  // anything older stored only the detail layer, as `heightmap`.
  const terrainDetail = deserializeHeightmap(layered ? layoutData?.terrainDetail : layoutData?.heightmap, table)
  const paint = deserializePaint(layoutData?.paint, table)

  const brightness = Number(tc.brightness ?? 1)
  return {
    table, tableMaterial: tc.material, instances, terrainDetail, terrainFeatures, paint,
    modelColor: readColour(tc.modelColor) ?? null,
    brightness: Number.isFinite(brightness) && brightness > 0 ? brightness : 1,
  }
}
