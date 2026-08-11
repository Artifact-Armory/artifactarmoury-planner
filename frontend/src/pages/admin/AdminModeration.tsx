import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Paperclip, ExternalLink, ShieldAlert, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminModerationApi, ModerationAction, ReportTile } from '../../api/endpoints/adminModeration'
import { assetUrl } from '../../api/transformers'
import Spinner from '../../components/ui/Spinner'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-amber-100 text-amber-700' },
  under_review: { label: 'Under review', cls: 'bg-blue-100 text-blue-700' },
  awaiting_info: { label: 'Awaiting info', cls: 'bg-purple-100 text-purple-700' },
  resolved_upheld: { label: 'Upheld', cls: 'bg-red-100 text-red-700' },
  resolved_dismissed: { label: 'Dismissed', cls: 'bg-green-100 text-green-700' },
}

const FILTERS = [
  { key: '', label: 'Open queue' },
  { key: 'resolved_upheld', label: 'Upheld' },
  { key: 'resolved_dismissed', label: 'Dismissed' },
]

// Decision buttons shown in the detail panel.
const ACTIONS: Array<{ action: ModerationAction; label: string; cls: string; confirm?: string }> = [
  { action: 'dismiss', label: 'Dismiss report', cls: 'border-gray-300 text-gray-700 hover:bg-gray-50' },
  { action: 'request_info', label: 'Request more info', cls: 'border-gray-300 text-gray-700 hover:bg-gray-50' },
  { action: 'warn_artist', label: 'Warn artist', cls: 'border-amber-300 text-amber-700 hover:bg-amber-50' },
  { action: 'unpublish_model', label: 'Unpublish model', cls: 'border-amber-300 text-amber-700 hover:bg-amber-50', confirm: 'Unpublish this model (back to draft)?' },
  { action: 'flag_model', label: 'Flag model', cls: 'border-amber-300 text-amber-700 hover:bg-amber-50' },
  { action: 'remove_model', label: 'Remove model', cls: 'border-red-300 text-red-700 hover:bg-red-50', confirm: 'Remove (archive) this model? Sales & downloads stop and un-paid earnings are voided.' },
  { action: 'refund_buyers', label: 'Refund buyers', cls: 'border-red-300 text-red-700 hover:bg-red-50', confirm: 'Refund every buyer of this model and archive it?' },
  { action: 'suspend_artist', label: 'Suspend artist', cls: 'border-red-300 text-red-700 hover:bg-red-50', confirm: 'Suspend this artist? All their models are hidden.' },
  { action: 'ban_artist', label: 'Ban artist', cls: 'border-red-400 text-red-800 hover:bg-red-50', confirm: 'Permanently ban this artist?' },
  { action: 'shadow_ban_user', label: 'Shadow-ban reporter', cls: 'border-gray-400 text-gray-800 hover:bg-gray-50', confirm: 'Shadow-ban the reporter? They can still buy, but can no longer file reports (except on models they own), post reviews, or message.' },
  { action: 'reinstate_model', label: 'Reinstate model', cls: 'border-green-300 text-green-700 hover:bg-green-50' },
]

const AdminModeration: React.FC = () => {
  const [filter, setFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-reports', filter],
    queryFn: () => adminModerationApi.listReports(filter || undefined),
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center gap-3">
        <ShieldAlert className="text-indigo-600" size={24} />
        <h1 className="text-2xl font-semibold text-gray-900">Moderation</h1>
        {data && data.openCount > 0 && (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-700">{data.openCount} open</span>
        )}
      </div>

      <div className="mt-5 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24"><Spinner size="lg" /></div>
      ) : (data?.reports.length ?? 0) === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-gray-200 bg-white p-12 text-center text-gray-400">
          Nothing here. {filter ? 'No reports with this status.' : 'The queue is clear.'}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data!.reports.map((r) => <Tile key={r.id} report={r} onOpen={() => setOpenId(r.id)} />)}
        </div>
      )}

      {openId && <DetailPanel reportId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

const Tile: React.FC<{ report: ReportTile; onOpen: () => void }> = ({ report: r, onOpen }) => {
  const meta = STATUS_META[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-600' }
  return (
    <button onClick={onOpen} className="flex flex-col rounded-xl border bg-white p-4 text-left shadow-xs transition hover:border-indigo-300 hover:shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
          {r.thumbnail_path && <img src={assetUrl(r.thumbnail_path)} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-900">{r.model_name ?? 'Deleted model'}</p>
          <p className="truncate text-xs text-gray-400">by {r.artist_name || r.artist_display_name || '—'}</p>
          <span className={`mt-1 inline-block rounded-sm px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="rounded-sm bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">{r.reason_label}</span>
        <span className="flex items-center gap-2 text-xs text-gray-400">
          {r.attachment_count > 0 && <span className="flex items-center gap-0.5"><Paperclip size={11} />{r.attachment_count}</span>}
          {new Date(r.created_at).toLocaleDateString()}
        </span>
      </div>
    </button>
  )
}

const DetailPanel: React.FC<{ reportId: string; onClose: () => void }> = ({ reportId, onClose }) => {
  const qc = useQueryClient()
  const [summary, setSummary] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-report', reportId],
    queryFn: () => adminModerationApi.getReport(reportId),
  })

  const resolve = useMutation({
    // Shadow-ban targets the reporter by default (handled server-side).
    mutationFn: ({ action }: { action: ModerationAction }) =>
      adminModerationApi.resolve(reportId, action, summary.trim()),
    onSuccess: (res) => {
      toast.success(`Done${res.notes?.length ? ` — ${res.notes.join('; ')}` : ''}`)
      qc.invalidateQueries({ queryKey: ['admin-reports'] })
      qc.invalidateQueries({ queryKey: ['admin-report', reportId] })
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Action failed'),
  })

  function runAction(action: ModerationAction, confirmMsg?: string) {
    if (summary.trim().length < 5) { toast.error('Write a findings summary first (shown to both parties)'); return }
    if (confirmMsg && !window.confirm(confirmMsg)) return
    resolve.mutate({ action })
  }

  const report = data?.report
  const resolved = report?.status?.startsWith('resolved')

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Report detail</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100"><X size={20} /></button>
        </div>

        {isLoading || !data || !report ? (
          <div className="flex justify-center py-24"><Spinner size="lg" /></div>
        ) : (
          <div className="space-y-6 px-6 py-5">
            {/* Reason + status */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-sm bg-red-50 px-2.5 py-1 text-sm font-semibold text-red-600">{report.reason_label}</span>
              <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_META[report.status]?.cls ?? 'bg-gray-100'}`}>{STATUS_META[report.status]?.label ?? report.status}</span>
              {report.model_status && <span className="rounded-sm bg-gray-100 px-2 py-0.5 text-xs text-gray-500">model: {report.model_status}</span>}
            </div>

            {report.detail && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Reporter's description</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{report.detail}</p>
              </div>
            )}

            {/* Model + parties */}
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoCard title="Reported model">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 overflow-hidden rounded-sm bg-gray-100">
                    {report.thumbnail_path && <img src={assetUrl(report.thumbnail_path)} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{report.model_name ?? '—'}</p>
                    {report.model_id && (
                      <a href={`/models/${report.model_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">
                        View listing <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              </InfoCard>

              <InfoCard title="Artist">
                <p className="text-sm font-medium text-gray-900">{report.artist_name || report.artist_display_name || '—'}</p>
                <p className="truncate text-xs text-gray-400">{report.artist_email}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {data.context.artist_model_count} models · {data.context.other_reports_on_artist} other report(s)
                  {report.artist_account_status && report.artist_account_status !== 'active' && (
                    <span className="ml-1 rounded-sm bg-red-100 px-1.5 py-0.5 font-medium text-red-700">{report.artist_account_status}</span>
                  )}
                </p>
              </InfoCard>

              <InfoCard title="Reporter">
                <p className="text-sm font-medium text-gray-900">{report.reporter_name ?? '—'}</p>
                <p className="truncate text-xs text-gray-400">{report.reporter_email}</p>
                {report.reporter_shadow_banned && <span className="mt-1 inline-block rounded-sm bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">shadow-banned</span>}
              </InfoCard>

              <InfoCard title="Context">
                <p className="text-xs text-gray-500">{data.context.other_reports_on_model} other report(s) on this model</p>
              </InfoCard>
            </div>

            {/* Proof attachments */}
            {data.attachments.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Proof ({data.attachments.length})</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {data.attachments.map((a) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="group relative block h-24 w-24 overflow-hidden rounded-lg border bg-gray-100">
                      {a.content_type?.startsWith('image/') ? (
                        <img src={a.url} alt={a.file_name ?? ''} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-gray-500"><Paperclip size={16} />{a.file_name ?? 'file'}</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Prior resolution */}
            {resolved && report.resolution_summary && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Decision by {report.resolved_by_name ?? 'admin'}</p>
                <p className="mt-1 text-sm text-gray-700">{report.resolution_summary}</p>
                <p className="mt-1 text-xs text-gray-400">Action: {report.resolution_action}</p>
              </div>
            )}

            {/* Findings + decisions */}
            <div className="border-t pt-5">
              <label className="text-sm font-medium text-gray-700">Findings &amp; decision</label>
              <p className="text-xs text-gray-400">Shown to the reporter and the artist when you act.</p>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                placeholder="Summarise your investigation and the outcome…"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-400"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                {ACTIONS.map((a) => (
                  <button
                    key={a.action}
                    disabled={resolve.isPending}
                    onClick={() => runAction(a.action, a.confirm)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${a.cls}`}
                  >
                    {resolve.isPending && resolve.variables?.action === a.action && <Loader2 size={14} className="animate-spin" />}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const InfoCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
    <div className="mt-1.5">{children}</div>
  </div>
)

export default AdminModeration
