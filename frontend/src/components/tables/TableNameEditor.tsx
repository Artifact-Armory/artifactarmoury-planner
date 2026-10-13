import React from 'react'
import toast from 'react-hot-toast'
import { Check, Pencil, X } from 'lucide-react'
import { tablesApi } from '../../api/endpoints/tables'

/** Same bounds the backend enforces on create and rename (routes/tables.ts). */
export const TABLE_NAME_MIN = 3
export const TABLE_NAME_MAX = 255

/** Error text for a proposed table name, or null when it's acceptable. */
export function tableNameError(name: string): string | null {
  const n = name.trim()
  if (n.length < TABLE_NAME_MIN) return `Use at least ${TABLE_NAME_MIN} characters`
  if (n.length > TABLE_NAME_MAX) return `Keep it under ${TABLE_NAME_MAX} characters`
  return null
}

interface Props {
  tableId: string
  name: string
  /** Called with the saved name once the server has accepted it. */
  onRenamed: (name: string) => void
  disabled?: boolean
}

/**
 * A table's name with an inline rename: pencil → text field, Enter saves,
 * Esc cancels. Used on the Showcases and My Tables lists — a copied table
 * otherwise keeps its "Copy of …" name forever.
 */
const TableNameEditor: React.FC<Props> = ({ tableId, name, onRenamed, disabled }) => {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(name)
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const start = () => { setDraft(name); setEditing(true) }
  const cancel = () => { setEditing(false); setDraft(name) }

  const error = tableNameError(draft)

  async function save() {
    const next = draft.trim()
    if (error || saving) return
    if (next === name) { setEditing(false); return }
    setSaving(true)
    try {
      const updated = await tablesApi.updateTable(tableId, { name: next })
      onRenamed(updated.name || next)
      setEditing(false)
      toast.success('Table renamed')
    } catch {
      toast.error('Could not rename the table')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-medium text-foreground">{name}</span>
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className="flex-none rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Rename"
          aria-label={`Rename ${name}`}
        >
          <Pencil size={14} />
        </button>
      </span>
    )
  }

  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-1"
      onSubmit={(e) => { e.preventDefault(); save() }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel() } }}
          maxLength={TABLE_NAME_MAX}
          disabled={saving}
          aria-label="Table name"
          aria-invalid={!!error}
          className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={!!error || saving}
          className="flex-none rounded-sm p-1.5 text-primary hover:bg-accent disabled:opacity-40"
          title="Save name (Enter)"
          aria-label="Save name"
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="flex-none rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Cancel (Esc)"
          aria-label="Cancel rename"
        >
          <X size={16} />
        </button>
      </div>
      {error && draft.trim() !== '' && <span className="text-xs text-red-600">{error}</span>}
    </form>
  )
}

export default TableNameEditor
