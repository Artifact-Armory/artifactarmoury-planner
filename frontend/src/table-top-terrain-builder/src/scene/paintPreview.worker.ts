// Bakes ground-paint overlay maps off the main thread (OffscreenCanvas), so a
// paint stroke never blocks pointer input or rendering. The main thread decodes
// the material images once and transfers them in with 'init'; every 'paint' job
// returns three ImageBitmaps (colour, normal, roughness). See ThreeStage.tsx.
import { bakePaintOverlayMaps, configurePaintWorker, type PaintOverlayCanvases, type PaintSource } from '../core/tableMaterials'
import type { PaintMap } from '../core/paintmap'

let maps: PaintOverlayCanvases | undefined
self.onmessage = (event: MessageEvent<
  { kind: 'init'; sources: PaintSource[] } |
  { kind: 'paint'; id: number; paint: PaintMap; table: { width: number; height: number }; size: number }
>) => {
  const job = event.data
  if (job.kind === 'init') { configurePaintWorker(job.sources); return }
  try {
    const start = performance.now()
    maps = bakePaintOverlayMaps(job.paint, job.table, maps, job.size)
    const bitmaps = {
      albedo: (maps.albedo as unknown as OffscreenCanvas).transferToImageBitmap(),
      normal: (maps.normal as unknown as OffscreenCanvas).transferToImageBitmap(),
      roughness: (maps.roughness as unknown as OffscreenCanvas).transferToImageBitmap(),
    }
    self.postMessage({ id: job.id, bitmaps, bakeMs: performance.now() - start }, { transfer: Object.values(bitmaps) })
  } catch (error) {
    self.postMessage({ id: job.id, error: String(error) })
  }
}
