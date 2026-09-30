// backend/src/services/dracoModules.ts
//
// Process-wide Draco encoder/decoder. Every conversion used to call
// `createEncoderModule()` / `createDecoderModule()` itself, and each call
// instantiates a NEW WebAssembly module with its own linear memory. That memory
// grows to fit the mesh it processed and can never shrink, and it is only freed
// when V8 gets round to collecting the wrapper — so a long-lived worker that had
// baked a few dense models sat at ~900 MB after the job finished. One shared
// instance reuses one heap, which stays bounded by the largest mesh seen rather
// than accumulating per job.
//
// Safe to share: gltf-transform builds and frees a fresh Encoder/Decoder object per
// call, and the calls that use these modules are synchronous.

const importESM = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string,
) => Promise<T>

let encoderP: Promise<any> | null = null
let decoderP: Promise<any> | null = null

async function loadDraco(): Promise<any> {
  const mod: any = await importESM('draco3dgltf')
  return mod.default ?? mod
}

export function getDracoEncoder(): Promise<any> {
  if (!encoderP) {
    encoderP = loadDraco()
      .then((d) => d.createEncoderModule())
      .catch((e) => {
        encoderP = null // don't cache a failure forever
        throw e
      })
  }
  return encoderP
}

export function getDracoDecoder(): Promise<any> {
  if (!decoderP) {
    decoderP = loadDraco()
      .then((d) => d.createDecoderModule())
      .catch((e) => {
        decoderP = null
        throw e
      })
  }
  return decoderP
}

/**
 * libvips keeps a 50 MB operation cache plus open-file handles by default, and its
 * thread pool grows glibc malloc arenas that are rarely returned to the OS. For a
 * process that decodes a handful of multi-megapixel textures per job and never
 * repeats one, the cache is pure retention.
 */
export async function tuneSharp(sharp: any): Promise<void> {
  try {
    sharp.cache(false)
    sharp.concurrency(2)
  } catch {
    /* older sharp: best-effort */
  }
}
