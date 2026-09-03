import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert, Send, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { reportsApi, REPORT_REASONS, MyReport } from '../../api/endpoints/reports'
import { notificationsApi } from '../../api/endpoints/notifications'
import { assetUrl } from '../../api/transformers'
import Spinner from '../../components/ui/Spinner'

const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]))

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-amber-100 text-amber-700' },
  under_review: { label: 'Under review', cls: 'bg-blue-100 text-blue-700' },
  awaiting_info: { label: 'Awaiting info', cls: 'bg-purple-100 text-purple-700' },
  resolved_upheld: { label: 'Resolved — upheld', cls: 'bg-red-100 text-red-700' },
  resolved_dismissed: { label: 'Resolved — dismissed', cls: 'bg-green-100 text-green-700' },
}

// A report stays "current" until admin reaches a final decision. `awaiting_info` is a
// further request from admin (not a resolution) so it stays put here, not in Previous —
// it only moves once the admin actually resolves it (dismiss / upheld action).
const RESOLVED_STATUSES = new Set(['resolved_upheld', 'resolved_dismissed'])

type Tab = 'current' | 'previous'

const ArtistReports: React.FC = () => {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('current')
  const { data, isLoading } = useQuery({ queryKey: ['artist-reports'], queryFn: () => reportsApi.getAgainstMe() })

  // Visiting this page is "reviewing" the new decisions/replies — clear the nav badge.
  useEffect(() => {
    notificationsApi.markReportsRead().then(() => {
      qc.invalidateQueries({ queryKey: ['artist-reports-unread'] })
    }).catch(() => {})
  }, [qc])

  if (isLoading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>
  const reports = data ?? []
  const current = reports.filter((r) => !RESOLVED_STATUSES.has(r.status))
  const previous = reports.filter((r) => RESOLVED_STATUSES.has(r.status))
  const shown = tab === 'current' ? current : previous

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Reports filed against your models and their outcome. You'll be notified when a decision is made, and you can reply if you have something to add.
      </p>

      <div className="mt-6 flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('current')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'current' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Current reports{current.length > 0 ? ` (${current.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setTab('previous')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'previous' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Previous reports{previous.length > 0 ? ` (${previous.length})` : ''}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <ShieldAlert className="mx-auto text-muted-foreground" size={40} />
          {tab === 'current' ? (
            <>
              <p className="mt-3 font-medium text-foreground">No open reports against your models</p>
              <p className="text-sm text-muted-foreground">Keep it up — nothing needs your attention.</p>
            </>
          ) : (
            <>
              <p className="mt-3 font-medium text-foreground">No resolved reports yet</p>
              <p className="text-sm text-muted-foreground">Reports move here once an admin reaches a final decision.</p>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {shown.map((r) => <ReportCard key={r.id} report={r} />)}
        </ul>
      )}
    </div>
  )
}

const ReportCard: React.FC<{ report: MyReport }> = ({ report: r }) => {
  const qc = useQueryClient()
  const [message, setMessage] = useState('')
  const meta = STATUS_META[r.status] ?? { label: r.status, cls: 'bg-muted text-muted-foreground' }

  const reply = useMutation({
    mutationFn: (msg: string) => reportsApi.reply(r.id, msg),
    onSuccess: () => {
      setMessage('')
      qc.invalidateQueries({ queryKey: ['artist-reports'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to send reply'),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    reply.mutate(message)
  }

  return (
    <li className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {r.thumbnail_path && <img src={assetUrl(r.thumbnail_path)} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">#{r.report_number}</span>
            <span className="font-medium text-foreground">{r.model_name ?? 'Model'}</span>
            <span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{REASON_LABEL[r.reason] ?? r.reason}</span>
            <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Reported {new Date(r.created_at).toLocaleDateString()}</p>
          {r.resolution_summary && (
            <div className="mt-3 rounded-lg bg-muted p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Moderation decision</p>
              <p className="mt-1 text-sm text-foreground">{r.resolution_summary}</p>
            </div>
          )}

          {r.replies.length > 0 && (
            <div className="mt-3 space-y-2">
              {r.replies.map((reply) => (
                <div
                  key={reply.id}
                  className={`rounded-lg p-3 text-sm ${reply.is_admin ? 'bg-primary/5 border border-primary/20' : 'bg-muted'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {reply.is_admin ? (reply.sender_name || 'Support team') : 'You'}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(reply.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-foreground">{reply.body}</p>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="mt-3 space-y-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Reply about this report…"
              rows={2}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={reply.isPending || !message.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {reply.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Send reply
            </button>
          </form>
        </div>
      </div>
    </li>
  )
}

export default ArtistReports
