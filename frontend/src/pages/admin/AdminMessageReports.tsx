import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  adminMessageReportsApi,
  type ConvReportAction,
  type SnapshotMessage,
} from '../../api/endpoints/adminMessageReports'

const REASON_LABELS: Record<string, string> = {
  harassment: 'Harassment or bullying',
  threats: 'Threats or violence',
  hate_speech: 'Hate speech or slurs',
  spam: 'Spam or advertising',
  scam: 'Scam or fraud',
  other: 'Other',
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700',
  under_review: 'bg-blue-100 text-blue-700',
  resolved_upheld: 'bg-green-100 text-green-700',
  resolved_dismissed: 'bg-gray-100 text-gray-600',
}

const ACTIONS: { value: ConvReportAction; label: string }[] = [
  { value: 'dismiss', label: 'Dismiss (no violation)' },
  { value: 'warn_user', label: 'Warn the reported user' },
  { value: 'shadow_ban_user', label: 'Shadow-ban the reported user' },
  { value: 'suspend_user', label: 'Suspend the reported user' },
  { value: 'ban_user', label: 'Ban the reported user' },
]

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '')

const AdminMessageReports: React.FC = () => {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [action, setAction] = useState<ConvReportAction>('dismiss')
  const [summary, setSummary] = useState('')
  const [resolving, setResolving] = useState(false)

  const { data: listData } = useQuery({
    queryKey: ['admin-conv-reports', statusFilter],
    queryFn: () => adminMessageReportsApi.list(statusFilter || undefined),
    refetchInterval: 30_000,
  })

  const { data: report } = useQuery({
    queryKey: ['admin-conv-report', openId],
    queryFn: () => adminMessageReportsApi.get(openId as string),
    enabled: !!openId,
  })

  const reports = listData?.reports ?? []
  const isResolved = report?.status === 'resolved_upheld' || report?.status === 'resolved_dismissed'

  const resolve = async () => {
    if (!openId || !summary.trim() || resolving) return
    setResolving(true)
    try {
      await adminMessageReportsApi.resolve(openId, action, summary.trim())
      toast.success('Report resolved')
      setSummary('')
      await queryClient.invalidateQueries({ queryKey: ['admin-conv-report', openId] })
      queryClient.invalidateQueries({ queryKey: ['admin-conv-reports'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not resolve report')
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag size={22} className="text-red-600" />
          <h1 className="text-2xl font-bold text-gray-900">Message reports</h1>
          {listData?.openCount ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {listData.openCount} open
            </span>
          ) : null}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="under_review">Under review</option>
          <option value="resolved_upheld">Upheld</option>
          <option value="resolved_dismissed">Dismissed</option>
        </select>
      </div>

      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:grid-cols-[340px_1fr]">
        {/* List */}
        <ul className="max-h-[70vh] divide-y divide-gray-100 overflow-y-auto border-r border-gray-200">
          {reports.length === 0 ? (
            <li className="p-6 text-center text-sm text-gray-400">No reports.</li>
          ) : (
            reports.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => { setOpenId(r.id); setSummary(''); setAction('dismiss') }}
                  className={`w-full px-4 py-3 text-left hover:bg-gray-50 ${r.id === openId ? 'bg-indigo-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {REASON_LABELS[r.reason] || r.reason}
                    </p>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[r.status] || ''}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="truncate text-xs text-gray-500">
                    {r.reporter_name || 'Someone'} → {r.reported_user_name || 'user'}
                  </p>
                  <p className="text-xs text-gray-400">{fmt(r.created_at)}</p>
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Detail */}
        <div className="flex max-h-[70vh] flex-col">
          {!openId || !report ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-400">
              Select a report to review the captured conversation.
            </div>
          ) : (
            <>
              <div className="border-b border-gray-200 px-5 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">{REASON_LABELS[report.reason] || report.reason}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[report.status] || ''}`}>
                    {report.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  <span className="font-medium">{report.reporter_name}</span> ({report.reporter_email}) reported{' '}
                  <span className="font-medium">{report.reported_user_name}</span> ({report.reported_user_email})
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Reported {fmt(report.created_at)}
                  {report.reported_shadow_banned ? ' · reported user is shadow-banned' : ''}
                  {report.reported_account_status && report.reported_account_status !== 'active'
                    ? ` · account ${report.reported_account_status}`
                    : ''}
                </p>
                {report.detail && (
                  <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">“{report.detail}”</p>
                )}
              </div>

              {/* Captured conversation */}
              <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                  Captured conversation ({report.snapshot?.messages?.length ?? 0} messages)
                </p>
                {(report.snapshot?.messages ?? []).map((m: SnapshotMessage) => {
                  const fromReported = m.senderId && m.senderId === report.reported_user_id
                  return (
                    <div key={m.id} className={`flex ${fromReported ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                          fromReported ? 'border border-red-200 bg-red-50 text-gray-800' : 'border border-gray-200 bg-white text-gray-800'
                        }`}
                      >
                        <p className="mb-0.5 text-xs font-medium opacity-70">
                          {m.isSystem ? 'Artifact Armoury' : m.senderName || 'User'}
                          {fromReported ? ' (reported)' : ''}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className="mt-1 text-[10px] text-gray-400">{fmt(m.createdAt)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Resolve */}
              <div className="border-t border-gray-200 p-4">
                {isResolved ? (
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    <span className="font-medium">Resolved</span> ({report.resolution_action}) by{' '}
                    {report.resolved_by_name || 'admin'} — {report.resolution_summary}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={16} className="text-gray-500" />
                      <select
                        value={action}
                        onChange={(e) => setAction(e.target.value as ConvReportAction)}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        {ACTIONS.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      rows={2}
                      placeholder="Resolution summary (shared with the reporter)…"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                    />
                    <button
                      onClick={resolve}
                      disabled={!summary.trim() || resolving}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {resolving ? 'Resolving…' : 'Resolve report'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminMessageReports
