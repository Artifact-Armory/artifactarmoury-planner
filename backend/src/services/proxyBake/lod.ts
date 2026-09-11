// backend/src/services/proxyBake/lod.ts
//
// PLANNER LOD — a third, much lighter variant of the preview mesh, derived from
// the same Blender bake as the public proxy.
//
// WHY THIS EXISTS
// ---------------
// The planner draws a whole TABLE, not one product. A real artist showcase,
// measured in a browser against live production: 28 distinct models, 85.07 MB of
// downloads and 9,116,141 triangles, taking ~9 seconds to appear and running
// heavily afterwards. The public proxy is sized for looking at ONE piece on its
// product page — several hundred thousand triangles is defensible there and
// ruinous thirty times over. So the planner gets its own tier.
//
// WHY IT COULD NOT BE BUILT BEFORE
// --------------------------------
// It is not that decimation was never tried: proxyDecimationEnabled and its
// adaptive budget have been in this pipeline all along. The blocker was that the
// proxy shipped FLAT-SHADED. An STL carries no vertex normals, so Blender imports
// it flat, and a flat-shaded mesh cannot share a vertex between two triangles —
// each one needs its own copy carrying the face normal. Across that whole live
// showcase: 9,116,141 triangles stored as 26,217,059 vertices — 2.88 per triangle,
// where a welded mesh runs 0.6-1.4. With every edge a seam there is nothing left to
// collapse, and meshopt simply refuses: asked for 33% of a real bake it returned
// 91-95% of the triangles. Crease shading (proxyCreaseAngleDeg) is what restores
// the shared edges, and with it the same call reaches the target exactly. That is
// the dependency — this module is useless with proxyCreaseAngleDeg at 0, and says
// so in its result rather than silently shipping a "LOD" as heavy as its input.
//
// WHY IT IS DERIVED HERE RATHER THAN IN ITS OWN QUEUE
// ---------------------------------------------------
// The expensive part of a bake is Blender (20-60s of unwrap, ray-cast bake and
// boolean work). Simplifying its output is a few seconds of pure Node on a mesh
// already sitting in a temp dir. A separate queue (the full_glb_jobs shape) would
// re-download the source to redo none of the work it needs, so it would cost more
// and could drift out of sync with the proxy it has to match. The trade is that an
// LOD only appears when a model is BAKED — existing catalogue proxies are
// flat-shaded and cannot be derived from at all, so backfilling old models means
// re-baking them, not re-processing them.
//
// ANTI-THEFT
// ----------
// The proxy's non-printability is a load-bearing product claim, and it is carried
// by GEOMETRY: the embossed logo through-holes, the deleted base faces and the
// stripped interior. Simplification must not soften any of that away, so
// lockBorder keeps every open boundary — which is exactly what those cuts are —
// pinned while the closed interior of the surface collapses. See
// plannerLodLockBorder in config.ts for the measurement behind that default.

import { promises as fsp } from 'fs'
import logger from '../../utils/logger'
import type { ProxyBakeConfig } from './config'

// @gltf-transform/* is ESM-only; the CommonJS build must import it dynamically
// (same shim used in bake.ts / services/fileProcessor.ts).
const importESM = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string,
) => Promise<T>

export interface PlannerLodResult {
  /** Triangles actually written to the LOD. */
  triangles: number
  /** Triangles in the proxy it was derived from. */
  sourceTriangles: number
  /** Final file size on disk, bytes (0 when skipped). */
  bytes: number
  /** True when no LOD was written, and the planner should keep using the proxy. */
  skipped: boolean
  /** Fraction of the proxy's TRIANGLES the collapse removed. Kept separately from
   *  the byte saving because it is the flat-shading diagnostic: a value near zero
   *  means weld() found nothing to merge, i.e. proxyCreaseAngleDeg was 0. */
  triangleReduction: number
  /** Fraction of the proxy's BYTES this LOD saves. -1 when the caller did not say
   *  how big the proxy ended up, so no byte comparison was possible. */
  byteReduction: number
  /** Why it was skipped, or anything else worth recording on the bake report. */
  note?: string
}

/** Triangles in a document, counted off the index buffers (or the positions, for
 *  a non-indexed primitive). */
function countTriangles(doc: any): number {
  let tris = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 /* TRIANGLES */) continue
      const idx = prim.getIndices()
      const pos = prim.getAttribute('POSITION')
      tris += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0
    }
  }
  return Math.round(tris)
}

/**
 * Derive the planner LOD from the bake's RAW (uncompressed, pre-Draco) GLB and
 * write it out Draco-compressed, ready to upload.
 *
 * Reads `inGlb` into its own Document rather than sharing one with postProcessGlb:
 * gltf-transform transforms mutate in place, and the shipped proxy must not
 * inherit the LOD's decimation. A second parse of a local temp file is noise next
 * to the bake that produced it.
 *
 * Returns `skipped: true` (having deleted anything it wrote) when the result would
 * not be meaningfully lighter than the proxy it was derived from — see the byte
 * test at the end. The planner then falls back to the proxy, which is the pre-LOD
 * behaviour — never a failure.
 */
export async function buildPlannerLod(
  inGlb: string,
  outGlb: string,
  cfg: ProxyBakeConfig,
  /** Size of the FINISHED proxy (post-process + Draco), for the worth-shipping
   *  test below. Omit it and that test falls back to counting triangles, which is
   *  the wrong quantity — see plannerLodMinReduction in config.ts. */
  proxyBytes?: number,
): Promise<PlannerLodResult> {
  const log = logger.child('PROXY_BAKE')
  const budget = Math.max(1, Math.floor(cfg.plannerLodTriangleBudget))

  const { NodeIO } = await importESM<typeof import('@gltf-transform/core')>('@gltf-transform/core')
  const { prune, dedup, draco, weld, simplify, textureCompress } = await importESM<
    typeof import('@gltf-transform/functions')
  >('@gltf-transform/functions')
  const { KHRDracoMeshCompression } = await importESM<typeof import('@gltf-transform/extensions')>(
    '@gltf-transform/extensions',
  )
  const draco3dMod: any = await importESM('draco3dgltf')
  const draco3d = draco3dMod.default ?? draco3dMod
  const meshopt: any = await importESM('meshoptimizer')
  const MeshoptSimplifier = meshopt.MeshoptSimplifier ?? meshopt.default?.MeshoptSimplifier
  if (MeshoptSimplifier?.ready) await MeshoptSimplifier.ready

  if (!MeshoptSimplifier) {
    return {
      triangles: 0,
      sourceTriangles: 0,
      bytes: 0,
      skipped: true,
      triangleReduction: 0,
      byteReduction: -1,
      note: 'meshoptimizer unavailable',
    }
  }

  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule(),
    })

  const doc = await io.read(inGlb)
  const sourceTriangles = countTriangles(doc)

  // Nothing to derive from. Only reachable if the bake produced a GLB with no
  // triangle primitives at all, which is a broken bake rather than a small model —
  // bail before the reduction arithmetic divides by it.
  if (sourceTriangles <= 0) {
    return {
      triangles: 0,
      sourceTriangles: 0,
      bytes: 0,
      skipped: true,
      triangleReduction: 0,
      byteReduction: -1,
      note: 'source GLB has no triangles',
    }
  }

  // NOTE there is deliberately no "already under the triangle budget, skip" bail
  // here any more. It cost real wins: a proxy can be under budget on triangles and
  // still be one of the heaviest files in a table, because its weight is in the
  // baked normal map rather than its geometry (measured: a 183k-triangle piece
  // shipping 2,180 KB, of which 1,157 KB was texture — the single biggest file in
  // the showcase table, and the old bail gave it no LOD at all). Simplify is a
  // no-op at ratio 1, so an under-budget mesh simply passes through the weld,
  // TANGENT drop and texture bounds, and the byte test at the end decides whether
  // the result was worth writing.
  // weld() is what turns Blender's exported corners back into a shared-vertex
  // mesh. On a crease-shaded proxy it merges the smooth interior and leaves the
  // crease and UV seams split; on a FLAT-shaded one it merges essentially nothing,
  // which is the case this whole module sits downstream of and must not pretend to
  // handle — the post-simplify reduction check below is what catches it.
  // NOTE on normals: Blender's ride through simplify() interpolated at each
  // collapsed vertex and are deliberately NOT rebuilt afterwards. The baked normal
  // map is TANGENT-space and was baked against these exact normals and UVs, so
  // recomputing them here would tilt the basis the map is read in and misshade the
  // whole surface. The map goes on carrying the detail the triangles lost — which
  // is the entire reason this pipeline bakes one.
  await doc.transform(
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, budget / sourceTriangles),
      error: cfg.plannerLodSimplifyError,
      // Open boundaries on this mesh ARE the anti-theft cuts — the embossed logo
      // through-holes, the removed base, the stripped interior. Locking them means
      // the silhouette of every hole survives the collapse exactly, so a ripped
      // LOD is no more printable than a ripped proxy.
      lockBorder: cfg.plannerLodLockBorder,
    }),
    prune(),
    dedup(),
  )

  // Drop the baked MikkTSpace tangents from THIS tier only.
  //
  // TANGENT is four floats per vertex and Draco compresses it poorly: measured
  // through this exact pipeline it was 15-38% of the finished LOD (32% on a wall
  // panel, 38% on a dense architectural piece, 15% on an organic stack). When a
  // mesh has no TANGENT, three.js derives one per-fragment from screen-space
  // derivatives instead — which is not a degraded mode so much as the norm: two of
  // the four real bakes tested here have been shipping that way in production all
  // along, because MikkTSpace silently aborted on the n-gons the emboss leaves
  // behind (see triangulate_for_export in bake_proxy.py, which fixes that).
  //
  // Checked in a real browser rather than assumed — both variants loaded through
  // the planner's own three.js and lighting, at a camera closer than its nearest
  // preset, including a model that previously DID carry tangents so the removal was
  // a genuine change. Rivet relief, louvre slats, sack seams and the emboss
  // cut-outs came out indistinguishable.
  //
  // The proxy keeps its tangents: it is the product page's mesh, loaded one at a
  // time, where the bytes matter least and close inspection actually happens. This
  // tier is the one drawing thirty models at once, and a third of its download is
  // the wrong price for a refinement nobody can see at two metres.
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setAttribute('TANGENT', null)
  }
  await doc.transform(prune())

  const triangles = countTriangles(doc)
  const triangleReduction = 1 - triangles / sourceTriangles

  // Now the textures, which are what is LEFT once the geometry collapses — on an
  // organic bake the 50k LOD's geometry came to 433 KB against a normal map of
  // 1,446 KB. The map is doing real work here (it carries the surface detail the
  // triangles no longer do), so it is kept in PNG — lossy artefacts on a normal map
  // are visible — and only bounded in size, never dropped. Format handling
  // otherwise mirrors postProcessGlb, and is best-effort for the same reason: a
  // sharp that cannot encode should cost bytes, not the whole LOD.
  const transforms: any[] = []
  try {
    const sharpMod: any = await importESM('sharp')
    const sharp = sharpMod.default ?? sharpMod
    const limit = Math.floor(cfg.plannerLodNormalMapSize)
    transforms.push(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        quality: 80,
        slots: /occlusion|baseColor|metallicRoughness/,
        ...(limit > 0 ? { resize: [limit, limit] as [number, number] } : {}),
      }),
      textureCompress({
        encoder: sharp,
        targetFormat: 'png',
        slots: /normal/,
        // An upper bound, not a target: gltf-transform never enlarges, so a bake
        // configured with a smaller normalMapRes passes through untouched.
        ...(limit > 0 ? { resize: [limit, limit] as [number, number] } : {}),
      }),
    )
  } catch (err) {
    logger.warn('proxyBake: LOD texture recompress unavailable, keeping source textures', { err })
  }
  transforms.push(draco())
  await doc.transform(...transforms)

  await io.write(outGlb, doc)
  const bytes = (await fsp.stat(outGlb)).size

  // IS THIS WORTH SHIPPING? — measured in BYTES, not triangles.
  //
  // It used to be triangles, and that is how the retune nearly lost its own win:
  // once the collapse is bounded by a geometric error rather than a flat triangle
  // target, a detailed mesh legitimately keeps most of its triangles (16-29% cut on
  // real catalogue parts) while still producing a file 55% smaller, because the
  // TANGENT drop and the re-quantised Draco pass do that much on their own. A
  // triangle gate threw exactly those parts away — the heaviest ones in the table —
  // for failing a test of the wrong quantity. What this tier exists to reduce is
  // what the planner downloads, so that is what has to clear the bar.
  //
  // Triangle reduction is still reported: near zero means weld() found nothing to
  // merge, which is the proxyCreaseAngleDeg-is-0 signature and worth seeing on the
  // report even when the file did shrink.
  const byteReduction = proxyBytes && proxyBytes > 0 ? 1 - bytes / proxyBytes : -1
  const measured = byteReduction >= 0 ? byteReduction : triangleReduction
  if (measured < cfg.plannerLodMinReduction) {
    await fsp.rm(outGlb, { force: true })
    return {
      triangles,
      sourceTriangles,
      bytes: 0,
      skipped: true,
      triangleReduction,
      byteReduction,
      note:
        (byteReduction >= 0
          ? `LOD is ${(bytes / 1024).toFixed(0)} KB against a ${(proxyBytes! / 1024).toFixed(0)} KB proxy ` +
            `(${(byteReduction * 100).toFixed(1)}% smaller`
          : `simplify only reached ${triangles} of ${sourceTriangles} triangles ` +
            `(${(triangleReduction * 100).toFixed(1)}% cut`) +
        `, under the required ${(cfg.plannerLodMinReduction * 100).toFixed(0)}%) — ` +
        `not worth a second file` +
        (triangleReduction < 0.05
          ? `. The collapse removed only ${(triangleReduction * 100).toFixed(1)}% of the ` +
            `triangles, which is what proxyCreaseAngleDeg: 0 looks like — a flat-shaded ` +
            `mesh has no shared edges to collapse`
          : ''),
    }
  }

  log.info('Planner LOD built', {
    sourceTriangles,
    triangles,
    bytes,
    proxyBytes: proxyBytes ?? null,
  })
  return { triangles, sourceTriangles, bytes, skipped: false, triangleReduction, byteReduction }
}
