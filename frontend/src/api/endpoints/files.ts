// src/api/endpoints/files.ts
// Artist file library ("My files"): upload many model files once, then pick
// them when creating a listing instead of uploading again.
import apiClient from '../client'

export interface LibraryFile {
  id: string
  fileName: string
  folder: string | null
  size: number
  useCount: number
  lastUsedAt?: string | null
  createdAt: string
}

export interface LibraryListing {
  files: LibraryFile[]
  totalBytes: number
  maxFiles: number
  maxBytes: number
}

export const filesApi = {
  async list(): Promise<LibraryListing> {
    const res = await apiClient.get('/api/files')
    return res.data
  },
  /** Register a file already uploaded to R2 under the `library` prefix. */
  async register(key: string, fileName: string, folder: string | null): Promise<LibraryFile> {
    const res = await apiClient.post('/api/files', { key, fileName, folder })
    return res.data.file
  },
  async remove(ids: string[]): Promise<number> {
    const res = await apiClient.post('/api/files/delete', { ids })
    return res.data.deleted
  },
  /** Copy a library file to a fresh upload key for a listing. */
  async use(id: string): Promise<{ key: string; fileName: string }> {
    const res = await apiClient.post(`/api/files/${id}/use`, {}, { timeout: 120_000 })
    return res.data
  },
}

// A picked library file travels through the listing forms as a normal File
// (so names, size checks and the file list just work) with no bytes in it and
// the library id attached. uploadsApi.uploadDirect sees the id and asks the
// server to copy the stored file instead of uploading anything.
const LIBRARY_ID = '__aaLibraryFileId'

export function makeLibraryFile(f: LibraryFile): File {
  const file = new File([], f.fileName)
  Object.defineProperty(file, 'size', { value: f.size })
  Object.defineProperty(file, LIBRARY_ID, { value: f.id })
  return file
}

export function libraryFileId(file: File): string | null {
  return ((file as any)[LIBRARY_ID] as string | undefined) ?? null
}
