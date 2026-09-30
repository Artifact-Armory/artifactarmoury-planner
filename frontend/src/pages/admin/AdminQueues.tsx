import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, Cpu, Clock, RefreshCw } from 'lucide-react'
import { adminQueuesApi, QueueStats, WorkerInfo } from '../../api/endpoints/adminQueues'
import Spinner from '../../components/ui/Spinner'

/** Seconds as a short human duration — "4m", "2h 10m", "3d". */
function since(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

const QUEUE_LABEL: Record<string, string> = {
  ingest: 'Model ingest (uploads)',
  bake: 'Preview bake',
  full_glb: 'Owner full-quality GLB',
}

const QUEUE_NOTE: Record<string, string> = {
  ingest: 'Dedup, mesh checks and the first preview. A backlog here means uploads are not being processed.',
  bake: 'The watermarked, decimated preview shown on the store and planner.',
  full_glb: 'The full-detail mesh shown to people who own the model. A backlog here is not urgent.',
}

const AdminQueues: React.FC = () => {
  // Auto-refresh: this page is what you stare at during an incident, and a stale
  // reading is worse than none.
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin-queues'],
    queryFn: () => adminQueuesApi.get(),
    refetchInterval: 15_000,
  })

  if (isLoading) {
    return <div className="flex justify-center py-24"><Spinner size="lg" /></div>
  }
  if (!data) {
    return <div className="mx-auto max-w-5xl px-4 py-8 text-muted-foreground">Could not load queue health.</div>
  }

  const critical = data.problems.filter((p) => p.severity === 'critical')
  const warnings = data.problems.filter((p) => p.severity === 'warning')

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center gap-3">
        <Activity className="text-primary" size={24} />
        <h1 className="text-2xl font-semibold text-foreground">Processing queues</h1>
        <button
          onClick={() => refetch()}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Uploads are processed by a separate worker service. If it stops, new uploads sit at
        “processing” and nothing else on the site looks wrong — this page and the email alarm are
        how that gets noticed.
      </p>

      {/* Headline verdict, before any detail. */}
      <div
        className={`mt-6 flex items-start gap-3 rounded-xl border p-4 ${
          data.healthy
            ? 'border-green-200 bg-green-50 text-green-900'
            : critical.length > 0
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}
      >
        {data.healthy ? <CheckCircle2 size={20} className="mt-0.5 shrink-0" /> : <AlertTriangle size={20} className="mt-0.5 shrink-0" />}
        <div>
          <p className="font-semibold">
            {data.healthy
              ? 'Everything is processing normally'
              : critical.length > 0
                ? 'Processing is broken'
                : 'Processing needs attention'}
          </p>
          {data.problems.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {[...critical, ...warnings].map((p) => (
                <li key={p.key}>{p.message}</li>
              ))}
            </ul>
          )}
          {!data.healthy && (
            <p className="mt-3 text-sm">
              First thing to check: is the <code className="rounded bg-black/10 px-1">worker</code> service
              running on Railway? Restarting it is safe — queued jobs resume on their own and nothing is lost.
            </p>
          )}
        </div>
      </div>

      {/* Workers */}
      <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Cpu size={18} /> Workers
        <span className="text-sm font-normal text-muted-foreground">
          {data.liveWorkers} live{data.workers.length !== data.liveWorkers && ` of ${data.workers.length} seen`}
        </span>
      </h2>
      {data.workers.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          No worker has ever checked in. If <code>MODEL_INGEST_WORKER_ENABLED</code> is true, uploads are not
          being processed at all.
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Worker</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 font-medium">Up for</th>
                <th className="px-4 py-2 font-medium">Jobs done</th>
              </tr>
            </thead>
            <tbody>
              {data.workers.map((w: WorkerInfo) => (
                <tr key={w.workerId} className="border-t border-border">
                  <td className="px-4 py-2">
                    <span
                      className={`mr-2 inline-block h-2 w-2 rounded-full ${w.alive ? 'bg-green-500' : 'bg-red-500'}`}
                    />
                    <span className="font-mono text-xs">{w.workerId}</span>
                  </td>
                  <td className={`px-4 py-2 ${w.alive ? '' : 'font-semibold text-red-600'}`}>{since(w.ageSec)} ago</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {since((Date.now() - new Date(w.startedAt).getTime()) / 1000)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{w.jobsCompleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Queues */}
      <h2 className="mt-8 text-lg font-semibold text-foreground">Queues</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {data.queues.map((q: QueueStats) => {
          const stalled = q.enabled && q.oldestQueuedAgeSec != null && q.oldestQueuedAgeSec > 20 * 60
          return (
            <div
              key={q.queue}
              className={`rounded-xl border bg-card p-4 ${stalled ? 'border-red-300' : 'border-border'}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-foreground">{QUEUE_LABEL[q.queue] ?? q.queue}</h3>
                {!q.enabled && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">off</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{QUEUE_NOTE[q.queue]}</p>
              <div className="mt-3 flex gap-4 text-sm">
                <div>
                  <div className={`text-xl font-semibold ${q.queued > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {q.queued}
                  </div>
                  <div className="text-xs text-muted-foreground">queued</div>
                </div>
                <div>
                  <div className="text-xl font-semibold text-foreground">{q.running}</div>
                  <div className="text-xs text-muted-foreground">running</div>
                </div>
                <div>
                  <div className={`text-xl font-semibold ${q.failed > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {q.failed}
                  </div>
                  <div className="text-xs text-muted-foreground">failed</div>
                </div>
              </div>
              {q.oldestQueuedAgeSec != null && (
                <p className={`mt-3 flex items-center gap-1.5 text-xs ${stalled ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
                  <Clock size={12} /> oldest waiting {since(q.oldestQueuedAgeSec)}
                </p>
              )}
              {q.stalledRunning > 0 && (
                <p className="mt-1 text-xs font-medium text-amber-600">
                  {q.stalledRunning} lost their worker mid-job
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Stuck models — the artist-visible symptom */}
      {data.stuckModels.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-semibold text-foreground">Models stuck processing</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These artists are looking at a listing that never finishes. They are the reason this matters.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Artist</th>
                  <th className="px-4 py-2 font-medium">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {data.stuckModels.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-4 py-2">
                      <Link to={`/models/${m.id}`} className="text-primary hover:underline">
                        {m.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{m.artistName ?? '—'}</td>
                    <td className="px-4 py-2 font-medium text-red-600">{since(m.waitingSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-8 text-xs text-muted-foreground">
        Checked {new Date(data.checkedAt).toLocaleTimeString()}. Refreshes every 15 seconds.
      </p>
    </div>
  )
}

export default AdminQueues
