import React from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen, Loader2, X } from 'lucide-react'
import { filesApi, LibraryFile, makeLibraryFile } from '../../api/endpoints/files'

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`

/**
 * "Pick from my files" button + dialog. Calls onPick with File objects that
 * stand for library files (see makeLibraryFile); the listing form handles them
 * like files chosen from the computer.
 */
export default function LibraryPicker({
  onPick,
  disabled,
  multiple = true,
  label = 'Pick from my files…',
}: {
  onPick: (files: File[]) => void
  disabled?: boolean
  multiple?: boolean
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [files, setFiles] = React.useState<LibraryFile[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [folder, setFolder] = React.useState<string>('')
  const [selected, setSelected] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!open) return
    setSelected([])
    setError(null)
    filesApi
      .list()
      .then((r) => setFiles(r.files))
      .catch((err) => setError(err?.response?.data?.message || 'Could not load your files'))
  }, [open])

  const folders = React.useMemo(
    () => Array.from(new Set((files ?? []).map((f) => f.folder ?? ''))).sort(),
    [files],
  )
  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (files ?? []).filter(
      (f) =>
        (!folder || (f.folder ?? '') === folder || (f.folder ?? '').startsWith(folder + '/')) &&
        (!q || f.fileName.toLowerCase().includes(q) || (f.folder ?? '').toLowerCase().includes(q)),
    )
  }, [files, query, folder])

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : multiple ? [...s, id] : [id]))
  }

  function add() {
    // Keep the order the files are listed in (folder, then name).
    const picked = (files ?? []).filter((f) => selected.includes(f.id)).map(makeLibraryFile)
    if (picked.length) onPick(picked)
    setOpen(false)
  }

  const allShownSelected = shown.length > 0 && shown.every((f) => selected.includes(f.id))

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-border px-4 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
      >
        <FolderOpen size={16} />
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-md border bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="font-semibold">Pick from my files</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-2 border-b p-4 sm:flex-row">
              <input
                className="flex-1 rounded-sm border px-3 py-2 text-sm"
                placeholder="Search file names"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {folders.length > 1 && (
                <select className="rounded-sm border px-3 py-2 text-sm" value={folder} onChange={(e) => setFolder(e.target.value)}>
                  <option value="">All folders</option>
                  {folders.map((f) => (
                    <option key={f} value={f}>{f || '(no folder)'}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {error && <p className="p-2 text-sm text-destructive">{error}</p>}
              {!files && !error && (
                <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </p>
              )}
              {files && files.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  Your library is empty. Upload files on{' '}
                  <Link to="/artist/files" className="text-primary underline" target="_blank">My files</Link> first.
                </p>
              )}
              {files && files.length > 0 && shown.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">No files match.</p>
              )}
              {multiple && shown.length > 1 && (
                <label className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={() =>
                      setSelected((s) =>
                        allShownSelected
                          ? s.filter((id) => !shown.some((f) => f.id === id))
                          : Array.from(new Set([...s, ...shown.map((f) => f.id)])),
                      )
                    }
                  />
                  Select all {shown.length} shown
                </label>
              )}
              <ul>
                {shown.map((f) => (
                  <li key={f.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                      <input
                        type={multiple ? 'checkbox' : 'radio'}
                        checked={selected.includes(f.id)}
                        onChange={() => toggle(f.id)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {f.folder && <span className="text-muted-foreground">{f.folder}/</span>}
                        {f.fileName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {mb(f.size)}
                        {f.useCount > 0 && ` · used ${f.useCount}×`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 border-t p-4">
              <button type="button" className="rounded-sm border px-4 py-2 text-sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={add}
                className="rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                Add {selected.length || ''} file{selected.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
