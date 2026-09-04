import apiClient from '../client'

export interface PresignResponse {
  uploadUrl: string
  publicUrl: string
  key: string
  contentType: string
  headers: Record<string, string>
  expiresIn: number
}

/** PUT a file straight to R2 using a presigned URL (bytes never touch our API). */
function putToR2(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    // No client-side timeout: a large model (hundreds of MB) can take minutes to
    // upload on a home connection. The presigned URL's own expiry is the only
    // time limit (see backend presign TTL).
    xhr.timeout = 0
    // Must match exactly the Content-Type that was signed, or R2 returns 403.
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error('Upload network error (check R2 CORS allows PUT from this origin)'))
    xhr.send(file)
  })
}

// Files at/above this size are uploaded in chunks (multipart) so a dropped
// packet only re-sends one chunk, not the whole file. Chunk size must be >= 5MB
// (R2/S3 minimum part size, except the final part).
const MULTIPART_THRESHOLD = 64 * 1024 * 1024 // 64 MB
const PART_SIZE = 16 * 1024 * 1024 // 16 MB per chunk
const PART_RETRIES = 3
// Chunks in flight at once. Parts used to go strictly one at a time — on a
// fast connection that leaves most of the available bandwidth idle between
// chunks, since only one small HTTP transfer is ever active (a real,
// measured contributor to a 10-model upload taking over an hour on a
// connection independently confirmed to be fine — 2026-09-04). 4 is a
// conservative, standard choice for parallel multipart uploads: enough to
// actually use real bandwidth without saturating the browser's per-host
// connection limit (6 in most browsers) or the R2 endpoint.
const PART_CONCURRENCY = 4

/**
 * PUT one chunk to its presigned part URL and resolve with the part's ETag
 * (read from the response header — R2 CORS must expose `ETag`). Reports bytes
 * uploaded for this part via onPartProgress so overall progress can be summed.
 */
function putPartToR2(
  url: string,
  chunk: Blob,
  onPartProgress?: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.timeout = 0
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onPartProgress) onPartProgress(e.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')
        if (!etag) {
          reject(new Error('R2 did not return an ETag for this part (check R2 CORS exposes the ETag header)'))
        } else {
          resolve(etag)
        }
      } else {
        reject(new Error(`Part upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Part upload network error (check R2 CORS allows PUT from this origin)'))
    xhr.send(chunk)
  })
}

/** Chunked, resumable-per-part upload for large files. */
async function uploadMultipart(
  file: File,
  prefix: string,
  onProgress?: (pct: number) => void,
): Promise<{ key: string; publicUrl: string }> {
  const partCount = Math.ceil(file.size / PART_SIZE)

  // 1. Start the upload and get a presigned URL for every part.
  const { data } = await apiClient.post(
    '/api/uploads/multipart/create',
    { filename: file.name, prefix, partCount, fileSize: file.size },
    { timeout: 60_000 },
  )
  const { key, uploadId, parts } = data as {
    key: string
    uploadId: string
    parts: Array<{ partNumber: number; url: string }>
  }

  try {
    // 2. Upload chunks PART_CONCURRENCY at a time (retry a few times per
    //    chunk), tracking total progress. A small pool of "workers" pulls
    //    from a shared queue rather than firing all parts at once, so a
    //    1000-part file doesn't open 1000 connections simultaneously.
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    const loadedPerPart = new Array<number>(partCount).fill(0)
    const emitProgress = () => {
      if (!onProgress) return
      const loaded = loadedPerPart.reduce((a, b) => a + b, 0)
      onProgress(Math.min(100, Math.round((loaded / file.size) * 100)))
    }

    const etagByPartNumber = new Map<number, string>()
    async function uploadOnePart(part: { partNumber: number; url: string }): Promise<void> {
      const start = (part.partNumber - 1) * PART_SIZE
      const chunk = file.slice(start, Math.min(start + PART_SIZE, file.size))

      let etag = ''
      let lastErr: unknown
      for (let attempt = 0; attempt < PART_RETRIES; attempt++) {
        try {
          etag = await putPartToR2(part.url, chunk, (loaded) => {
            loadedPerPart[part.partNumber - 1] = loaded
            emitProgress()
          })
          break
        } catch (err) {
          lastErr = err
          loadedPerPart[part.partNumber - 1] = 0
        }
      }
      if (!etag) throw lastErr ?? new Error(`Failed to upload part ${part.partNumber}`)

      loadedPerPart[part.partNumber - 1] = chunk.size
      emitProgress()
      etagByPartNumber.set(part.partNumber, etag)
    }

    // If any part permanently fails (all retries exhausted), Promise.all
    // rejects as soon as that happens — the other workers' in-flight PUTs
    // keep running in the background since XHR isn't wired for cancellation
    // here, but their results are simply never read; the catch block below
    // aborts the whole multipart upload regardless.
    let nextIndex = 0
    async function worker(): Promise<void> {
      while (nextIndex < sortedParts.length) {
        const part = sortedParts[nextIndex++]
        await uploadOnePart(part)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, sortedParts.length) }, () => worker()),
    )

    // CompleteMultipartUpload requires parts listed in ascending part-number
    // order — sortedParts is already in that order, so mapping straight
    // through (rather than the completion order, which is unordered now
    // that parts upload concurrently) keeps that guarantee.
    const completed = sortedParts.map((p) => ({ partNumber: p.partNumber, etag: etagByPartNumber.get(p.partNumber)! }))

    // 3. Stitch the parts together into the final object.
    const res = await apiClient.post(
      '/api/uploads/multipart/complete',
      { key, uploadId, parts: completed },
      { timeout: 60_000 },
    )
    return { key: res.data.key, publicUrl: res.data.publicUrl }
  } catch (err) {
    // Best-effort cleanup so failed uploads don't linger as staged parts.
    apiClient
      .post('/api/uploads/multipart/abort', { key, uploadId }, { timeout: 30_000 })
      .catch(() => {})
    throw err
  }
}

export const uploadsApi = {
  /** Ask the API for a short-lived presigned PUT URL under `prefix`. */
  presign: async (filename: string, prefix = 'raw'): Promise<PresignResponse> => {
    const res = await apiClient.post('/api/uploads/presign', { filename, prefix }, { timeout: 60_000 })
    return res.data
  },

  /**
   * Upload a file directly to R2. Small files go as a single PUT; large files
   * (>= 64MB) are uploaded in chunks so one dropped packet doesn't fail the whole
   * transfer. Returns the stored object key.
   */
  uploadDirect: async (
    file: File,
    prefix = 'raw',
    onProgress?: (pct: number) => void,
  ): Promise<{ key: string; publicUrl: string }> => {
    if (file.size >= MULTIPART_THRESHOLD) {
      return uploadMultipart(file, prefix, onProgress)
    }
    const presigned = await uploadsApi.presign(file.name, prefix)
    await putToR2(presigned.uploadUrl, file, presigned.contentType, onProgress)
    return { key: presigned.key, publicUrl: presigned.publicUrl }
  },
}
