// backend/src/services/pieceRender.ts
//
// A site-generated picture of one placeable piece, rendered from its preview GLB.
//
// Why: a pack listing (Wargame3D's markers, stowage, barricades…) is dozens of
// placeable pieces sharing ONE store photo, so the planner palette showed the same
// pack shot on every tile and nobody could tell marker9 from marker21. The artist
// only ever supplies photos per listing (or per named model), never per file.
//
// How: a small software rasteriser — no GPU, no Blender, no headless browser — so
// it runs anywhere the worker does. It draws the planner preview (the same mesh a
// buyer places) from a fixed 3/4 view, grey clay on a light background, with a
// key + fill light and a 2x supersample, then sharp downsizes it to WebP.

// @gltf-transform/* is ESM-only; the CommonJS build must import it dynamically
// (same shim as services/fileProcessor.ts and proxyBake/lod.ts).
const importESM = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string,
) => Promise<T>

/** Output edge in pixels (square). Rendered at 2x and downsampled. */
export const PIECE_RENDER_SIZE = Number(process.env.PIECE_RENDER_SIZE ?? 512)

// Same 3/4 view the planner's table thumbnails use (ThreeStage.captureTable).
const AZIMUTH_DEG = 30
const POLAR_DEG = 55
const FOV_DEG = 30
const PADDING = 0.08

const BG_TOP = [246, 247, 249]
const BG_BOTTOM = [226, 229, 234]
const CLAY = [168, 172, 178]

let ioPromise: Promise<any> | null = null
async function gltfIO(): Promise<any> {
  if (!ioPromise) {
    ioPromise = (async () => {
      const { NodeIO } = await importESM<typeof import('@gltf-transform/core')>('@gltf-transform/core')
      const { KHRDracoMeshCompression, ALL_EXTENSIONS } = await importESM<any>('@gltf-transform/extensions')
      const draco3dMod: any = await importESM('draco3dgltf')
      const draco3d = draco3dMod.default ?? draco3dMod
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS ?? [KHRDracoMeshCompression])
        .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })
    })()
  }
  return ioPromise
}

interface Mesh {
  /** World-space positions, xyz per vertex. */
  pos: Float32Array
  /** World-space vertex normals (may be empty → flat shading). */
  nrm: Float32Array
  idx: Uint32Array
}

function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

/** Every triangle primitive in the default scene, flattened to world space. */
async function loadMeshes(glb: Uint8Array): Promise<Mesh[]> {
  const io = await gltfIO()
  const doc = await io.readBinary(glb)
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const out: Mesh[] = []
  const visit = (node: any) => {
    const mesh = node.getMesh()
    if (mesh) {
      const m: number[] = Array.from(node.getWorldMatrix())
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4 /* TRIANGLES */) continue
        const pa = prim.getAttribute('POSITION')
        if (!pa) continue
        const count = pa.getCount()
        const src = new Float32Array(count * 3)
        const el: number[] = []
        for (let i = 0; i < count; i++) {
          pa.getElement(i, el)
          const p = transformPoint(m, el[0], el[1], el[2])
          src[i * 3] = p[0]; src[i * 3 + 1] = p[1]; src[i * 3 + 2] = p[2]
        }
        const na = prim.getAttribute('NORMAL')
        let nrm = new Float32Array(0)
        if (na && na.getCount() === count) {
          nrm = new Float32Array(count * 3)
          for (let i = 0; i < count; i++) {
            na.getElement(i, el)
            // Upper 3x3 only; fine for the uniform scales GLBs here carry.
            const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2]
            const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2]
            const z = m[2] * el[0] + m[6] * el[1] + m[10] * el[2]
            const l = Math.hypot(x, y, z) || 1
            nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l
          }
        }
        const ia = prim.getIndices()
        let idx: Uint32Array
        if (ia) idx = Uint32Array.from(ia.getArray() as ArrayLike<number>)
        else { idx = new Uint32Array(count); for (let i = 0; i < count; i++) idx[i] = i }
        out.push({ pos: src, nrm, idx })
      }
    }
    for (const c of node.listChildren()) visit(c)
  }
  for (const n of scene ? scene.listChildren() : root.listNodes()) visit(n)
  return out
}

const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Render a preview GLB (Y-up, Draco or not) to a square WebP. Throws when the
 * file has no drawable triangles.
 */
export async function renderPieceThumbnail(glb: Uint8Array, size = PIECE_RENDER_SIZE): Promise<Buffer> {
  const meshes = await loadMeshes(glb)
  let tris = 0
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const m of meshes) {
    tris += m.idx.length / 3
    for (let i = 0; i < m.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = m.pos[i + k]
        if (v < min[k]) min[k] = v
        if (v > max[k]) max[k] = v
      }
    }
  }
  if (tris === 0 || !Number.isFinite(min[0])) throw new Error('GLB has no triangles to render')

  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2)

  // Camera basis. Looks at the centre from AZIMUTH/POLAR (polar measured from +Y).
  const az = (AZIMUTH_DEG * Math.PI) / 180, pol = (POLAR_DEG * Math.PI) / 180
  const back = [Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az)] // camera → its own +Z
  const dist = radius / Math.sin((FOV_DEG * Math.PI) / 360) * 1.1
  const eye = [center[0] + back[0] * dist, center[1] + back[1] * dist, center[2] + back[2] * dist]
  const right = norm(cross([0, 1, 0], back))
  const up = cross(back, right)

  // Project every vertex; screen coords are fitted to the frame afterwards so the
  // piece fills the picture whatever its proportions.
  const S = size * 2
  const projected = meshes.map((m) => {
    const n = m.pos.length / 3
    const sx = new Float32Array(n), sy = new Float32Array(n), iz = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const dx = m.pos[i * 3] - eye[0], dy = m.pos[i * 3 + 1] - eye[1], dz = m.pos[i * 3 + 2] - eye[2]
      const x = dx * right[0] + dy * right[1] + dz * right[2]
      const y = dx * up[0] + dy * up[1] + dz * up[2]
      const depth = -(dx * back[0] + dy * back[1] + dz * back[2]) // > 0 in front
      const d = Math.max(depth, 1e-6)
      sx[i] = x / d; sy[i] = y / d; iz[i] = 1 / d
    }
    return { sx, sy, iz }
  })
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const p of projected) {
    for (let i = 0; i < p.sx.length; i++) {
      if (p.sx[i] < x0) x0 = p.sx[i]; if (p.sx[i] > x1) x1 = p.sx[i]
      if (p.sy[i] < y0) y0 = p.sy[i]; if (p.sy[i] > y1) y1 = p.sy[i]
    }
  }
  const usable = S * (1 - 2 * PADDING)
  const scale = usable / Math.max(x1 - x0, y1 - y0, 1e-9)
  const ox = S / 2 - ((x0 + x1) / 2) * scale
  const oy = S / 2 + ((y0 + y1) / 2) * scale
  for (const p of projected) {
    for (let i = 0; i < p.sx.length; i++) {
      p.sx[i] = p.sx[i] * scale + ox
      p.sy[i] = oy - p.sy[i] * scale
    }
  }

  // Lights in world space: key from above-front-left of the camera, a softer fill
  // from the other side, plus sky/ground ambient.
  const key = norm([back[0] * 0.6 - right[0] * 0.5 + 0.0, 1.0, back[2] * 0.6 - right[2] * 0.5])
  const fill = norm([back[0] * 0.8 + right[0] * 0.8, 0.25, back[2] * 0.8 + right[2] * 0.8])
  const viewDir = back // from the surface toward the camera (orthographic approx.)
  const halfKey = norm([key[0] + viewDir[0], key[1] + viewDir[1], key[2] + viewDir[2]])

  const zbuf = new Float32Array(S * S) // stores 1/depth; 0 = empty
  const nbuf = new Float32Array(S * S * 3)

  for (let mi = 0; mi < meshes.length; mi++) {
    const m = meshes[mi], p = projected[mi]
    const { sx, sy, iz } = p
    const hasN = m.nrm.length === m.pos.length
    for (let t = 0; t < m.idx.length; t += 3) {
      const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2]
      const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c]
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (area === 0 || !Number.isFinite(area)) continue
      // Face normal (world), used when the mesh has no vertex normals and to keep
      // two-sided shading facing the camera (open meshes have no back to hide).
      const e1 = [m.pos[b * 3] - m.pos[a * 3], m.pos[b * 3 + 1] - m.pos[a * 3 + 1], m.pos[b * 3 + 2] - m.pos[a * 3 + 2]]
      const e2 = [m.pos[c * 3] - m.pos[a * 3], m.pos[c * 3 + 1] - m.pos[a * 3 + 1], m.pos[c * 3 + 2] - m.pos[a * 3 + 2]]
      const fn = norm(cross(e1, e2))
      const towardEye = [eye[0] - m.pos[a * 3], eye[1] - m.pos[a * 3 + 1], eye[2] - m.pos[a * 3 + 2]]
      const flip = dot(fn, towardEye) < 0 ? -1 : 1

      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
      const maxX = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx)))
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
      const maxY = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)))
      if (minX > maxX || minY > maxY) continue
      const inv = 1 / area
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5
          let w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv
          let w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv
          let w2 = 1 - w0 - w1
          if (w0 < 0 || w1 < 0 || w2 < 0) continue
          const z = w0 * iz[a] + w1 * iz[b] + w2 * iz[c]
          const o = y * S + x
          if (z <= zbuf[o]) continue
          zbuf[o] = z
          let nx: number, ny: number, nz: number
          if (hasN) {
            // Perspective-correct weights.
            w0 *= iz[a] / z; w1 *= iz[b] / z; w2 *= iz[c] / z
            nx = w0 * m.nrm[a * 3] + w1 * m.nrm[b * 3] + w2 * m.nrm[c * 3]
            ny = w0 * m.nrm[a * 3 + 1] + w1 * m.nrm[b * 3 + 1] + w2 * m.nrm[c * 3 + 1]
            nz = w0 * m.nrm[a * 3 + 2] + w1 * m.nrm[b * 3 + 2] + w2 * m.nrm[c * 3 + 2]
            // A back face seen through an open mesh: turn its normals toward us.
            if (flip < 0 && fn[0] * nx + fn[1] * ny + fn[2] * nz < 0) { nx = -nx; ny = -ny; nz = -nz }
          } else {
            nx = fn[0] * flip; ny = fn[1] * flip; nz = fn[2] * flip
          }
          nbuf[o * 3] = nx; nbuf[o * 3 + 1] = ny; nbuf[o * 3 + 2] = nz
        }
      }
    }
  }

  // Shade.
  const rgb = Buffer.alloc(S * S * 3)
  for (let y = 0; y < S; y++) {
    const ty = y / (S - 1)
    const bg = [0, 1, 2].map((k) => BG_TOP[k] + (BG_BOTTOM[k] - BG_TOP[k]) * ty)
    for (let x = 0; x < S; x++) {
      const o = y * S + x
      if (zbuf[o] === 0) {
        rgb[o * 3] = bg[0]; rgb[o * 3 + 1] = bg[1]; rgb[o * 3 + 2] = bg[2]
        continue
      }
      let nx = nbuf[o * 3], ny = nbuf[o * 3 + 1], nz = nbuf[o * 3 + 2]
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l; ny /= l; nz /= l
      const kd = Math.max(0, nx * key[0] + ny * key[1] + nz * key[2])
      const fd = Math.max(0, nx * fill[0] + ny * fill[1] + nz * fill[2])
      const hemi = 0.5 + 0.5 * ny // sky above, ground below
      const spec = Math.pow(Math.max(0, nx * halfKey[0] + ny * halfKey[1] + nz * halfKey[2]), 24) * 0.12
      const light = 0.18 + 0.22 * hemi + 0.62 * kd + 0.2 * fd
      for (let k = 0; k < 3; k++) {
        rgb[o * 3 + k] = Math.max(0, Math.min(255, CLAY[k] * light + 255 * spec))
      }
    }
  }

  // Dark outline where depth jumps, so a grey piece reads against a grey floor and
  // overlapping parts stay separate.
  const edge = Buffer.from(rgb)
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const o = y * S + x
      const z = zbuf[o]
      let jump = false
      for (const n of [o - 1, o + 1, o - S, o + S]) {
        const zn = zbuf[n]
        if (z === 0 && zn === 0) continue
        if (z === 0 || zn === 0 || Math.abs(1 / z - 1 / zn) > radius * 0.04) { if (z >= zn) { jump = true; break } }
      }
      if (jump) for (let k = 0; k < 3; k++) edge[o * 3 + k] = Math.round(rgb[o * 3 + k] * 0.45)
    }
  }

  const sharp = (await import('sharp')).default
  return sharp(edge, { raw: { width: S, height: S, channels: 3 } })
    .resize(size, size, { kernel: 'lanczos3' })
    .webp({ quality: 88 })
    .toBuffer()
}
