// backend/src/services/proxyBake/bake.ts
//
// The TS side of the Preview Proxy Bake Pipeline. It orchestrates one bake:
//   1. download the source mesh from R2,
//   2. run bake_proxy.py in Blender (headless, CPU-only) with a hard timeout,
//   3. post-process the exported GLB with gltf-transform (prune, Draco, texture
//      recompress: normal PNG, AO/baseColor WebP),
//   4. composite the six validation renders into one comparison PNG,
//   5. upload GLB + comparison + report JSON to R2 under stable, idempotent keys,
//   6. return the keys + augmented report to the caller (the worker).
//
// It never throws a bare error without context, always cleans up its temp dir,
// and treats a Blender timeout as a clean failure (kills the process group).

import { spawn } from 'child_process'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'
import logger from '../../utils/logger'
import { downloadObject, uploadObject } from '../r2'
import { loadBakeConfig, type ProxyBakeConfig, type ProxyBakeConfigOverrides } from './config'

// @gltf-transform/* is ESM-only; the CommonJS build must import it dynamically
// (same shim used in services/fileProcessor.ts).
const importESM = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string,
) => Promise<T>

const BLENDER_PATH = process.env.BLENDER_PATH || 'blender'
const BAKE_SCRIPT_PATH =
  process.env.BAKE_SCRIPT_PATH || path.resolve(process.cwd(), 'blender/bake_proxy.py')

export interface BakeJobInput {
  jobId: string
  modelId: string
  /** NULL for the model's primary mesh; otherwise the model_parts id. */
  partId: string | null
  /** R2 key of the canonical STL / source mesh to bake. */
  sourceKey: string
  /** 'stl' | 'obj' | '3mf' — decides the temp file extension we hand Blender. */
  sourceFormat: string
  /** Per-model config overrides (merged over the global defaults). */
  overrides?: ProxyBakeConfigOverrides | null
}

export interface BakeResult {
  /** R2 key of the final Draco-compressed proxy GLB (store as glb_file_path). */
  glbKey: string
  /** R2 key of the side-by-side comparison PNG (QA aid). */
  comparisonKey: string | null
  /** R2 key of the report JSON. */
  reportKey: string
  /** The full report object (also persisted to the DB by the worker). */
  report: any
}

/** R2 key prefix for a job's artefacts. Stable per model/part so re-runs overwrite. */
function artefactPrefix(input: BakeJobInput): string {
  return input.partId
    ? `previews/${input.modelId}/part-${input.partId}`
    : `previews/${input.modelId}`
}

function sourceExt(format: string): string {
  const f = (format || 'stl').toLowerCase()
  // The worker always bakes from a mesh Blender can import directly. Our canonical
  // internal format is STL; OBJ sources keep their extension so materials survive.
  return f === 'obj' ? '.obj' : '.stl'
}

/**
 * Run Blender headless with a hard timeout. Resolves with {code, stdout, stderr};
 * on timeout it kills the whole process tree and resolves with code = 'timeout'.
 */
function runBlender(
  args: string[],
  timeoutMs: number,
): Promise<{ timedOut: boolean; code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(BLENDER_PATH, args, {
      // Detached so we can signal the whole group on timeout (Blender spawns helpers).
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ timedOut, code: null, stdout, stderr: stderr + '\n' + String(err) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ timedOut, code, stdout, stderr })
    })
  })
}

/**
 * gltf-transform post-process: prune unused data, recompress textures (normal PNG,
 * AO/baseColor WebP q80), and Draco-compress geometry. Writes the final GLB.
 */
export async function postProcessGlb(inGlb: string, outGlb: string, cfg: ProxyBakeConfig): Promise<void> {
  const { NodeIO } = await importESM<typeof import('@gltf-transform/core')>('@gltf-transform/core')
  const { prune, dedup, draco, textureCompress } = await importESM<
    typeof import('@gltf-transform/functions')
  >('@gltf-transform/functions')
  const { KHRDracoMeshCompression } = await importESM<typeof import('@gltf-transform/extensions')>(
    '@gltf-transform/extensions',
  )
  const sharpMod: any = await importESM('sharp')
  const sharp = sharpMod.default ?? sharpMod
  const draco3dMod: any = await importESM('draco3dgltf')
  const draco3d = draco3dMod.default ?? draco3dMod

  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule(),
    })

  const doc = await io.read(inGlb)

  const transforms: any[] = [prune(), dedup()]
  // Texture recompression is best-effort: if sharp can't encode (unusual), we keep
  // Blender's PNGs — a larger but still-valid GLB, never a failed job.
  try {
    // AO + baseColor -> WebP q80 (lossy is fine on these).
    transforms.push(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        quality: 80,
        slots: /occlusion|baseColor|metallicRoughness/,
      }),
    )
    // Normal map -> PNG only (lossy artefacts on normals are visible; never WebP/JPEG).
    transforms.push(
      textureCompress({
        encoder: sharp,
        targetFormat: 'png',
        slots: /normal/,
      }),
    )
  } catch (err) {
    logger.warn('proxyBake: texture recompress unavailable, keeping source textures', { err })
  }
  // Draco last so it compresses the final geometry.
  transforms.push(draco())

  await doc.transform(...transforms)
  await io.write(outGlb, doc)
}

/**
 * Composite the six validation renders (source vs proxy at 3 distances) into one
 * comparison PNG: rows = distance (near/typical/far), columns = source | proxy.
 * Best-effort — returns null if the renders are missing.
 */
async function compositeComparison(dir: string, outPng: string, tilePx: number): Promise<string | null> {
  const sharpMod: any = await importESM('sharp')
  const sharp = sharpMod.default ?? sharpMod

  const rows = 3
  const pairs: Array<{ src: string; proxy: string }> = []
  for (let i = 0; i < rows; i++) {
    pairs.push({
      src: path.join(dir, `render_source_${i}.png`),
      proxy: path.join(dir, `render_proxy_${i}.png`),
    })
  }
  // All six files must exist to build a meaningful grid.
  for (const p of pairs) {
    try {
      await fsp.access(p.src)
      await fsp.access(p.proxy)
    } catch {
      return null
    }
  }

  const gap = 8
  const W = tilePx * 2 + gap * 3
  const H = tilePx * rows + gap * (rows + 1)
  const composites: Array<{ input: string; left: number; top: number }> = []
  for (let i = 0; i < rows; i++) {
    const top = gap + i * (tilePx + gap)
    composites.push({ input: pairs[i].src, left: gap, top })
    composites.push({ input: pairs[i].proxy, left: gap * 2 + tilePx, top })
  }

  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 24, g: 24, b: 28 } },
  })
    .composite(composites)
    .png()
    .toFile(outPng)
  return outPng
}

/**
 * Run one full bake and publish its artefacts. Throws on genuine failure (bad
 * source, Blender error, timeout, poison-pill assertion) with a machine-readable
 * message the worker records on the job. Idempotent: overwrites stable R2 keys.
 */
export async function runProxyBake(input: BakeJobInput): Promise<BakeResult> {
  const cfg = loadBakeConfig(input.overrides)
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'aa-bake-'))
  const outDir = path.join(work, 'out')
  await fsp.mkdir(outDir, { recursive: true })

  const log = logger.child('PROXY_BAKE')
  try {
    // 1. Source + config to disk for Blender.
    const srcPath = path.join(work, `source${sourceExt(input.sourceFormat)}`)
    const srcBuf = await downloadObject(input.sourceKey)
    await fsp.writeFile(srcPath, srcBuf)

    // embossSeed is per-JOB identity (model + part), not a tunable knob, so it's
    // merged onto the serialized config rather than living in ProxyBakeConfig
    // itself — bake_proxy.py's _emboss_punch_through hashes it to jitter the
    // watermark's angle/position/phase deterministically per model (same model
    // re-bakes identically; every other model differs), so a script tuned
    // against one leaked model's exact hole geometry doesn't transfer to
    // another (see bake_proxy.py's docstring for the full reasoning).
    const embossSeed = `${input.modelId}:${input.partId ?? 'primary'}`
    const cfgPath = path.join(work, 'config.json')
    await fsp.writeFile(cfgPath, JSON.stringify({ ...cfg, embossSeed }))

    // 2. Blender bake with a hard timeout.
    const timeoutMs = Math.max(1, cfg.bakeTimeoutMinutes) * 60_000
    log.info('Bake starting', { jobId: input.jobId, modelId: input.modelId, partId: input.partId })
    const res = await runBlender(
      ['-b', '-P', BAKE_SCRIPT_PATH, '--', '--config', cfgPath, '--input', srcPath, '--out-dir', outDir],
      timeoutMs,
    )
    if (res.timedOut) {
      throw new Error(`Bake timed out after ${cfg.bakeTimeoutMinutes} min`)
    }

    // 3. Read the report the script wrote (present on both success and failure).
    let report: any = null
    try {
      report = JSON.parse(await fsp.readFile(path.join(outDir, 'report.json'), 'utf8'))
    } catch {
      /* fall through to the exit-code / stderr diagnosis below */
    }
    if (!report || report.status !== 'ok') {
      const reason =
        (report && report.error) ||
        (res.stderr || '').trim().split('\n').slice(-3).join(' ') ||
        `Blender exited ${res.code}`
      throw new Error(`Bake failed: ${reason}`)
    }

    // 4. Post-process the GLB (prune, texture recompress, Draco).
    const rawGlb = path.join(outDir, 'proxy_raw.glb')
    const finalGlb = path.join(outDir, 'proxy.glb')
    await postProcessGlb(rawGlb, finalGlb, cfg)

    const glbBytes = (await fsp.stat(finalGlb)).size
    const finalMb = glbBytes / (1024 * 1024)
    report.finalFileMb = Number(finalMb.toFixed(3))
    report.targetMaxFileMb = cfg.targetMaxFileMb
    if (finalMb > cfg.targetMaxFileMb) {
      report.warnings = report.warnings || []
      report.warnings.push(
        `Final GLB ${finalMb.toFixed(2)}MB exceeds target ${cfg.targetMaxFileMb}MB`,
      )
    }

    // 5. Comparison PNG (QA aid; best-effort). Skipped unless the config opts in —
    // Blender didn't produce render_source_*/render_proxy_* files in that case, so
    // don't bother probing for them.
    const comparePng = path.join(outDir, 'compare.png')
    const composed = cfg.validationRenderEnabled
      ? await compositeComparison(outDir, comparePng, cfg.validationRenderPx).catch(() => null)
      : null

    // 6. Publish to R2 under stable keys (overwrite on re-run — idempotent).
    const prefix = artefactPrefix(input)
    const glbKey = `${prefix}/proxy.glb`
    const reportKey = `${prefix}/report.json`
    const comparisonKey = composed ? `${prefix}/compare.png` : null

    await uploadObject(glbKey, await fsp.readFile(finalGlb), 'model/gltf-binary', { immutable: false })
    await uploadObject(
      reportKey,
      Buffer.from(JSON.stringify(report, null, 2)),
      'application/json',
      { immutable: false },
    )
    if (composed && comparisonKey) {
      await uploadObject(comparisonKey, await fsp.readFile(comparePng), 'image/png', {
        immutable: false,
      })
    }

    log.info('Bake complete', {
      jobId: input.jobId,
      glbKey,
      proxyTriangles: report.proxyTriangles,
      finalMb: report.finalFileMb,
    })
    return { glbKey, comparisonKey, reportKey, report }
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
