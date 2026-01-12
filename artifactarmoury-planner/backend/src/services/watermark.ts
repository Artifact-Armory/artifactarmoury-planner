// backend/src/services/watermark.ts
// Utilities for embedding watermarks and metadata into 3D assets and previews

import crypto from 'crypto'
import path from 'path'
import { promises as fs } from 'fs'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { Document, NodeIO } from '@gltf-transform/core'
import logger from '../utils/logger'
import { parseSTL } from './fileProcessor'

export interface WatermarkPayload {
  artistId: string
  watermarkId: string
  embeddedAt: string
  platformId: string
  uploadIp?: string
  notes?: string
}

/**
 * Generate a deterministic watermark payload.
 */
export function buildWatermarkPayload(options: {
  artistId: string
  platformId: string
  uploadIp?: string
  notes?: string
}): WatermarkPayload {
  const watermarkId = crypto.randomUUID()
  return {
    artistId: options.artistId,
    platformId: options.platformId,
    watermarkId,
    uploadIp: options.uploadIp,
    notes: options.notes,
    embeddedAt: new Date().toISOString(),
  }
}

/**
 * Derive a short signature hash that can be stored for later comparison.
 */
export function deriveFingerprintSignature(meshFeatures: number[]): string {
  const hash = crypto.createHash('sha256')
  for (const value of meshFeatures) {
    hash.update(value.toFixed(6))
  }
  return hash.digest('base64')
}

/**
 * Embed invisible watermark into STL geometry by nudging select vertices.
 */
export async function embedStlWatermark(stlPath: string, payload: WatermarkPayload): Promise<{ triangleCount: number }> {
  const stl = await parseSTL(stlPath)

  if (stl.triangleCount === 0) {
    throw new Error('Cannot watermark empty STL')
  }

  const seed = crypto.createHash('sha256')
    .update(payload.artistId)
    .update(payload.watermarkId)
    .update(payload.platformId)
    .digest()

  // Deterministic pseudo random generator
  let cursor = 0
  const nextRandom = () => {
    if (cursor >= seed.length) cursor = 0
    const value = seed[cursor]
    cursor += 1
    return value / 255
  }

  const magnitude = 0.0008 // ~0.8 micron in model units (mm), imperceptible

  for (let i = 0; i < stl.triangles.length; i++) {
    const triangle = stl.triangles[i]
    const shouldEmbed = nextRandom() > 0.92 // Embed roughly 8% of faces
    if (!shouldEmbed) continue

    const sign = nextRandom() > 0.5 ? 1 : -1
    const offset = magnitude * sign

    for (const vertex of triangle.vertices) {
      vertex.x += triangle.normal.x * offset
      vertex.y += triangle.normal.y * offset
      vertex.z += triangle.normal.z * offset
    }
  }

  await writeBinarySTL(stl, stlPath, payload)
  return { triangleCount: stl.triangleCount }
}

/**
 * Write modified STL geometry to disk with metadata in the header.
 */
async function writeBinarySTL(stl: Awaited<ReturnType<typeof parseSTL>>, targetPath: string, payload: WatermarkPayload): Promise<void> {
  const header = Buffer.alloc(80, 0)
  const headerText = `AA-WM|artist=${payload.artistId}|wm=${payload.watermarkId}|ts=${payload.embeddedAt}`
  header.write(headerText.slice(0, 80), 0, 'ascii')

  const triangleBuffer = Buffer.alloc(4 + stl.triangleCount * 50)
  triangleBuffer.writeUInt32LE(stl.triangleCount, 0)

  let offset = 4
  for (const triangle of stl.triangles) {
    triangleBuffer.writeFloatLE(triangle.normal.x, offset)
    triangleBuffer.writeFloatLE(triangle.normal.y, offset + 4)
    triangleBuffer.writeFloatLE(triangle.normal.z, offset + 8)
    offset += 12

    for (const vertex of triangle.vertices) {
      triangleBuffer.writeFloatLE(vertex.x, offset)
      triangleBuffer.writeFloatLE(vertex.y, offset + 4)
      triangleBuffer.writeFloatLE(vertex.z, offset + 8)
      offset += 12
    }

    triangleBuffer.writeUInt16LE(0, offset)
    offset += 2
  }

  await fs.writeFile(targetPath, Buffer.concat([header, triangleBuffer]))
}

/**
 * Embed metadata in a GLB file using extras.
 */
export async function stampGlbMetadata(glbPath: string, payload: WatermarkPayload): Promise<void> {
  try {
    const io = new NodeIO()
    const document = await io.read(glbPath)
    const root = document.getRoot()

    const existingExtras = root.getExtras() ?? {}
    root.setExtras({
      ...existingExtras,
      artifactArmouryWatermark: {
        artistId: payload.artistId,
        watermarkId: payload.watermarkId,
        embeddedAt: payload.embeddedAt,
        platformId: payload.platformId,
      },
    })

    const glbBuffer = await io.writeBinary(document)
    await fs.writeFile(glbPath, Buffer.from(glbBuffer))
  } catch (error) {
    logger.error('Failed to stamp GLB metadata', { error, glbPath })
    throw error
  }
}

/**
 * Apply an unobtrusive hash-based watermark pattern to a PNG thumbnail in place.
 */
export async function applyPngWatermark(pngPath: string, payload: WatermarkPayload): Promise<void> {
  const buffer = await fs.readFile(pngPath)
  const png = PNG.sync.read(buffer)

  const signature = crypto.createHash('sha256').update(payload.watermarkId).digest()
  let sigCursor = 0

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2
      const shouldTint = ((x + y) % 11 === 0)

      if (shouldTint) {
        const strength = 6 + (signature[sigCursor % signature.length] % 12)
        sigCursor += 1
        png.data[idx + 0] = clampColor(png.data[idx + 0] + strength)
        png.data[idx + 1] = clampColor(png.data[idx + 1] + strength)
        png.data[idx + 2] = clampColor(png.data[idx + 2] + strength)
      }
    }
  }

  const out = PNG.sync.write(png)
  await fs.writeFile(pngPath, out)
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, value))
}

/**
 * Watermark user-provided previews (JPEG/PNG/WebP) using Sharp overlays.
 */
export async function watermarkPreviewImage(imagePath: string, payload: WatermarkPayload): Promise<void> {
  const watermarkText = `ArtifactArmoury • ${payload.artistId.slice(0, 8)} • ${payload.watermarkId.slice(0, 8)}`

  const svg = `
    <svg width="800" height="200">
      <style>
        .wm { fill: rgba(255,255,255,0.25); font-size: 48px; font-family: sans-serif; }
      </style>
      <text x="50%" y="50%" text-anchor="middle" class="wm">${watermarkText}</text>
    </svg>
  `

  const image = sharp(imagePath)
  const metadata = await image.metadata()

  const overlay = await sharp(Buffer.from(svg))
    .resize({
      width: Math.round((metadata.width ?? 1024) * 0.9),
      height: Math.round((metadata.height ?? 1024) * 0.25),
      fit: 'contain',
    })
    .png()
    .toBuffer()

  const output = await image
    .ensureAlpha()
    .composite([
      {
        input: overlay,
        gravity: 'southwest',
        blend: 'overlay',
      },
    ])
    .withMetadata({
      exif: {
        IFD0: {
          Artist: payload.artistId,
          Copyright: `ArtifactArmoury ${payload.embeddedAt}`,
          ImageDescription: `Watermarked by ArtifactArmoury | Watermark ${payload.watermarkId}`,
        },
      },
    })
    .toBuffer()

  await fs.writeFile(imagePath, output)
}

/**
 * Persist metadata into a simple manifest JSON next to the source files.
 */
export async function writeWatermarkManifest(targetDir: string, payload: WatermarkPayload): Promise<string> {
  const manifest = {
    ...payload,
    manifestVersion: 1,
  }

  await fs.mkdir(targetDir, { recursive: true })
  const manifestPath = path.join(targetDir, `watermark-${payload.watermarkId}.json`)
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  return manifestPath
}

/**
 * Generate a compact numeric signature vector for similarity checks.
 */
export function buildMeshFeatureVector(volume: number, surfaceArea: number, dimensions: { x: number; y: number; z: number }, triangleCount: number): number[] {
  const sortedDims = [dimensions.x, dimensions.y, dimensions.z].sort((a, b) => a - b)
  return [
    Number(volume.toFixed(4)),
    Number(surfaceArea.toFixed(4)),
    Number((sortedDims[0] / (sortedDims[2] || 1)).toFixed(6)),
    Number((sortedDims[1] / (sortedDims[2] || 1)).toFixed(6)),
    Number((triangleCount || 0) / 1_000_000),
  ]
}

/**
 * Placeholder similarity score (cosine similarity) between two feature vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let sumA = 0
  let sumB = 0
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i]
    sumA += a[i] * a[i]
    sumB += b[i] * b[i]
  }
  const denom = Math.sqrt(sumA) * Math.sqrt(sumB) || 1
  return dot / denom
}
