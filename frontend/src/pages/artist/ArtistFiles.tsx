import React from 'react'
import { AlertCircle, FolderUp, Loader2, Trash2, Upload } from 'lucide-react'
import { filesApi, LibraryFile } from '../../api/endpoints/files'
import { uploadsApi } from '../../api/endpoints/uploads'

const MESH_RE = /\.(stl|obj|3mf)$/i
const CONCURRENCY = 3
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`
const gb = (bytes: number) => `${(bytes / 1_073_741_824).toFixed(1)} GB`

type QueueItem = { file: File; folder: string | null; status: 'waiting' | 'uploading' | 'done' | 'failed'; pct: number; error?: string }

function errMessage(err: unknown, fallback: string): string {
  const anyErr = err as any
  return anyErr?.response?.data?.message || anyErr?.message || fallback
}

/** Folder a file came from when a whole folder was chosen ("Tanks/Shermans"), else null. */
function folderOf(file: File): string | null {
  const rel = (file as any).webkitRelativePath as string | undefined
  if (!rel || !rel.includes('/')) return null
  return rel.split('/').slice(0, -1).join('/')
}

/**
 * My files: the artist's file library. Upload lots of model files (or whole
 * folders) once, then use "Pick from my files" when creating a listing.
 */
export default function ArtistFiles() {
  const [files, setFiles] = React.useState<LibraryFile[] | null>(null)
  const [limits, setLimits] = React.useState<{ totalBytes: number; maxFiles: number; maxBytes: number } | null>(null)
  const [queue, setQueue] = React.useState<QueueItem[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<string[]>([])
  const [deleting, setDeleting] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const folderInput = React.useRef<HTMLInputElement>(null)

  const load = React.useCallback(async () => {
    try {
      const r = await filesApi.list()
      setFiles(r.files)
      setLimits({ totalBytes: r.totalBytes, maxFiles: r.maxFiles, maxBytes: r.maxBytes })
    } catch (err) {
      setError(errMessage(err, 'Could not load your files'))
    }
  }, [])
  React.useEffect(() => { load() }, [load])

  // Warn before leaving the page mid-upload.
  React.useEffect(() => {
    if (!uploading) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [uploading])

  async function startUpload(chosen: File[]) {
    const meshes = chosen.filter((f) => MESH_RE.test(f.name))
    const skipped = chosen.length - meshes.length
    setError(skipped ? `${skipped} file${skipped === 1 ? ' was' : 's were'} skipped (only .stl, .obj and .3mf files go in your library).` : null)
    if (!meshes.length) return

    const items: QueueItem[] = meshes.map((file) => ({ file, folder: folderOf(file), status: 'waiting', pct: 0 }))
    setQueue(items)
    setUploading(true)
    const update = (i: number, patch: Partial<QueueItem>) =>
      setQueue((q) => q.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))

    let next = 0
    async function worker() {
      while (next < items.length) {
        const i = next++
        const it = items[i]
        update(i, { status: 'uploading' })
        try {
          const { key } = await uploadsApi.uploadDirect(it.file, 'library', (pct) => update(i, { pct }))
          const saved = await filesApi.register(key, it.file.name, it.folder)
          update(i, { status: 'done', pct: 100 })
          setFiles((list) => (list ? [...list, saved] : [saved]))
        } catch (err) {
          update(i, { status: 'failed', error: errMessage(err, 'Upload failed') })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
    setUploading(false)
    load()
  }

  async function deleteSelected() {
    if (!selected.length) return
    if (!window.confirm(`Delete ${selected.length} file${selected.length === 1 ? '' : 's'} from your library? Listings that already use them are not affected.`)) return
    setDeleting(true)
    setError(null)
    try {
      await filesApi.remove(selected)
      setSelected([])
      await load()
    } catch (err) {
      setError(errMessage(err, 'Could not delete those files'))
    } finally {
      setDeleting(false)
    }
  }

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (files ?? [])
      .filter((f) => !q || f.fileName.toLowerCase().includes(q) || (f.folder ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.fileName.localeCompare(b.fileName))
  }, [files, query])

  const byFolder = React.useMemo(() => {
    const map = new Map<string, LibraryFile[]>()
    for (const f of shown) {
      const k = f.folder ?? ''
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(f)
    }
    return Array.from(map.entries())
  }, [shown])

  const done = queue.filter((q) => q.status === 'done').length
  const failed = queue.filter((q) => q.status === 'failed')
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="px-4 py-10 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold">My files</h1>
      <p className="text-muted-foreground mt-1">
        Upload all your model files here in one go. When you create a listing, use <b>Pick from my files</b> instead of
        uploading again. Files here are private and are not for sale until you add them to a listing.
      </p>

      <div className="mt-6 flex flex-col sm:flex-row gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".stl,.obj,.3mf"
          className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; startUpload(f) }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          {...({ webkitdirectory: '', directory: '' } as any)}
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; startUpload(f) }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm bg-primary text-primary-foreground disabled:opacity-60"
        >
          <Upload className="h-4 w-4" /> Upload files
        </button>
        <button
          onClick={() => folderInput.current?.click()}
          disabled={uploading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm border disabled:opacity-60"
        >
          <FolderUp className="h-4 w-4" /> Upload a folder
        </button>
        {limits && (
          <span className="sm:ml-auto self-center text-sm text-muted-foreground">
            {(files ?? []).length} of {limits.maxFiles} files · {gb(limits.totalBytes)} of {gb(limits.maxBytes)}
          </span>
        )}
      </div>

      {queue.length > 0 && (
        <div className="mt-4 border rounded-sm p-3 text-sm">
          <p className="font-medium flex items-center gap-2">
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            {uploading ? `Uploading… ${done} of ${queue.length} done` : `Uploaded ${done} of ${queue.length}`}
            {failed.length > 0 && <span className="text-destructive">, {failed.length} failed</span>}
          </p>
          {uploading && <p className="text-xs text-muted-foreground mt-1">Keep this page open until it finishes.</p>}
          <ul className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
            {queue.filter((q) => q.status !== 'done').map((q, i) => (
              <li key={i} className={q.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                {q.folder ? `${q.folder}/` : ''}{q.file.name}:{' '}
                {q.status === 'failed' ? q.error : q.status === 'uploading' ? `${Math.round(q.pct)}%` : 'waiting'}
              </li>
            ))}
          </ul>
          {!uploading && failed.length > 0 && (
            <button className="mt-2 px-3 py-1.5 rounded-sm border text-sm" onClick={() => startUpload(failed.map((f) => f.file))}>
              Retry failed files
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          className="flex-1 rounded-sm border px-3 py-2 text-sm"
          placeholder="Search file or folder names"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={deleteSelected}
          disabled={!selected.length || deleting}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-sm border text-sm text-red-600 disabled:opacity-50"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Delete {selected.length || ''} selected
        </button>
      </div>

      {!files && !error && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
      {files && files.length === 0 && queue.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">No files yet. Upload some to get started.</p>
      )}

      <div className="mt-4 space-y-4">
        {byFolder.map(([folder, list]) => {
          const allSel = list.every((f) => selected.includes(f.id))
          return (
            <div key={folder} className="border rounded-sm">
              <label className="flex items-center gap-2 bg-muted/40 px-3 py-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={allSel}
                  onChange={() =>
                    setSelected((s) =>
                      allSel ? s.filter((id) => !list.some((f) => f.id === id)) : Array.from(new Set([...s, ...list.map((f) => f.id)])),
                    )
                  }
                />
                {folder || 'No folder'} <span className="text-muted-foreground font-normal">({list.length})</span>
              </label>
              <ul>
                {list.map((f) => (
                  <li key={f.id} className="border-t">
                    <label className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggle(f.id)} />
                      <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {mb(f.size)}{f.useCount > 0 ? ` · used ${f.useCount}×` : ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
