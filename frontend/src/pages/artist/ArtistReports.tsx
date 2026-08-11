import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { reportsApi, REPORT_REASONS } from '../../api/endpoints/reports'
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

const ArtistReports: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ['artist-reports'], queryFn: () => reportsApi.getAgainstMe() })

  if (isLoading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>
  const reports = data ?? []

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Reports filed against your models and their outcome. You'll be notified when a decision is made.
      </p>

      {reports.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <ShieldAlert className="mx-auto text-muted-foreground" size={40} />
          <p className="mt-3 font-medium text-foreground">No reports against your models</p>
          <p className="text-sm text-muted-foreground">Keep it up — nothing needs your attention.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {reports.map((r) => {
            const meta = STATUS_META[r.status] ?? { label: r.status, cls: 'bg-muted text-muted-foreground' }
            return (
              <li key={r.id} className="rounded-xl border bg-card p-5 shadow-xs">
                <div className="flex items-start gap-4">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {r.thumbnail_path && <img src={assetUrl(r.thumbnail_path)} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
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
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ArtistReports
