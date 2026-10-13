import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, CheckCircle2, Ban, Loader2, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  adminGeometryReviewsApi,
  GeometryReview,
  GeometryReviewStatus,
  ReviewModelSide,
} from '../../api/endpoints/adminGeometryReviews'
import { assetUrl } from '../../api/transformers'
import Spinner from '../../components/ui/Spinner'

const FILTERS: Array<{ key: GeometryReviewStatus; label: string }> = [
  { key: 'open', label: 'To review' },
  { key: 'cleared', label: 'Cleared' },
  { key: 'taken_down', label: 'Taken down' },
]

const mm = (v: number | string | null) => (v == null || v === '' ? '?' : Number(v).toFixed(0))

/**
 * Uploads marked "scale model of a real-world subject" that matched another
 * artist's model on geometry (migration 072). They went live; this is where an
 * admin decides whether that was independent work or a copy.
 */
const AdminGeometryReviews: React.FC = () => {
  const [filter, setFilter] = useState<GeometryReviewStatus>('open')
  const { data, isLoading } = useQuery({
    queryKey: ['admin-geometry-reviews', filter],
    queryFn: () => adminGeometryReviewsApi.list(filter),
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center gap-3">
        <Copy className="text-primary" size={24} />
        <h1 className="text-2xl font-semibold text-foreground">Similar models</h1>
        {data && data.openCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-semibold text-amber-800">{data.openCount} to review</span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Uploads the artist marked as a scale model of a real-world subject (a tank, aircraft, ship or building) whose shape
        closely matches another artist's model. Two people modelling the same real thing can legitimately end up close, so
        these went live instead of being rejected. Compare each pair: <b>clear</b> it if it's independent work, or <b>take down</b>{' '}
        the upload if it's a copy.
      </p>

      <div className="mt-5 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground border border-border hover:bg-accent'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24"><Spinner size="lg" /></div>
      ) : (data?.reviews.length ?? 0) === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
          {filter === 'open' ? 'Nothing waiting for review.' : 'None yet.'}
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {data!.reviews.map((r) => <ReviewCard key={r.id} review={r} />)}
        </div>
      )}
    </div>
  )
}

const ModelSide: React.FC<{ side: ReviewModelSide; label: string; earlier: boolean }> = ({ side, label, earlier }) => (
  <div className="min-w-0 flex-1 rounded-lg border border-border bg-background p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="mt-2 aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
      {side.thumbnail_path ? (
        <img src={assetUrl(side.thumbnail_path)} alt={side.name} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No thumbnail</div>
      )}
    </div>
    <a
      href={`/models/${side.id}`}
      target="_blank"
      rel="noreferrer"
      className="mt-2 flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary hover:underline"
    >
      <span className="truncate">{side.name}</span> <ExternalLink size={12} className="shrink-0" />
    </a>
    <p className="truncate text-xs text-muted-foreground">by {side.artist_name}</p>
    <p className="mt-1 text-xs text-muted-foreground">
      {mm(side.width)} × {mm(side.depth)} × {mm(side.height)} mm
      {side.part_count > 1 && <> · {side.part_count} files</>}
    </p>
    <p className="text-xs text-muted-foreground">
      Uploaded {new Date(side.created_at).toLocaleDateString()}
      {earlier && <span className="ml-1 font-medium text-foreground">(first)</span>}
      {' · '}{side.processing_status === 'failed' ? 'upload failed' : side.status}
    </p>
  </div>
)

const ReviewCard: React.FC<{ review: GeometryReview }> = ({ review: r }) => {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const uploadFirst = new Date(r.upload.created_at) < new Date(r.matched.created_at)

  const decide = useMutation({
    mutationFn: (action: 'clear' | 'take_down') => adminGeometryReviewsApi.decide(r.id, action, note.trim() || undefined),
    onSuccess: (res, action) => {
      toast.success(action === 'clear' ? 'Cleared — the upload stays live' : `Taken down${res.notes?.length ? ` (${res.notes.join('; ')})` : ''}`)
      qc.invalidateQueries({ queryKey: ['admin-geometry-reviews'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Action failed'),
  })

  const takeDown = () => {
    if (note.trim().length < 10) { toast.error('Write a reason (10+ characters) — it is sent to the artist'); return }
    if (!window.confirm(`Take down "${r.upload.name}"? It is archived, buyers lose access to it and the artist's un-paid earnings for it are voided.`)) return
    decide.mutate('take_down')
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Flagged {new Date(r.createdAt).toLocaleString()}
          {r.fileLabel && <> · matched on file <span className="font-medium text-foreground">{r.fileLabel}</span></>}
        </p>
        <p className="text-sm" title={r.distances ? Object.entries(r.distances).map(([k, v]) => `${k} ${Number(v).toFixed(4)}`).join('  ') : undefined}>
          Similarity score <span className="font-semibold text-foreground">{r.score.toFixed(2)}</span>
          <span className="text-muted-foreground"> (0 = identical, 1 = edge of a match)</span>
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <ModelSide side={r.upload} label="New upload (real-world subject)" earlier={uploadFirst} />
        <ModelSide side={r.matched} label="Matched existing model" earlier={!uploadFirst} />
      </div>

      {r.status === 'open' ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Note — required to take down (sent to the artist), optional to clear"
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={decide.isPending}
              onClick={() => decide.mutate('clear')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              {decide.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Independent work — clear
            </button>
            <button
              disabled={decide.isPending}
              onClick={takeDown}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Ban size={14} />
              It's a copy — take down the upload
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          {r.status === 'cleared' ? 'Cleared' : 'Taken down'}
          {r.resolvedByName && <> by {r.resolvedByName}</>}
          {r.resolvedAt && <> on {new Date(r.resolvedAt).toLocaleString()}</>}
          {r.resolutionNote && <>: {r.resolutionNote}</>}
        </div>
      )}
    </div>
  )
}

export default AdminGeometryReviews
