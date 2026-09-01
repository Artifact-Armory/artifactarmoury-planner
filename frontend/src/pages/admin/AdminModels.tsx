import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Search, X, ExternalLink, Flag, Loader2, ShieldAlert } from 'lucide-react'
import { adminApi } from '../../api/endpoints/admin'
import {
  adminModelsApi,
  AdminModelDetail,
  DirectModelAction,
  ModelReportRow,
  ReportedModelRow,
} from '../../api/endpoints/adminModels'
import { assetUrl } from '../../api/transformers'
import { formatPrice } from '../../utils/format'
import Spinner from '../../components/ui/Spinner'

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-muted text-foreground',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-red-100 text-red-700',
  flagged: 'bg-amber-100 text-amber-700',
}

const REPORT_STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-amber-100 text-amber-700' },
  under_review: { label: 'Under review', cls: 'bg-blue-100 text-blue-700' },
  awaiting_info: { label: 'Awaiting info', cls: 'bg-purple-100 text-purple-700' },
  resolved_upheld: { label: 'Upheld', cls: 'bg-red-100 text-red-700' },
  resolved_dismissed: { label: 'Dismissed', cls: 'bg-green-100 text-green-700' },
}

const ACTION_META: Record<DirectModelAction, { label: string; cls: string; title: string; description: string; showWhen?: (status: string) => boolean }> = {
  warn_artist: {
    label: 'Warn artist',
    cls: 'border-amber-300 text-amber-700 hover:bg-amber-50',
    title: 'Warn the artist',
    description: 'Sends your message to the artist. The listing itself is not changed.',
  },
  unpublish_model: {
    label: 'Unpublish',
    cls: 'border-amber-300 text-amber-700 hover:bg-amber-50',
    title: 'Unpublish this model',
    description: 'Takes it back to draft — it disappears from the marketplace until the artist republishes it.',
    showWhen: (s) => s === 'published',
  },
  flag_model: {
    label: 'Flag for review',
    cls: 'border-amber-300 text-amber-700 hover:bg-amber-50',
    title: 'Flag this model for review',
    description: 'Hides it from the marketplace pending review.',
    showWhen: (s) => s !== 'flagged',
  },
  remove_model: {
    label: 'Remove (archive)',
    cls: 'border-red-300 text-red-700 hover:bg-red-50',
    title: 'Remove this model',
    description: 'Archives it — downloads stop for future buyers, existing buyers keep theirs, and any unpaid artist earnings on it are voided.',
    showWhen: (s) => s !== 'archived',
  },
  refund_buyers: {
    label: 'Remove & refund buyers',
    cls: 'border-red-400 text-red-800 hover:bg-red-50',
    title: 'Remove and refund every buyer',
    description: 'Archives the model, refunds every buyer of it, and voids unpaid artist earnings. This charges back through Stripe immediately and cannot be undone from here.',
    showWhen: (s) => s !== 'archived',
  },
  reinstate_model: {
    label: 'Reinstate',
    cls: 'border-green-300 text-green-700 hover:bg-green-50',
    title: 'Reinstate this model',
    description: 'Publishes it again and clears any flag.',
    showWhen: (s) => s !== 'published',
  },
}

const ACTION_ORDER: DirectModelAction[] = [
  'warn_artist', 'unpublish_model', 'flag_model', 'remove_model', 'refund_buyers', 'reinstate_model',
]

type Tab = 'all' | 'flagged'

const AdminModels: React.FC = () => {
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [openModelId, setOpenModelId] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'models', { search, page }],
    queryFn: () => adminApi.listModels({ search: search || undefined, page, limit: 24 }),
    enabled: tab === 'all',
  })

  const { data: reportedData, isLoading: reportedLoading } = useQuery({
    queryKey: ['admin-models-reported'],
    queryFn: () => adminModelsApi.listReported(),
    enabled: tab === 'flagged',
  })
  const reportedModels = reportedData?.models ?? []

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Click a model to open it in admin mode — fast actions, moderation history, and messaging the artist.
          </p>
        </div>
        {tab === 'all' && (
          <form onSubmit={onSearch} className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search models…"
              className="pl-9 pr-3 py-2 text-sm border border-border rounded-md w-64 focus:outline-hidden focus:ring-2 focus:ring-ring"
            />
          </form>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab('all')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground border border-border hover:bg-accent'}`}
        >
          All models
        </button>
        <button
          onClick={() => setTab('flagged')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'flagged' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground border border-border hover:bg-accent'}`}
        >
          <Flag size={13} /> Flagged
          {reportedModels.length > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${tab === 'flagged' ? 'bg-primary-foreground/20' : 'bg-red-100 text-red-700'}`}>
              {reportedModels.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'all' ? (
        <>
          {isLoading && <div className="text-muted-foreground">Loading…</div>}
          {isError && <div className="text-red-600">Failed to load models.</div>}

          {data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {data.models.map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => setOpenModelId(m.id)}
                    className="text-left bg-card border border-border rounded-lg overflow-hidden hover:shadow-md transition-shadow"
                  >
                    <div className="aspect-square bg-muted">
                      {m.thumbnail_path ? (
                        <img src={assetUrl(m.thumbnail_path)} alt={m.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="text-sm font-medium text-foreground truncate">{m.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.artist_name || 'Unknown artist'}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-foreground">
                        {formatPrice(m.base_price ?? 0)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {data.models.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No models found.</div>
              )}

              {data.pagination.pages > 1 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total}{' '}
                    models
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="px-3 py-1.5 border border-border rounded-md disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      disabled={page >= data.pagination.pages}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3 py-1.5 border border-border rounded-md disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : reportedLoading ? (
        <div className="flex justify-center py-24"><Spinner size="lg" /></div>
      ) : reportedModels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
          Nothing flagged. No model currently has an open complaint.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reportedModels.map((m) => (
            <ReportedTile key={m.id} model={m} onOpen={() => setOpenModelId(m.id)} />
          ))}
        </div>
      )}

      {openModelId && <AdminModelPanel modelId={openModelId} onClose={() => setOpenModelId(null)} />}
    </div>
  )
}

const ReportedTile: React.FC<{ model: ReportedModelRow; onOpen: () => void }> = ({ model: m, onOpen }) => (
  <button onClick={onOpen} className="flex flex-col rounded-xl border border-border bg-card p-4 text-left shadow-xs transition hover:border-primary/40 hover:shadow-sm">
    <div className="flex items-start gap-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
        {m.thumbnail_path && <img src={assetUrl(m.thumbnail_path)} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{m.name}</p>
        <p className="truncate text-xs text-muted-foreground">by {m.artist_name || m.artist_email}</p>
        <span className={`mt-1 inline-block rounded-sm px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[m.status] ?? 'bg-muted'}`}>{m.status}</span>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="rounded-sm bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
        {m.open_report_count} open report{Number(m.open_report_count) === 1 ? '' : 's'}
      </span>
      {m.open_reasons.slice(0, 2).map((reason) => (
        <span key={reason} className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{reason}</span>
      ))}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Last reported {new Date(m.last_reported_at).toLocaleDateString()}</p>
  </button>
)

const AdminModelPanel: React.FC<{ modelId: string; onClose: () => void }> = ({ modelId, onClose }) => {
  const qc = useQueryClient()
  const [pendingAction, setPendingAction] = useState<DirectModelAction | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-model', modelId],
    queryFn: () => adminModelsApi.getModel(modelId),
  })

  const moderate = useMutation({
    mutationFn: ({ action, message }: { action: DirectModelAction; message: string }) =>
      adminModelsApi.moderate(modelId, action, message),
    onSuccess: () => {
      toast.success('Action applied — the artist has been messaged')
      setPendingAction(null)
      qc.invalidateQueries({ queryKey: ['admin-model', modelId] })
      qc.invalidateQueries({ queryKey: ['admin-models-reported'] })
      qc.invalidateQueries({ queryKey: ['admin', 'models'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Action failed'),
  })

  const model = data?.model
  const reports = data?.reports ?? []
  const openReports = reports.filter((r) => ['open', 'under_review', 'awaiting_info'].includes(r.status))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{model ? model.name : 'Model'}</h2>
          <div className="flex items-center gap-3">
            {model && (
              <a
                href={`/models/${model.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                View listing <ExternalLink size={14} />
              </a>
            )}
            <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"><X size={20} /></button>
          </div>
        </div>

        {isLoading || !data || !model ? (
          <div className="flex justify-center py-24"><Spinner size="lg" /></div>
        ) : (
          <div className="space-y-6 px-6 py-5">
            <div className="flex gap-4">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                {model.thumbnail_path && <img src={assetUrl(model.thumbnail_path)} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[model.status] ?? 'bg-muted'}`}>{model.status}</span>
                  <span className="text-sm text-muted-foreground">{model.category}</span>
                  {openReports.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                      <ShieldAlert size={11} /> {openReports.length} open report{openReports.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-foreground">{formatPrice(model.base_price)}</p>
                <p className="text-xs text-muted-foreground">{model.sale_count} sold · {model.view_count} views</p>
                <p className="text-xs text-muted-foreground">
                  By {model.artist_name || model.artist_email}
                  {model.artist_account_status !== 'active' && (
                    <span className="ml-1 rounded-sm bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">{model.artist_account_status}</span>
                  )}
                </p>
              </div>
            </div>

            {model.flagged_reason && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Flagged reason</p>
                <p className="mt-1">{model.flagged_reason}</p>
              </div>
            )}

            {/* Moderation history — every report against this model, user-filed or admin-initiated */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Moderation history ({reports.length})
              </p>
              {reports.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No reports or actions recorded against this model.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {reports.map((r) => (
                    <ReportHistoryRow key={r.id} report={r} />
                  ))}
                </div>
              )}
            </div>

            {/* Fast actions */}
            <div className="border-t border-border pt-5">
              <p className="text-sm font-medium text-foreground">Fast actions</p>
              <p className="text-xs text-muted-foreground">Each action requires a message — it's sent to the artist explaining what you did and why.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {ACTION_ORDER.filter((a) => !ACTION_META[a].showWhen || ACTION_META[a].showWhen!(model.status)).map((a) => (
                  <button
                    key={a}
                    onClick={() => setPendingAction(a)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${ACTION_META[a].cls}`}
                  >
                    {ACTION_META[a].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {pendingAction && model && (
        <ActionMessageModal
          action={pendingAction}
          modelName={model.name}
          artistName={model.artist_name || model.artist_email}
          isPending={moderate.isPending}
          onCancel={() => setPendingAction(null)}
          onConfirm={(message) => moderate.mutate({ action: pendingAction, message })}
        />
      )}
    </div>
  )
}

const ReportHistoryRow: React.FC<{ report: ModelReportRow }> = ({ report: r }) => {
  const meta = REPORT_STATUS_META[r.status] ?? { label: r.status, cls: 'bg-muted text-muted-foreground' }
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">{r.reason_label}</span>
        <span className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
        <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
        {r.reporter_name && <span className="text-xs text-muted-foreground">· reported by {r.reporter_name}</span>}
      </div>
      {r.detail && <p className="mt-1.5 text-sm text-foreground">{r.detail}</p>}
      {r.resolution_summary && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Decision{r.resolved_by_name ? ` by ${r.resolved_by_name}` : ''}
          </p>
          <p className="text-sm text-foreground">{r.resolution_summary}</p>
        </div>
      )}
    </div>
  )
}

/** Forces a message to the artist before a fast action runs — no silent moderation. */
const ActionMessageModal: React.FC<{
  action: DirectModelAction
  modelName: string
  artistName: string
  isPending: boolean
  onCancel: () => void
  onConfirm: (message: string) => void
}> = ({ action, modelName, artistName, isPending, onCancel, onConfirm }) => {
  const [message, setMessage] = useState('')
  const meta = ACTION_META[action]
  const valid = message.trim().length >= 5

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onConfirm(message.trim())
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-lg bg-card p-6 shadow-xl"
      >
        <div>
          <h2 className="text-lg font-semibold text-foreground">{meta.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            "{modelName}" · {artistName} will be notified with the message below.
          </p>
        </div>

        <label className="block text-sm">
          <span className="font-medium text-foreground">Message to the artist</span>
          <textarea
            autoFocus
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Explain what you're doing and why — this is what the artist will see."
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary/50 focus:outline-hidden focus:ring-1 focus:ring-primary/50"
          />
          {!valid && message.length > 0 && (
            <span className="mt-1 block text-xs text-red-600">At least 5 characters.</span>
          )}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-muted-foreground hover:underline">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || isPending}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              action === 'remove_model' || action === 'refund_buyers' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Confirm & send
          </button>
        </div>
      </form>
    </div>
  )
}

export default AdminModels
