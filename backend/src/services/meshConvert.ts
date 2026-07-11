// backend/src/services/meshConvert.ts
//
// Multi-format mesh ingest. Artists may upload STL, OBJ or 3MF. STL is our
// canonical internal + delivery format (it's what the geometry fingerprint, the
// preview-GLB pipeline and the per-buyer header watermark all operate on), so
// OBJ/3MF are parsed to a triangle soup and re-emitted as a binary STL. The
// artist's *original* file is preserved separately and delivered to the buyer
// alongside the STL, with a best-effort watermark stamped into a slicer-ignored
// slot (OBJ: a leading comment; 3MF: a metadata part inside the zip).

import AdmZip from 'adm-zip'
import { buildWatermarkHeader, type WatermarkPayload } from './watermark'

export type MeshFormat = 'stl' | 'obj' | '3mf'

interface V3 { x: number; y: number; z: number }
interface Tri { vertices: [V3, V3, V3] }

/** Map a filename/key extension to a supported mesh format, or null. */
export function meshFormatFromName(nameOrKey: string): MeshFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(nameOrKey || '')
  const ext = m ? m[1].toLowerCase() : ''
  if (ext === 'stl') return 'stl'
  if (ext === 'obj') return 'obj'
  if (ext === '3mf') return '3mf'
  return null
}

// ---------------------------------------------------------------------------
// OBJ  (Wavefront) — text: `v x y z` vertices, `f i j k …` faces (fan-triangulated)
// ---------------------------------------------------------------------------

function parseOBJ(buffer: Buffer): Tri[] {
  const verts: V3[] = []
  const tris: Tri[] = []
  const text = buffer.toString('utf8')

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line[0] === '#') continue

    if (line[0] === 'v' && (line[1] === ' ' || line[1] === '\t')) {
      const p = line.split(/\s+/)
      verts.push({ x: parseFloat(p[1]), y: parseFloat(p[2]), z: parseFloat(p[3]) })
    } else if (line[0] === 'f' && (line[1] === ' ' || line[1] === '\t')) {
      const tokens = line.split(/\s+/).slice(1)
      // Each face vertex is `v`, `v/vt`, `v/vt/vn` or `v//vn` — we only need `v`.
      const idx: number[] = tokens.map((t) => {
        let n = parseInt(t.split('/')[0], 10)
        if (Number.isNaN(n)) return NaN
        // OBJ is 1-based; negative indices are relative to the current vertex count.
        if (n < 0) n = verts.length + n
        else n -= 1
        return n
      })
      if (idx.some((n) => Number.isNaN(n) || n < 0 || n >= verts.length)) continue
      // Fan-triangulate an n-gon (n>=3).
      for (let k = 1; k + 1 < idx.length; k++) {
        tris.push({ vertices: [verts[idx[0]], verts[idx[k]], verts[idx[k + 1]]] })
      }
    }
  }

  if (tris.length === 0) throw new Error('OBJ file contained no triangles')
  return tris
}

// ---------------------------------------------------------------------------
// 3MF — a zip (OPC) whose `3D/*.model` part is XML: <mesh><vertices><vertex …/>
// … <triangles><triangle v1= v2= v3= …/></triangles></mesh>. We concatenate the
// triangles from every <mesh> in model coordinates (build-item transforms are
// ignored — fine for the single-object terrain pieces this marketplace sells).
// ---------------------------------------------------------------------------

function attr(tag: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag)
  return m ? parseFloat(m[1]) : NaN
}

function parse3MF(buffer: Buffer): Tri[] {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch {
    throw new Error('3MF file is not a valid zip archive')
  }
  const modelEntry = zip.getEntries().find((e) => /\.model$/i.test(e.entryName))
  if (!modelEntry) throw new Error('3MF archive has no 3D model part')
  const xml = modelEntry.getData().toString('utf8')

  const tris: Tri[] = []
  const meshBlocks = xml.match(/<mesh\b[\s\S]*?<\/mesh>/gi) || []
  for (const mesh of meshBlocks) {
    const verts: V3[] = []
    for (const vtag of mesh.match(/<vertex\b[^>]*>/gi) || []) {
      verts.push({ x: attr(vtag, 'x'), y: attr(vtag, 'y'), z: attr(vtag, 'z') })
    }
    for (const ttag of mesh.match(/<triangle\b[^>]*>/gi) || []) {
      const v1 = attr(ttag, 'v1'), v2 = attr(ttag, 'v2'), v3 = attr(ttag, 'v3')
      if ([v1, v2, v3].some((n) => Number.isNaN(n) || n < 0 || n >= verts.length)) continue
      tris.push({ vertices: [verts[v1], verts[v2], verts[v3]] })
    }
  }

  if (tris.length === 0) throw new Error('3MF file contained no triangles')
  return tris
}

// ---------------------------------------------------------------------------
// Triangles → binary STL
// ---------------------------------------------------------------------------

/** Serialise a triangle list to a binary STL buffer (per-face normal computed). */
export function trianglesToBinarySTL(tris: Tri[]): Buffer {
  const buf = Buffer.alloc(84 + tris.length * 50)
  // 80-byte header stays zero — it's overwritten by the per-buyer watermark on
  // download anyway; the geometry the buyer prints lives from byte 84 on.
  buf.writeUInt32LE(tris.length, 80)

  let o = 84
  for (const t of tris) {
    const [a, b, c] = t.vertices
    // Face normal from the cross product of two edges (normalised; 0 if degenerate).
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len

    buf.writeFloatLE(nx, o); buf.writeFloatLE(ny, o + 4); buf.writeFloatLE(nz, o + 8)
    buf.writeFloatLE(a.x, o + 12); buf.writeFloatLE(a.y, o + 16); buf.writeFloatLE(a.z, o + 20)
    buf.writeFloatLE(b.x, o + 24); buf.writeFloatLE(b.y, o + 28); buf.writeFloatLE(b.z, o + 32)
    buf.writeFloatLE(c.x, o + 36); buf.writeFloatLE(c.y, o + 40); buf.writeFloatLE(c.z, o + 44)
    // 2-byte attribute count stays 0.
    o += 50
  }
  return buf
}

/**
 * Convert an uploaded model file to a canonical binary STL buffer. For an STL
 * upload this is a passthrough (the artist's bytes are already our format).
 */
export function convertToStl(buffer: Buffer, format: MeshFormat): Buffer {
  if (format === 'stl') return buffer
  const tris = format === 'obj' ? parseOBJ(buffer) : parse3MF(buffer)
  return trianglesToBinarySTL(tris)
}

// ---------------------------------------------------------------------------
// Best-effort watermark for the delivered *original* (OBJ / 3MF)
// ---------------------------------------------------------------------------

/** The encrypted watermark header, base64 — shared by both original formats. */
function watermarkTag(payload: WatermarkPayload): string {
  return buildWatermarkHeader(payload).toString('base64')
}

/**
 * Stamp a best-effort per-buyer watermark into an original OBJ/3MF so a leaked
 * copy of the *original* file (not just the STL) can still be traced. Weaker than
 * the STL header trace — a determined thief can strip a comment / delete a zip
 * entry — but it costs nothing and catches casual leaks. STL is handled by the
 * existing header watermark, so this is only called for obj/3mf.
 */
export function watermarkOriginal(buffer: Buffer, format: MeshFormat, payload: WatermarkPayload): Buffer {
  const tag = watermarkTag(payload)
  if (format === 'obj') {
    // A leading comment line — OBJ comments (`#`) are ignored by every slicer.
    return Buffer.concat([Buffer.from(`# AAWM:${tag}\n`, 'utf8'), buffer])
  }
  if (format === '3mf') {
    try {
      const zip = new AdmZip(buffer)
      zip.addFile('Metadata/aawm.txt', Buffer.from(tag, 'utf8'))
      return zip.toBuffer()
    } catch {
      return buffer // never fail a download over the watermark
    }
  }
  return buffer
}

export default { meshFormatFromName, convertToStl, trianglesToBinarySTL, watermarkOriginal }
