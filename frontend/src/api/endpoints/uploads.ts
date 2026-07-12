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

export const uploadsApi = {
  /** Ask the API for a short-lived presigned PUT URL under `prefix`. */
  presign: async (filename: string, prefix = 'raw'): Promise<PresignResponse> => {
    const res = await apiClient.post('/api/uploads/presign', { filename, prefix }, { timeout: 60_000 })
    return res.data
  },

  /** Presign + upload a file directly to R2. Returns the stored object key. */
  uploadDirect: async (
    file: File,
    prefix = 'raw',
    onProgress?: (pct: number) => void,
  ): Promise<{ key: string; publicUrl: string }> => {
    const presigned = await uploadsApi.presign(file.name, prefix)
    await putToR2(presigned.uploadUrl, file, presigned.contentType, onProgress)
    return { key: presigned.key, publicUrl: presigned.publicUrl }
  },
}
