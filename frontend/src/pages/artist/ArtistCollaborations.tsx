import React from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Users, Check, X, Clock, ImageOff } from 'lucide-react'
import { collaborationsApi, type IncomingCollabRequest } from '../../api/endpoints/collaborations'
import { assetUrl } from '../../api/transformers'

/**
 * Incoming collaboration requests — another artist wants to feature this artist's
 * models on their showcase. The owner approves ALL their models on that table or a
 * chosen subset, or declines. Approval unblocks the requester's publish.
 */
const ArtistCollaborations: React.FC = () => {
  const [requests, setRequests] = React.useState<IncomingCollabRequest[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRequests(await collaborationsApi.incoming())
    } catch {
      setError('Could not load collaboration requests')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const pending = requests.filter((r) => r.status === 'pending')
  const resolved = requests.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Collaboration requests</h1>
        <p className="mt-1 text-gray-600">
          Other artists who want to feature your models in their showcases. Approve all of your
          models on a table, pick specific ones, or decline.
        </p>
      </header>

      {loading && <p className="text-gray-500">Loading…</p>}
      {error && !loading && (
        <div><p className="text-red-600">{error}</p><button className="mt-2 rounded border px-3 py-1.5" onClick={load}>Retry</button></div>
      )}

      {!loading && !error && requests.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <Users className="mx-auto text-gray-300" size={32} />
          <h2 className="mt-3 text-lg font-medium text-gray-900">No requests yet</h2>
          <p className="mt-1 text-sm text-gray-600">When another artist adds one of your models to their showcase, it'll show up here.</p>
        </div>
      )}

      {pending.length > 0 && (
        <section className="space-y-4">
          {pending.map((r) => <RequestCard key={r.id} request={r} onResolved={load} />)}
        </section>
      )}

      {resolved.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">Past requests</h2>
          <ul className="divide-y rounded-lg border bg-white">
            {resolved.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-900">
                    <span className="font-medium">{r.requesterName}</span> · {r.tableName}
                  </p>
                  <p className="text-xs text-gray-500">{r.models.length} of your model{r.models.length === 1 ? '' : 's'}</p>
                </div>
                {r.status === 'accepted' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
                    <Check size={12} /> {r.approveAll ? 'Accepted (all)' : 'Accepted (some)'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                    <X size={12} /> Declined
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const RequestCard: React.FC<{ request: IncomingCollabRequest; onResolved: () => void }> = ({ request, onResolved }) => {
  const [mode, setMode] = React.useState<'all' | 'subset'>('all')
  const [selected, setSelected] = React.useState<Set<string>>(new Set(request.models.map((m) => m.id)))
  const [busy, setBusy] = React.useState(false)

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  async function respond(decision: 'accept' | 'decline') {
    if (decision === 'accept' && mode === 'subset' && selected.size === 0) {
      toast.error('Pick at least one model, or choose “Allow all”.')
      return
    }
    setBusy(true)
    try {
      await collaborationsApi.respond(request.id, {
        decision,
        approveAll: decision === 'accept' ? mode === 'all' : undefined,
        modelIds: decision === 'accept' && mode === 'subset' ? [...selected] : undefined,
      })
      toast.success(decision === 'accept' ? 'Collaboration accepted' : 'Request declined')
      onResolved()
    } catch {
      toast.error('Could not send your response')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
          <Users size={16} />
        </span>
        <p className="text-sm text-gray-900">
          <Link to={`/artists/${request.requesterId}`} className="font-semibold hover:text-indigo-600">{request.requesterName}</Link>
          {' '}wants to feature your models in{' '}
          <span className="font-medium">{request.tableName}</span>
        </p>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
          <Clock size={12} /> Pending
        </span>
      </div>

      <div className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
          Allow all my models on this table ({request.models.length})
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="radio" checked={mode === 'subset'} onChange={() => setMode('subset')} />
          Choose which models they can use
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {request.models.map((m) => {
          const url = assetUrl(m.thumbnail ?? undefined)
          const on = mode === 'all' || selected.has(m.id)
          return (
            <button
              key={m.id}
              type="button"
              disabled={mode === 'all'}
              onClick={() => toggle(m.id)}
              className={`flex items-center gap-2 rounded-lg border p-2 text-left transition ${
                on ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'
              } ${mode === 'all' ? 'cursor-default opacity-90' : 'hover:border-indigo-300'}`}
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded bg-gray-100">
                {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImageOff size={16} className="text-gray-400" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-gray-900">{m.name}</span>
                {on && <span className="text-[11px] text-indigo-600">Allowed</span>}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={() => respond('decline')}
          disabled={busy}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Decline
        </button>
        <button
          onClick={() => respond('accept')}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {mode === 'all' ? 'Accept all' : `Accept ${selected.size} selected`}
        </button>
      </div>
    </div>
  )
}

export default ArtistCollaborations
