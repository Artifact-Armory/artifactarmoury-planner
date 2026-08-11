import React, { useState } from 'react'
import { X, AlertTriangle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { messagesApi } from '../../api/endpoints/messages'

interface Props {
  conversationId: string
  otherName: string
  onClose: () => void
}

const REASONS: { value: string; label: string; hint?: string }[] = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'threats', label: 'Threats or violence' },
  { value: 'hate_speech', label: 'Hate speech or slurs' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'scam', label: 'Scam or fraud', hint: 'Trying to take payment or files off-platform, etc.' },
  { value: 'other', label: 'Something else' },
]

// Reporting captures the whole conversation into a report for admins — no need to
// copy anything manually.
const ReportConversationModal: React.FC<Props> = ({ conversationId, otherName, onClose }) => {
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!reason) { setError('Please choose a reason'); return }
    setError(null)
    setSubmitting(true)
    try {
      await messagesApi.report(conversationId, { reason, detail: detail.trim() || undefined })
      toast.success('Report submitted — our team will review this conversation.')
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Report conversation with {otherName}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            A copy of this conversation is included with your report so our team can review it.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700">Why are you reporting this conversation?</label>
            <div className="mt-2 space-y-2">
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                    reason === r.value ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-gray-900">{r.label}</span>
                    {r.hint && <span className="block text-xs text-gray-500">{r.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Anything else? (optional)</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              placeholder="Add any context for our team…"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle size={16} /> {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !reason}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReportConversationModal
