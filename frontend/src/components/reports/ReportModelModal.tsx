import React, { useState } from 'react'
import { X, Upload, Loader2, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { reportsApi, REPORT_REASONS, ReportReason, ReportAttachmentInput } from '../../api/endpoints/reports'

interface Props {
  modelId: string
  modelName: string
  onClose: () => void
}

const MAX_FILES = 5
const MAX_MB = 15

const ReportModelModal: React.FC<Props> = ({ modelId, modelName, onClose }) => {
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [detail, setDetail] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = REPORT_REASONS.find((r) => r.value === reason)
  const proofRequired = !!selected?.proofRequired

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    const tooBig = incoming.find((f) => f.size > MAX_MB * 1024 * 1024)
    if (tooBig) { setError(`"${tooBig.name}" is over ${MAX_MB}MB`); return }
    setError(null)
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES))
  }

  async function handleSubmit() {
    if (!reason) { setError('Please choose a reason'); return }
    if (proofRequired && files.length === 0) { setError('This report type needs at least one photo or document as proof'); return }
    setError(null)
    setSubmitting(true)
    try {
      let attachments: ReportAttachmentInput[] = []
      if (files.length > 0) {
        setUploading(true)
        attachments = await Promise.all(files.map((f) => reportsApi.uploadProof(f)))
        setUploading(false)
      }
      await reportsApi.submit({ modelId, reason, detail: detail.trim() || undefined, attachments })
      toast.success('Report submitted — thank you. Our team will review it.')
      onClose()
    } catch (err: any) {
      setUploading(false)
      setError(err?.response?.data?.message || err?.message || 'Failed to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Report “{modelName}”</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"><X size={20} /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-sm font-medium text-foreground">Why are you reporting this model?</label>
            <div className="mt-2 space-y-2">
              {REPORT_REASONS.map((r) => (
                <label key={r.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${reason === r.value ? 'border-primary/50 bg-primary/10' : 'border-border hover:border-primary/40'}`}>
                  <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-foreground">{r.label}</span>
                    {r.proofRequired && <span className="ml-2 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">PROOF REQUIRED</span>}
                    {r.hint && <span className="block text-xs text-muted-foreground">{r.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground">Details {proofRequired ? '' : '(optional)'}</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              placeholder="Tell us what's wrong…"
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary/50 focus:outline-hidden focus:ring-1 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground">
              Proof {proofRequired ? <span className="text-red-500">*</span> : '(optional)'}
              <span className="ml-1 text-xs font-normal text-muted-foreground">images or PDF, up to {MAX_FILES} files</span>
            </label>
            <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary">
              <Upload size={16} />
              Add photos / documents
              <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            </label>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-sm bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{f.name}</span>
                    <button onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-red-500"><X size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle size={16} /> {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !reason}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {(submitting || uploading) && <Loader2 size={16} className="animate-spin" />}
            {uploading ? 'Uploading proof…' : submitting ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReportModelModal
