// Shown when an artist places another artist's model on their showcase. Placing
// it is gated behind sending the owner a collaboration request (dispatched when
// the table saves). Confirm places + saves; cancel drops the placement.
import React from 'react'
import { Users, X } from 'lucide-react'

interface Props {
  artistName: string
  onConfirm: () => void
  onCancel: () => void
}

const CollabRequestModal: React.FC<Props> = ({ artistName, onConfirm, onCancel }) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <Users size={18} />
            </span>
            <h2 className="text-base font-semibold text-gray-900">Collaborate with {artistName}?</h2>
          </div>
          <button onClick={onCancel} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Cancel">
            <X size={18} />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          This model belongs to <strong>{artistName}</strong>. To feature it in your showcase we'll
          send them a collaboration request when you save. You can keep building straight away, but
          you <strong>can't publish</strong> the showcase until they accept.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Send request &amp; place
          </button>
        </div>
      </div>
    </div>
  )
}

export default CollabRequestModal
