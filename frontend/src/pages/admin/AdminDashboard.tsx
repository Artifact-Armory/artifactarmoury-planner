import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Users, Package, ShoppingCart, DollarSign, Flag, Layers, LayoutGrid, Hammer, Save } from 'lucide-react'
import { adminApi } from '../../api/endpoints/admin'
import { formatPrice } from '../../utils/format'

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; sub?: string }> = ({
  icon,
  label,
  value,
  sub,
}) => (
  <div className="bg-card rounded-lg border border-border p-5">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-muted-foreground">{icon}</span>
    </div>
    <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
    {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
  </div>
)

const sinceLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'not yet'

/** Planner usage: visits, guest vs signed-in building, saved tables, top models. */
const PlannerStats: React.FC = () => {
  const [days, setDays] = React.useState(30)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'planner-stats', days],
    queryFn: () => adminApi.getPlannerStats(days),
    refetchInterval: 60000,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <LayoutGrid size={18} /> Planner
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Guests are people not signed in, counted per browser tab. Admin accounts are left out.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading planner stats…</div>
      ) : isError || !data ? (
        <div className="text-sm text-red-600">Failed to load planner stats.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={<Users size={18} />}
              label="Guest planner visitors"
              value={data.visits.guestVisitors.toLocaleString()}
              sub={`${data.visits.guestOpens.toLocaleString()} opens · counting since ${sinceLabel(data.visits.trackedSince)}`}
            />
            <StatCard
              icon={<Hammer size={18} />}
              label="Guest tables started"
              value={data.building.guestBuilders.toLocaleString()}
              sub={`Placed at least one piece · ${data.building.guestPlacements.toLocaleString()} pieces placed`}
            />
            <StatCard
              icon={<Users size={18} />}
              label="Signed-in planner users"
              value={data.visits.memberVisitors.toLocaleString()}
              sub={`${data.building.memberBuilders.toLocaleString()} built something · ${data.building.memberPlacements.toLocaleString()} pieces`}
            />
            <StatCard
              icon={<Save size={18} />}
              label="Saved tables"
              value={data.savedTables.total.toLocaleString()}
              sub={
                `+${data.savedTables.newInPeriod} in period · ${data.savedTables.byCustomers} customers, ` +
                `${data.savedTables.byArtists} artists · ${data.savedTables.listed} on Tables page`
              }
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TopModels
              title="Most placed models"
              note={`Pieces dropped on a table in the period (since ${sinceLabel(data.building.trackedSince)})`}
              rows={data.topPlaced.map((m) => ({
                id: m.id,
                name: m.name,
                artistName: m.artistName,
                value: `${m.placements.toLocaleString()} placed`,
                sub: `${m.people} people · ${m.guestPlacements} by guests`,
              }))}
            />
            <TopModels
              title="On the most saved tables"
              note="All time, counts each table once"
              rows={data.topOnSavedTables.map((m) => ({
                id: m.id,
                name: m.name,
                artistName: m.artistName,
                value: `${m.tables.toLocaleString()} tables`,
              }))}
            />
          </div>
        </>
      )}
    </div>
  )
}

const TopModels: React.FC<{
  title: string
  note: string
  rows: Array<{ id: string; name: string; artistName: string | null; value: string; sub?: string }>
}> = ({ title, note, rows }) => (
  <div className="bg-card rounded-lg border border-border">
    <div className="px-5 py-3 border-b border-border">
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
    <div className="divide-y divide-border">
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No data yet.</p>
      ) : (
        rows.map((r, i) => (
          <div key={r.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Link to={`/models/${r.id}`} className="text-sm font-medium text-foreground hover:underline truncate block">
                {i + 1}. {r.name}
              </Link>
              <div className="text-xs text-muted-foreground truncate">{r.artistName || 'Unknown artist'}</div>
            </div>
            <div className="text-right whitespace-nowrap">
              <div className="text-sm text-foreground">{r.value}</div>
              {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
            </div>
          </div>
        ))
      )}
    </div>
  </div>
)

const AdminDashboard: React.FC = () => {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminApi.getDashboard,
    // Refresh periodically so the preview-queue depth stays roughly live.
    refetchInterval: 20000,
  })

  if (isLoading) return <div className="text-muted-foreground">Loading dashboard…</div>
  if (isError)
    return (
      <div className="text-red-600">
        Failed to load dashboard: {(error as any)?.response?.data?.message || 'Unknown error'}
      </div>
    )

  const s = data!.stats

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">System overview and recent activity.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users size={18} />}
          label="Customers"
          value={Number(s.customer_count).toLocaleString()}
        />
        <StatCard
          icon={<Users size={18} />}
          label="Artists"
          value={Number(s.artist_count).toLocaleString()}
        />
        <StatCard
          icon={<Package size={18} />}
          label="Published models"
          value={Number(s.published_models).toLocaleString()}
          sub={`+${Number(s.models_last_7_days)} in last 7 days`}
        />
        <StatCard
          icon={<ShoppingCart size={18} />}
          label="Orders"
          value={Number(s.total_orders).toLocaleString()}
          sub={`+${Number(s.orders_last_7_days)} in last 7 days`}
        />
        {/* Preview bake queue depth (the proxy-bake worker). */}
        {/* Clicks through to Processing queues, where failed bakes can be retried. */}
        {data!.previewQueue && (
          <Link to="/admin/queues" className="block rounded-lg hover:ring-1 hover:ring-primary/40">
            <StatCard
              icon={<Layers size={18} />}
              label="Preview queue"
              value={Number(data!.previewQueue.queued).toLocaleString()}
              sub={
                `${data!.previewQueue.running} baking now` +
                (data!.previewQueue.failed ? ` · ${data!.previewQueue.failed} failed` : '')
              }
            />
            {(data!.previewQueue.failedModels?.length ?? 0) > 0 && (
              <div className="-mt-3 px-5 pb-4 text-xs text-red-600">
                Failed: {data!.previewQueue.failedModels!.map((m) => m.name ?? 'Deleted model').join(', ')}
              </div>
            )}
          </Link>
        )}
        {/* Revenue is owner-only; the backend omits it for regular admins. */}
        {s.total_revenue != null && (
          <StatCard
            icon={<DollarSign size={18} />}
            label="Total revenue"
            value={formatPrice(s.total_revenue)}
            sub="Succeeded payments"
          />
        )}
      </div>

      <PlannerStats />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Flagged models */}
        <div className="bg-card rounded-lg border border-border">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Flag size={16} className="text-amber-500" /> Flagged models
            </h2>
            <Link to="/admin/moderation" className="text-sm text-primary hover:underline">
              Moderation queue
            </Link>
          </div>
          <div className="divide-y divide-border">
            {data!.flaggedModels.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">Nothing flagged. 🎉</p>
            ) : (
              data!.flaggedModels.map((m) => (
                <div key={m.id} className="px-5 py-3">
                  <div className="text-sm font-medium text-foreground">{m.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.artist_name || 'Unknown artist'} · {m.flagged_reason || 'No reason given'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-card rounded-lg border border-border">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground">Recent activity</h2>
          </div>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {data!.recentActivity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              data!.recentActivity.map((a, i) => (
                <div key={i} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm text-foreground">{a.action}</span>
                    {a.display_name && (
                      <span className="text-xs text-muted-foreground"> · {a.display_name}</span>
                    )}
                  </div>
                  <span
                    className="text-xs text-muted-foreground whitespace-nowrap"
                    title={new Date(a.created_at).toLocaleString('en-GB')}
                  >
                    {new Date(a.created_at).toLocaleString('en-GB', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminDashboard
