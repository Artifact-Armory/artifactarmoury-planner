import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Image as ImageIcon, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  adminApplicationsApi,
  ApplicationStatus,
} from '../../api/endpoints/artistApplications'
import Spinner from '../../components/ui/Spinner'

const FILTERS: Array<{ key: ApplicationStatus; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

const STATUS_STYLE: Record<ApplicationStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

/** Review queue for in-app artist applications (migration 068). */
const AdminApplicationsReview: React.FC = () => {
  const [filter, setFilter] = useState<ApplicationStatus>('pending')
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-applications', filter],
    queryFn: () => adminApplicationsApi.list(filter),
  })

  return (
    <div>
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground border border-border hover:bg-accent'}`}
          >
            {f.label}
            {f.key === 'pending' && data && data.pendingCount > 0 && (
              <span className="ml-2 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{data.pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24"><Spinner size="lg" /></div>
      ) : (data?.applications.length ?? 0) === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
          No {filter} applications.
        </div>
      ) : (
        <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
          {data!.applications.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpenId(a.id)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{a.artist_name}</p>
                  <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[a.status]}`}>
                    {a.status}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {a.applicant_name} &lt;{a.applicant_email}&gt;
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                {new Date(a.created_at).toLocaleDateString('en-GB')}
                <span className="flex items-center gap-0.5"><ImageIcon size={11} />{a.image_count}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {openId && <DetailPanel applicationId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

const DetailPanel: React.FC<{ applicationId: string; onClose: () => void }> = ({ applicationId, onClose }) => {
  const qc = useQueryClient()
  const [approveNote, setApproveNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [lightbox, setLightbox] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-application', applicationId],
    queryFn: () => adminApplicationsApi.get(applicationId),
  })

  const decided = () => {
    qc.invalidateQueries({ queryKey: ['admin-applications'] })
    qc.invalidateQueries({ queryKey: ['admin-application', applicationId] })
  }

  const approve = useMutation({
    mutationFn: () => adminApplicationsApi.approve(applicationId, approveNote.trim() || undefined),
    onSuccess: () => {
      toast.success('Approved. Invite code emailed to the applicant.')
      decided()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not approve'),
  })

  const reject = useMutation({
    mutationFn: () => adminApplicationsApi.reject(applicationId, rejectReason.trim()),
    onSuccess: () => {
      toast.success('Rejected. The applicant has been emailed the reason.')
      decided()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not reject'),
  })

  const app = data?.application
  const busy = approve.isPending || reject.isPending

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Application</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"><X size={20} /></button>
        </div>

        {isLoading || !data || !app ? (
          <div className="flex justify-center py-24"><Spinner size="lg" /></div>
        ) : (
          <div className="space-y-6 px-6 py-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold text-foreground">{app.artist_name}</h3>
                <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[app.status]}`}>{app.status}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {app.applicant_name} &lt;{app.applicant_email}&gt; · applied {new Date(app.created_at).toLocaleString('en-GB')}
              </p>
            </div>

            <Field label="About them">{app.about}</Field>
            <Field label="What they make">{app.what_you_make}</Field>
            {app.sells_elsewhere && <Field label="Sells elsewhere">{app.sells_elsewhere}</Field>}

            {(app.website_url || app.social_links.length > 0) && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Links</p>
                <ul className="mt-1 space-y-1">
                  {[app.website_url, ...app.social_links].filter(Boolean).map((url) => (
                    <li key={url as string}>
                      <a href={url as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-sm text-primary hover:underline">
                        {url} <ExternalLink size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Portfolio ({data.images.length})</p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {data.images.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => setLightbox(img.url)}
                    className="aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                  >
                    <img src={img.url} alt={img.file_name ?? ''} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            {app.status !== 'pending' ? (
              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="font-medium text-foreground">
                  {app.status === 'approved' ? 'Approved' : 'Rejected'}
                  {app.reviewed_by_name && <> by {app.reviewed_by_name}</>}
                  {app.reviewed_at && <> on {new Date(app.reviewed_at).toLocaleString('en-GB')}</>}
                </p>
                {app.decision_reason && (
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{app.decision_reason}</p>
                )}
                {app.invite_code && (
                  <p className="mt-2 text-xs text-muted-foreground">Invite code sent: <span className="font-mono">{app.invite_code}</span></p>
                )}
              </div>
            ) : app.user_role === 'artist' ? (
              <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                This account is already an artist, so there is nothing to approve.
              </div>
            ) : (
              <div className="space-y-5 border-t border-border pt-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approve</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Emails them a single-use invite code (valid for 30 days). Add an optional note to go with it.
                  </p>
                  <textarea
                    value={approveNote}
                    onChange={(e) => setApproveNote(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Optional: what stood out, anything to get started…"
                    className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Approve ${app.artist_name} and email them an invite code?`)) approve.mutate()
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {approve.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Approve and send code
                  </button>
                </div>

                <div className="border-t border-border pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reject</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The reason is emailed to the applicant, so be specific and kind. Required.
                  </p>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="For example: we'd like to see more consistent render quality and at least one fully assembled piece."
                    className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                  <button
                    disabled={busy || rejectReason.trim().length < 10}
                    onClick={() => {
                      if (window.confirm(`Reject ${app.artist_name} and email them your reason?`)) reject.mutate()
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {reject.isPending ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                    Reject and send reason
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={(e) => { e.stopPropagation(); setLightbox(null) }}>
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  )
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{children}</p>
  </div>
)

export default AdminApplicationsReview
