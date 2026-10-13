import type { Table } from '../state/store'
import { MAX_HEIGHT } from './heightmap'

export type TerrainPathKind =
  'ditch' | 'trench' | 'road' | 'cliff' | 'shoreline'

export const PATH_KINDS: TerrainPathKind[] = [
  'ditch',
  'trench',
  'road',
  'cliff',
  'shoreline',
]

export function isPathKind(v: unknown): v is TerrainPathKind {
  return (
    v === 'trench' ||
    v === 'ditch' ||
    v === 'road' ||
    v === 'cliff' ||
    v === 'shoreline'
  )
}

export const PATH_LABEL: Record<TerrainPathKind, string> = {
  trench: 'Trench',
  ditch: 'Ditch',
  road: 'Road',
  cliff: 'Cliff',
  shoreline: 'Shoreline',
}

export const PATH_HINT: Record<TerrainPathKind, string> = {
  trench:
    'Click each point of the trench. The floor excavates existing terrain.',
  ditch: 'Click the table for each point, like digging a trench.',
  road: 'Click the table for each point, like laying a road.',
  cliff: 'Click the table for each point along the cliff edge.',
  shoreline: 'Click the table for each point along the coastline.',
}

export interface TerrainPath {
  connection?: { pathId: string; pointIndex: number }
  depth: number // floor below ground datum, metres
  endHeight: number // road end elevation; start is bermHeight
  crossing: 'excavate' | 'preserve-road'
  id: string
  kind: TerrainPathKind
  points: Array<{ x: number; z: number }> // world metres, table-centred; >=2 once committed

  // ---- BAND kinds ('ditch' | 'road') — symmetric profile around the centreline ----
  /** Full width of the excavation floor or road deck, metres. */
  channelWidth: number
  /** Width (m) of the sloped transition on EACH side of the core. */
  bermWidth: number
  /** Optional spoil height for excavation; start elevation for a road, metres. */
  bermHeight: number

  // ---- EDGE kinds ('cliff' | 'shoreline') — asymmetric, divides the table in two ----
  /** Offset on the low side of a cliff or shoreline, metres. */
  lowHeight: number
  /** Height (m) on the high side (clifftop / inland). */
  highHeight: number
  /** Horizontal distance (m) the ground takes to ramp low -> high. Small = steep cliff face, large = gentle shoreline slope. */
  transitionWidth: number
  /** Which side of the drawn direction (see nearestSegmentSide) is HIGH. Flip with the UI's "Flip side" button. */
  highSide: 1 | -1
}

export const DITCH_DEFAULTS = {
  channelWidth: 0.08,
  bermWidth: 0.04,
  bermHeight: 0,
}
// Same three-field band shape as a ditch: channelWidth/bermWidth/bermHeight here mean
// deck width / shoulder width / deck height instead of trench floor / bank width / bank height.
export const ROAD_DEFAULTS = {
  channelWidth: 0.12,
  bermWidth: 0.08,
  bermHeight: 0.003,
}

export const CLIFF_DEFAULTS = {
  lowHeight: 0,
  highHeight: 0.1,
  transitionWidth: 0,
  highSide: 1 as const,
}
export const SHORELINE_DEFAULTS = {
  lowHeight: 0,
  highHeight: 0.05,
  transitionWidth: 0.35,
  highSide: 1 as const,
}

export const DITCH_CHANNEL_RANGE = { min: 0.05, max: 0.5, step: 0.01 }
export const DITCH_BERM_WIDTH_RANGE = { min: 0.001, max: 0.3, step: 0.01 }
export const DITCH_BERM_HEIGHT_RANGE = {
  min: 0,
  max: Math.min(0.12, MAX_HEIGHT),
  step: 0.005,
}

export const ROAD_DECK_RANGE = { min: 0.05, max: 0.4, step: 0.01 }
export const ROAD_SHOULDER_RANGE = { min: 0.02, max: 0.25, step: 0.01 }
export const ROAD_DECK_HEIGHT_RANGE = {
  min: -0.1,
  max: Math.min(0.08, MAX_HEIGHT),
  step: 0.001,
}

export const EDGE_HEIGHT_RANGE = { min: 0, max: MAX_HEIGHT, step: 0.005 }
// Shoreline transition only; cliffs have exact vertical boundaries.
export const EDGE_TRANSITION_RANGE = { min: 0.05, max: 0.6, step: 0.01 }

/** Default visual material footprint, derived from the current path. */
export const PATH_MATERIAL: Record<
  TerrainPathKind,
  { materialId: string; halfWidth: (p: TerrainPath) => number }
> = {
  trench: {
    materialId: 'stone',
    halfWidth: (p) => p.channelWidth / 2 + p.bermWidth,
  },
  ditch: {
    materialId: 'stone',
    halfWidth: (p) => p.channelWidth / 2 + p.bermWidth,
  },
  road: {
    materialId: 'concrete',
    halfWidth: (p) => p.channelWidth / 2 + p.bermWidth,
  },
  cliff: { materialId: 'stone', halfWidth: () => 0.025 },
  shoreline: { materialId: 'sand', halfWidth: (p) => p.transitionWidth / 2 },
}

export const MAX_PATH_POINTS=64
export const MAX_DRAW_POINTS=256
/** Iterative Douglas-Peucker; retain endpoints and every bend exceeding 1 mm. */
export function simplifyPath(points:PathPoint[],tolerance=0.001):PathPoint[] {
  if(points.length<3)return points.slice()
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]]
  while(stack.length){
    const [first,last]=stack.pop()!;let best=tolerance,index=-1
    const a=points[first],b=points[last]
    for(let i=first+1;i<last;i++) {const p=points[i],d=distToSegment(p.x,p.z,a.x,a.z,b.x,b.z);if(d>best){best=d;index=i}}
    if(index>=0){keep.add(index);stack.push([first,index],[index,last])}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i])
}

export function newPathId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function defaultPath(
  kind: TerrainPathKind,
  points: Array<{ x: number; z: number }>,
): TerrainPath {
  const base = {
    id: newPathId(),
    kind,
    points,
    depth: 0.003,
    endHeight: 0.003,
    crossing: 'excavate' as const,
  }
  switch (kind) {
    case 'trench':
      return {
        ...base,
        channelWidth: 0.05,
        bermWidth: 0.005,
        bermHeight: 0,
        lowHeight: 0,
        highHeight: 0,
        transitionWidth: 0,
        highSide: 1,
      }
    case 'ditch':
      return {
        ...base,
        ...DITCH_DEFAULTS,
        lowHeight: 0,
        highHeight: 0,
        transitionWidth: 0,
        highSide: 1,
      }
    case 'road':
      return {
        ...base,
        ...ROAD_DEFAULTS,
        lowHeight: 0,
        highHeight: 0,
        transitionWidth: 0,
        highSide: 1,
      }
    case 'cliff':
      return {
        ...base,
        channelWidth: 0,
        bermWidth: 0,
        bermHeight: 0,
        ...CLIFF_DEFAULTS,
      }
    case 'shoreline':
      return {
        ...base,
        channelWidth: 0,
        bermWidth: 0,
        bermHeight: 0,
        ...SHORELINE_DEFAULTS,
      }
  }
}

/** Shortest distance from (x,z) to a single segment (x0,z0)-(x1,z1). */
function distToSegment(
  x: number,
  z: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): number {
  const dx = x1 - x0,
    dz = z1 - z0
  const lenSq = dx * dx + dz * dz
  if (lenSq < 1e-9) return Math.hypot(x - x0, z - z0)
  let t = ((x - x0) * dx + (z - z0) * dz) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz))
}

/** Shortest distance from (x,z) to the whole polyline (or to its single point, if degenerate). */
export function distToPath(
  points: Array<{ x: number; z: number }>,
  x: number,
  z: number,
): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) return Math.hypot(x - points[0].x, z - points[0].z)
  let best = Infinity
  for(const seg of pathSegments(points).segments) {
    const t=Math.max(0,Math.min(1,((x-seg.x)*seg.dx+(z-seg.z)*seg.dz)/(seg.len*seg.len)))
    const dx=x-seg.x-t*seg.dx,dz=z-seg.z-t*seg.dz
    best=Math.min(best,dx*dx+dz*dz)
  }
  return Math.sqrt(best)
}

/**
 * Nearest segment's (unsigned distance, side) to the polyline. `side` is +1 on
 * the side a positive `perpOffset()` (ThreeStage.tsx) would move a point
 * toward, -1 on the other — so the rendered "high side" rail and this
 * function's notion of side always agree, checked via the 2D cross product of
 * that segment's direction and the vector from its start to the point.
 *
 * Approximation for points beyond the polyline's ends: they resolve against
 * whichever terminal segment is nearest, which is correct for a roughly
 * straight or gently-curved line (the expected shape for a coastline/cliff
 * edge across a table) but can misjudge near a sharp corner far from the
 * drawn points — an acceptable v1 limitation for a table-sized feature.
 */
export function nearestSegmentSide(
  points: Array<{ x: number; z: number }>,
  x: number,
  z: number,
): { distance: number; side: 1 | -1 } {
  if (points.length === 0) return { distance: Infinity, side: 1 }
  if (points.length === 1)
    return { distance: Math.hypot(x - points[0].x, z - points[0].z), side: 1 }
  let best = Infinity
  let side: 1 | -1 = 1
  for(const segment of pathSegments(points).segments) {
    const a=segment,dx=segment.dx,dz=segment.dz,lenSq=segment.len*segment.len
    if (lenSq < 1e-9) continue
    let t = ((x - a.x) * dx + (z - a.z) * dz) / lenSq
    t = Math.max(0, Math.min(1, t))
    const px = a.x + t * dx,
      pz = a.z + t * dz
    const d = Math.hypot(x - px, z - pz)
    if (d < best) {
      best = d
      const cross = dx * (z - a.z) - dz * (x - a.x)
      side = cross >= 0 ? 1 : -1
    }
  }
  return { distance: best, side }
}

// Points arrays are immutable in authored state; parameter-only edits reuse segments.
const segmentCache = new WeakMap<TerrainPath['points'], { segments: Array<{x:number;z:number;dx:number;dz:number;len:number;offset:number}>; length:number }>()
function pathSegments(points: TerrainPath['points']) {
  const cached=segmentCache.get(points)
  if(cached) return cached
  const segments: Array<{x:number;z:number;dx:number;dz:number;len:number;offset:number}>=[]
  let length=0
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)
    if(len<1e-8) continue
    segments.push({x:a.x,z:a.z,dx,dz,len,offset:length});length+=len
  }
  const result={segments,length};segmentCache.set(points,result);return result
}
/** Rounded caps and corners use segment capsules; grades follow cached arc length. */
export function nearestPath(path: TerrainPath, x: number, z: number) {
  const {segments,length}=pathSegments(path.points)
  let best=Infinity,along=0
  for(const s of segments) {
    const t=Math.max(0,Math.min(1,((x-s.x)*s.dx+(z-s.z)*s.dz)/(s.len*s.len)))
    const dx=x-s.x-t*s.dx,dz=z-s.z-t*s.dz,d=dx*dx+dz*dz
    if(d<best){best=d;along=s.offset+t*s.len}
  }
  return {distance:Math.sqrt(best),fraction:length?along/length:0}
}
const smooth = (t: number) => {
  const u = Math.max(0, Math.min(1, t))
  return u * u * (3 - 2 * u)
}
export function pathWeight(p: TerrainPath, x: number, z: number, distance = distToPath(p.points, x, z)) {
  return (
    1 -
    smooth(
      (distance - p.channelWidth / 2) /
        Math.max(0.001, p.bermWidth),
    )
  )
}

export type PathPoint = { x: number; z: number }
const cross = (a: PathPoint, b: PathPoint, c: PathPoint) =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
export function segmentsCross(
  a: PathPoint,
  b: PathPoint,
  c: PathPoint,
  d: PathPoint,
) {
  return (
    cross(a, b, c) * cross(a, b, d) < -1e-14 &&
    cross(c, d, a) * cross(c, d, b) < -1e-14
  )
}
const regionCache = new WeakMap<
  TerrainPath,
  { key: string; polygon: PathPoint[] }
>()
/** Open cliffs extend their terminal tangents to the board perimeter, then close along it CCW. */
export function cliffRegion(p: TerrainPath, table: Table): PathPoint[] {
  const key = `${table.width},${table.height}`,
    cached = regionCache.get(p)
  if (cached?.key === key) return cached.polygon
  const hw = table.width / 2,
    hh = table.height / 2
  const ray = (a: PathPoint, b: PathPoint) => {
    const dx = a.x - b.x,
      dz = a.z - b.z,
      hits: number[] = []
    if (dx > 1e-9) hits.push((hw - a.x) / dx)
    if (dx < -1e-9) hits.push((-hw - a.x) / dx)
    if (dz > 1e-9) hits.push((hh - a.z) / dz)
    if (dz < -1e-9) hits.push((-hh - a.z) / dz)
    const t = Math.min(...hits.filter((t) => t >= -1e-8))
    return { x: a.x + Math.max(0, t) * dx, z: a.z + Math.max(0, t) * dz }
  }
  const pts = p.points,
    first = ray(pts[0], pts[1]),
    last = ray(pts[pts.length - 1], pts[pts.length - 2])
  const perimeter = (a: PathPoint) =>
    Math.abs(a.z + hh) < 1e-7
      ? a.x + hw
      : Math.abs(a.x - hw) < 1e-7
        ? table.width + a.z + hh
        : Math.abs(a.z - hh) < 1e-7
          ? table.width + table.height + hw - a.x
          : 2 * table.width + table.height + hh - a.z
  const total = 2 * (table.width + table.height),
    start = perimeter(last),
    end = perimeter(first)
  const corners = [
    { x: -hw, z: -hh },
    { x: hw, z: -hh },
    { x: hw, z: hh },
    { x: -hw, z: hh },
  ]
  const tail = corners
    .map((v) => ({ v, d: (perimeter(v) - start + total) % total }))
    .filter((v) => v.d > 1e-8 && v.d < ((end - start + total) % total) - 1e-8)
    .sort((a, b) => a.d - b.d)
    .map((v) => v.v)
  const polygon = [first, ...pts, last, ...tail].filter(
    (v, i, a) => !i || Math.hypot(v.x - a[i - 1].x, v.z - a[i - 1].z) > 1e-8,
  )
  regionCache.set(p, { key, polygon })
  return polygon
}
export function inPolygon(poly: PathPoint[], x: number, z: number) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j]
    if (
      a.z > z !== b.z > z &&
      x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x
    )
      inside = !inside
  }
  return inside
}
let excavationScratch = new Float64Array(0)
const shorelineCache = new WeakMap<TerrainPath[], TerrainPath[][]>()
function shorelineNetworks(paths:TerrainPath[]) {
  const cached=shorelineCache.get(paths);if(cached)return cached
  const byId=new Map(paths.map(p=>[p.id,p])),groups=new Map<string,TerrainPath[]>()
  for(const p of paths)if(p.kind==='shoreline') {
    let root=p;const visited=new Set<string>()
    while(root.connection&&!visited.has(root.id)){visited.add(root.id);const parent=byId.get(root.connection.pathId);if(!parent)break;root=parent}
    const group=groups.get(root.id)??[];group.push(p);groups.set(root.id,group)
  }
  const result=[...groups.values()].map(group=>group.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))
  shorelineCache.set(paths,result);return result
}

/** Base/detail -> cliff offsets -> road cut/fill -> excavation/spoil. Excavations union; road junctions blend. */
export function applyTerrainPaths(
  paths: TerrainPath[],
  base: number,
  table: Table,
  x: number,
  z: number,
  sidePoint?: PathPoint,
): number {
  let h = base
  for (const p of paths) {
    if (p.kind === 'cliff') {
      const q = sidePoint ?? { x, z },
        left = inPolygon(cliffRegion(p, table), q.x, q.z)
      h += left === (p.highSide === 1) ? p.highHeight : p.lowHeight
    }
  }
  for(const group of shorelineNetworks(paths)) {
    let p=group[0],nearest=nearestSegmentSide(p.points,x,z)
    for(let i=1;i<group.length;i++){const next=nearestSegmentSide(group[i].points,x,z);if(next.distance<nearest.distance){p=group[i];nearest=next}}
    h+=p.lowHeight+(p.highHeight-p.lowHeight)*smooth(0.5+nearest.distance*nearest.side*p.highSide/Math.max(0.001,p.transitionWidth))
  }
  let weights = 0,
    weighted = 0,
    roadInfluence = 0
  for (const p of paths)
    if (p.kind === 'road') {
      const n = nearestPath(p, x, z),
        w = pathWeight(p, x, z, n.distance)
      weights += w
      weighted += w * (p.bermHeight + (p.endHeight - p.bermHeight) * n.fraction)
      roadInfluence = Math.max(roadInfluence, w)
    }
  if (weights)
    h = h * (1 - roadInfluence) + (weighted / weights) * roadInfluence
  const roadSurface = h
  let spoil = 0
  if (excavationScratch.length < paths.length) excavationScratch = new Float64Array(paths.length)
  const distances = excavationScratch
  for (let pi=0;pi<paths.length;pi++) {
    const p=paths[pi]
    if (p.kind === 'ditch' || p.kind === 'trench') {
      const d = nearestPath(p, x, z).distance,
        outer = p.channelWidth / 2 + p.bermWidth,
        u = (d - outer) / Math.max(0.01, p.bermWidth)
      distances[pi]=d
      if (u > 0 && u < 1)
        spoil = Math.max(
          spoil,
          p.bermHeight * Math.sin(Math.PI * u) * (1 - roadInfluence),
        )
    }
  }
  const banked = roadSurface + spoil
  let excavated = banked
  for (let pi=0;pi<paths.length;pi++) {
    const p=paths[pi]
    if (p.kind === 'ditch' || p.kind === 'trench') {
      const w = pathWeight(p, x, z, distances[pi]),
        preserve = p.crossing === 'preserve-road' ? roadInfluence : 0
      excavated = Math.min(
        excavated,
        banked + (Math.min(banked, -p.depth) - banked) * w * (1 - preserve),
      )
    }
  }
  return excavated
}
export function validateTerrainPaths(paths: TerrainPath[], table: Table) {
  const byId=new Map(paths.map(p=>[p.id,p]))
  for(const p of paths) if(p.connection) {
    const parent=byId.get(p.connection.pathId),anchor=parent?.points[p.connection.pointIndex]
    if(!parent||parent.kind!==p.kind||!['ditch','trench','shoreline'].includes(p.kind)||!anchor||!p.points[0]||Math.hypot(anchor.x-p.points[0].x,anchor.z-p.points[0].z)>1e-8)
      throw new Error('Path branch must start at its parent control point')
    const seen=new Set([p.id]);let current:TerrainPath|undefined=parent
    while(current){if(seen.has(current.id))throw new Error('Path connections must not form a cycle');seen.add(current.id);current=current.connection?byId.get(current.connection.pathId):undefined}
  }
  let cliffSegments = 0
  for (const p of paths) {
    if (
      !p.points.every(
        (v) =>
          Number.isFinite(v.x) &&
          Number.isFinite(v.z) &&
          Math.abs(v.x) <= table.width / 2 + 1e-7 &&
          Math.abs(v.z) <= table.height / 2 + 1e-7,
      )
    )
      throw new Error(`${PATH_LABEL[p.kind]}: all points must lie on the table`)
    if (p.points.length < 2 || p.points.length > MAX_PATH_POINTS)
      throw new Error(`${PATH_LABEL[p.kind]}: use 2–64 points`)
    for (let i = 1; i < p.points.length; i++) {
      if (
        Math.hypot(
          p.points[i].x - p.points[i - 1].x,
          p.points[i].z - p.points[i - 1].z,
        ) < 0.001
      )
        throw new Error(
          `${PATH_LABEL[p.kind]}: consecutive points must be at least 1 mm apart`,
        )
      for (let j = i + 2; j < p.points.length; j++)
        if (
          segmentsCross(
            p.points[i - 1],
            p.points[i],
            p.points[j - 1],
            p.points[j],
          ) &&
          (p.kind === 'cliff' ||
            (p.kind === 'road' && Math.abs(p.endHeight - p.bermHeight) > 1e-6))
        )
          throw new Error(
            `${PATH_LABEL[p.kind]}: self-crossing boundaries or graded paths are ambiguous; split into separate paths`,
          )
    }
    if (p.kind === 'cliff') {
      const poly = cliffRegion(p, table)
      cliffSegments += poly.length
      if (
        poly.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.z)) ||
        Math.abs(
          poly.reduce((sum, a, i) => {
            const b = poly[(i + 1) % poly.length]
            return sum + a.x * b.z - a.z * b.x
          }, 0),
        ) < 1e-8
      )
        throw new Error(
          'Cliff must divide the table into two regions; move the endpoints to distinct edges.',
        )
      for (let i = 0; i < poly.length; i++)
        for (let j = i + 2; j < poly.length; j++)
          if (
            (j + 1) % poly.length !== i &&
            segmentsCross(
              poly[i],
              poly[(i + 1) % poly.length],
              poly[j],
              poly[(j + 1) % poly.length],
            )
          )
            throw new Error(
              'Cliff endpoint extensions cross the boundary. Move endpoints toward separate table edges.',
            )
    }
  }
  if (cliffSegments > 64)
    throw new Error(
      'Cliff boundaries exceed 64 segments; simplify the paths before compiling.',
    )
}

/** Translate every point of a path by (dx, dz), clamped to stay on the table. */
export function translateConnectedPaths(paths:TerrainPath[],id:string,dx:number,dz:number,table:Table):TerrainPath[] {
  const ids=new Set([id]);let changed=true
  while(changed){changed=false;for(const p of paths)if(p.connection&&(ids.has(p.id)||ids.has(p.connection.pathId)))for(const linked of [p.id,p.connection.pathId])if(!ids.has(linked)){ids.add(linked);changed=true}}
  const points=paths.filter(p=>ids.has(p.id)).flatMap(p=>p.points)
  if(!points.length)return paths
  dx=Math.max(-table.width/2-Math.min(...points.map(p=>p.x)),Math.min(table.width/2-Math.max(...points.map(p=>p.x)),dx))
  dz=Math.max(-table.height/2-Math.min(...points.map(p=>p.z)),Math.min(table.height/2-Math.max(...points.map(p=>p.z)),dz))
  return paths.map(p=>ids.has(p.id)?{...p,points:p.points.map(v=>({x:v.x+dx,z:v.z+dz}))}:p)
}

/** Translate every point of an independent path by a clamped offset. */
export function translatePath(
  path: TerrainPath,
  dx: number,
  dz: number,
  table: Table,
): TerrainPath {
  const hw = table.width / 2,
    hh = table.height / 2
  dx = Math.max(
    -hw - Math.min(...path.points.map((p) => p.x)),
    Math.min(hw - Math.max(...path.points.map((p) => p.x)), dx),
  )
  dz = Math.max(
    -hh - Math.min(...path.points.map((p) => p.z)),
    Math.min(hh - Math.max(...path.points.map((p) => p.z)), dz),
  )
  return {
    ...path,
    points: path.points.map((p) => ({ x: p.x + dx, z: p.z + dz })),
  }
}
