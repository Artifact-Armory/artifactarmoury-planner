// src/ui/tableSnapshot.ts
//
// The saved table's thumbnail: an HD render of the table itself, taken from the
// live scene (see ThreeStage captureTable) and uploaded after each save. Cards on
// My Tables / the public gallery / artist showcases show it instead of a collage
// of the placed models' product photos.

import { useAppStore } from '@state/store'
import { tablesApi } from '@/api/endpoints/tables'

export const SNAPSHOT_WIDTH = 1920
export const SNAPSHOT_HEIGHT = 1080

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Render the current table at 1920x1080. WebP where the browser can encode it, else JPEG. */
export async function captureTableImage(): Promise<Blob | null> {
  const stage = useAppStore.getState().stageApi
  if (!stage) return null
  const canvas = await stage.captureTable(SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT)
  if (!canvas) return null
  // Safari can't encode WebP and silently hands back a PNG instead.
  const webp = await toBlob(canvas, 'image/webp', 0.9)
  if (webp && webp.type === 'image/webp') return webp
  return toBlob(canvas, 'image/jpeg', 0.9)
}

/**
 * Upload a captured image as the table's thumbnail. Never throws: a missing
 * thumbnail only means the card falls back to model photos, so it must not turn
 * a successful save into an error.
 */
export async function uploadTableSnapshot(tableId: string, image: Promise<Blob | null>): Promise<void> {
  try {
    const blob = await image
    if (blob) await tablesApi.uploadThumbnail(tableId, blob)
  } catch (err) {
    console.warn('Table thumbnail was not saved', err)
  }
}
