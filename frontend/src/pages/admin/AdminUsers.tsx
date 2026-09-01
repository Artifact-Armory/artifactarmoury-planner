import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Search, X, ExternalLink, PoundSterling, ShoppingBag, Eye, Target, TrendingUp } from 'lucide-react'
import { adminApi, AdminUserRow } from '../../api/endpoints/admin'
import { useAuthStore } from '../../store/authStore'
import { assetUrl } from '../../api/transformers'
import { formatPrice } from '../../utils/format'
import Spinner from '../../components/ui/Spinner'

const roleBadge: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  artist: 'bg-primary/20 text-primary',
  customer: 'bg-muted text-foreground',
}
const statusBadge: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-amber-100 text-amber-700',
  banned: 'bg-red-100 text-red-700',
}
const payBadge: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-muted text-foreground',
}

type IntroState = 'none' | 'pending' | 'active' | 'ended'

function introState(u: AdminUserRow): IntroState {
  if (!u.intro_commission_rate) return 'none'
  if (!u.intro_commission_starts_at) return 'pending'
  if (u.intro_commission_ends_at && new Date(u.intro_commission_ends_at) > new Date()) return 'active'
  return 'ended'
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB')

const AdminUsers: React.FC = () => {
  const qc = useQueryClient()
  const me = useAuthStore((s) => s.user)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [editingRateId, setEditingRateId] = useState<string | null>(null)
  const [rateInput, setRateInput] = useState('')
  const [introModalUser, setIntroModalUser] = useState<AdminUserRow | null>(null)
  const [openUserId, setOpenUserId] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'users', { search, role, status, page }],
    queryFn: () =>
      adminApi.getUsers({
        search: search || undefined,
        role: role || undefined,
        status: status || undefined,
        page,
        limit: 25,
      }),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] })

  const statusMut = useMutation({
    mutationFn: ({ id, s }: { id: string; s: 'active' | 'suspended' | 'banned' }) =>
      adminApi.setUserStatus(id, s),
    onSuccess: () => {
      toast.success('User status updated')
      invalidate()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update status'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      toast.success('User deleted')
      invalidate()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to delete user'),
  })

  const rateMut = useMutation({
    mutationFn: ({ id, rate }: { id: string; rate: number }) => adminApi.setCommissionRate(id, rate),
    onSuccess: () => {
      toast.success('Commission rate updated')
      setEditingRateId(null)
      invalidate()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update commission rate'),
  })

  const cancelIntroMut = useMutation({
    mutationFn: (id: string) => adminApi.cancelIntroCommission(id),
    onSuccess: () => {
      toast.success('Introductory offer cancelled')
      invalidate()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to cancel introductory offer'),
  })

  const confirmCancelIntro = (u: AdminUserRow) => {
    const state = introState(u)
    const msg =
      state === 'active'
        ? `Cancel ${u.email}'s introductory offer? Their rate reverts to ${u.standard_commission_rate}% immediately.`
        : `Cancel the pending introductory offer for ${u.email}?`
    if (window.confirm(msg)) cancelIntroMut.mutate(u.id)
  }

  const startEditRate = (u: AdminUserRow) => {
    setEditingRateId(u.id)
    setRateInput(u.commission_rate ?? '')
  }

  const saveRate = (id: string) => {
    const rate = Number(rateInput)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
      toast.error('Enter a number between 0 and 100')
      return
    }
    rateMut.mutate({ id, rate })
  }

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  const confirmStatus = (u: AdminUserRow, s: 'active' | 'suspended' | 'banned') => {
    if (s !== 'active' && !window.confirm(`${s === 'banned' ? 'Ban' : 'Suspend'} ${u.email}?`)) return
    statusMut.mutate({ id: u.id, s })
  }

  const confirmDelete = (u: AdminUserRow) => {
    if (
      window.confirm(
        `Permanently delete ${u.email}? This removes their account and unlinks their models/orders. This cannot be undone.`,
      )
    )
      deleteMut.mutate(u.id)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search, filter and moderate accounts.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={onSearch} className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search email or name…"
            className="pl-9 pr-3 py-2 text-sm border border-border rounded-md w-64 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </form>
        <select
          value={role}
          onChange={(e) => {
            setPage(1)
            setRole(e.target.value)
          }}
          className="py-2 px-3 text-sm border border-border rounded-md"
        >
          <option value="">All roles</option>
          <option value="customer">Customers</option>
          <option value="artist">Artists</option>
          <option value="admin">Admins</option>
        </select>
        <select
          value={status}
          onChange={(e) => {
            setPage(1)
            setStatus(e.target.value)
          }}
          className="py-2 px-3 text-sm border border-border rounded-md"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-left">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Rate</th>
                <th className="px-4 py-3 font-medium text-right">Models</th>
                <th className="px-4 py-3 font-medium text-right">Orders</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-red-600">
                    Failed to load users.
                  </td>
                </tr>
              )}
              {data?.users.map((u) => (
                <tr key={u.id} className="cursor-pointer hover:bg-accent" onClick={() => setOpenUserId(u.id)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {u.artist_name || u.display_name}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge[u.role]}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[u.account_status]}`}
                    >
                      {u.account_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-foreground" onClick={(e) => e.stopPropagation()}>
                    {u.role !== 'artist' ? (
                      <span className="text-muted-foreground">—</span>
                    ) : editingRateId === u.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step="0.01"
                          autoFocus
                          value={rateInput}
                          onChange={(e) => setRateInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRate(u.id)
                            if (e.key === 'Escape') setEditingRateId(null)
                          }}
                          className="w-16 px-1.5 py-0.5 text-sm border border-border rounded-md text-right"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        <button
                          onClick={() => saveRate(u.id)}
                          disabled={rateMut.isPending}
                          className="text-primary hover:underline text-xs disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingRateId(null)}
                          className="text-muted-foreground hover:underline text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditRate(u)}
                        className="hover:underline"
                        title="Click to change this artist's share of each sale"
                      >
                        {u.commission_rate ? `${Number(u.commission_rate)}%` : '—'}
                      </button>
                    )}
                    {u.role === 'artist' && (
                      <div className="mt-0.5 text-xs">
                        {introState(u) === 'pending' && (
                          <span className="text-amber-600">
                            🎁 pending: {Number(u.intro_commission_rate)}% × {u.intro_commission_months}mo{' '}
                            <button onClick={() => setIntroModalUser(u)} className="underline">
                              edit
                            </button>{' '}
                            <button onClick={() => confirmCancelIntro(u)} className="underline">
                              cancel
                            </button>
                          </span>
                        )}
                        {introState(u) === 'active' && (
                          <span className="text-green-700">
                            🎁 until {fmtDate(u.intro_commission_ends_at!)}{' '}
                            <button onClick={() => confirmCancelIntro(u)} className="underline">
                              cancel
                            </button>
                          </span>
                        )}
                        {(introState(u) === 'none' || introState(u) === 'ended') && (
                          <button
                            onClick={() => setIntroModalUser(u)}
                            className="text-muted-foreground hover:underline"
                          >
                            {introState(u) === 'ended' ? `ended ${fmtDate(u.intro_commission_ends_at!)} · + new offer` : '+ intro offer'}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{u.model_count}</td>
                  <td className="px-4 py-3 text-right text-foreground">{u.order_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString('en-GB')}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {u.id === me?.id ? (
                      <span className="text-xs text-muted-foreground italic block text-right">You</span>
                    ) : (
                      <div className="flex justify-end gap-2 text-xs">
                        {u.role === 'artist' && (
                          <a
                            href={`/artists/${u.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary hover:underline"
                            title="Open their public artist page"
                          >
                            Profile <ExternalLink size={11} />
                          </a>
                        )}
                        {u.account_status === 'active' ? (
                          <>
                            <button
                              onClick={() => confirmStatus(u, 'suspended')}
                              className="text-amber-600 hover:underline"
                            >
                              Suspend
                            </button>
                            <button
                              onClick={() => confirmStatus(u, 'banned')}
                              className="text-red-600 hover:underline"
                            >
                              Ban
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => confirmStatus(u, 'active')}
                            className="text-green-600 hover:underline"
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          onClick={() => confirmDelete(u)}
                          className="text-muted-foreground hover:text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No users match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && data.pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} users
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

      {introModalUser && (
        <IntroOfferModal
          user={introModalUser}
          onClose={() => setIntroModalUser(null)}
          onSaved={() => {
            setIntroModalUser(null)
            invalidate()
          }}
        />
      )}

      {openUserId && <UserDetailPanel userId={openUserId} onClose={() => setOpenUserId(null)} />}
    </div>
  )
}

const userStatusBadge: Record<string, string> = {
  ready: 'bg-green-100 text-green-700',
  processing: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
}

const UserDetailPanel: React.FC<{ userId: string; onClose: () => void }> = ({ userId, onClose }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-user', userId],
    queryFn: () => adminApi.getUser(userId),
  })

  const user = data?.user
  const orders = data?.orders ?? []
  const models = data?.models ?? []
  const tables = data?.tables ?? []

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {user ? user.artist_name || user.display_name : 'User'}
          </h2>
          <div className="flex items-center gap-3">
            {user?.role === 'artist' && (
              <a
                href={`/artists/${user.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Public profile <ExternalLink size={14} />
              </a>
            )}
            <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent">
              <X size={20} />
            </button>
          </div>
        </div>

        {isLoading || !user ? (
          <div className="flex justify-center py-24">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="space-y-6 px-6 py-5">
            {/* Profile */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</p>
                <p className="mt-1 text-sm font-medium text-foreground">{user.email}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge[user.role]}`}>
                    {user.role}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[user.account_status]}`}
                  >
                    {user.account_status}
                  </span>
                  {user.shadow_banned && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      shadow-banned
                    </span>
                  )}
                  {user.is_super_admin && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                      owner
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</p>
                <p className="mt-1 text-sm text-foreground">Joined {fmtDate(user.created_at)}</p>
                <p className="text-xs text-muted-foreground">
                  {user.last_login ? `Last login ${fmtDate(user.last_login)}` : 'Never logged in'}
                </p>
                {user.role === 'artist' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Commission: {user.commission_rate ? `${Number(user.commission_rate)}%` : '—'}
                  </p>
                )}
                {user.total_spent && (
                  <p className="text-xs text-muted-foreground">Total spent: {formatPrice(user.total_spent)}</p>
                )}
              </div>
            </div>

            {/* Sale analytics (artists only) */}
            {user.role === 'artist' && <ArtistSaleAnalytics artistId={user.id} />}

            {/* Order history */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Order history ({orders.length})
              </p>
              {orders.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No orders placed.</p>
              ) : (
                <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {orders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{o.order_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {o.item_count} item{Number(o.item_count) === 1 ? '' : 's'} · {fmtDate(o.created_at)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm text-foreground">{formatPrice(o.total)}</p>
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            payBadge[o.payment_status] || 'bg-muted text-foreground'
                          }`}
                        >
                          {o.payment_status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Published / uploaded models */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Models ({models.length})
              </p>
              {models.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No models uploaded.</p>
              ) : (
                <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {models.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-muted">
                        {m.thumbnail_path && (
                          <img src={assetUrl(m.thumbnail_path)} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatPrice(m.base_price)} · {m.sale_count} sold · {m.view_count} views
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <span className="inline-block rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                          {m.status}
                        </span>
                        {m.processing_status && m.processing_status !== 'ready' && (
                          <span
                            className={`ml-1 inline-block rounded-full px-2 py-0.5 font-medium ${
                              userStatusBadge[m.processing_status] || 'bg-muted text-foreground'
                            }`}
                          >
                            {m.processing_status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Planner tables built */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tables built ({tables.length})
              </p>
              {tables.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No planner tables saved.</p>
              ) : (
                <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {tables.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Updated {fmtDate(t.updated_at)} · {t.view_count} views · {t.clone_count} clones
                        </p>
                      </div>
                      <div className="shrink-0 flex gap-1.5">
                        {t.is_artist_display && (
                          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                            display
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            t.is_public ? 'bg-green-100 text-green-700' : 'bg-muted text-foreground'
                          }`}
                        >
                          {t.is_public ? 'public' : 'private'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent activity */}
            {data && data.recentActivity.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</p>
                <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {data.recentActivity.map((a, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <span className="text-foreground">
                        {a.action}
                        {a.resource_type && <span className="text-muted-foreground"> · {a.resource_type}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(a.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const StatTile: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({
  icon,
  label,
  children,
}) => (
  <div className="rounded-lg border border-border bg-muted/50 p-2.5">
    <div className="flex items-center gap-1 text-muted-foreground">
      {icon}
      <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
    </div>
    <div className="mt-0.5 text-base font-semibold text-foreground">{children}</div>
  </div>
)

/** The same data as the artist's own Sales Overview dashboard (services/artistAnalytics.ts),
 * just fetched for :id instead of the caller's own account — so an admin sees what the
 * artist sees, without needing the artist to share a screenshot. Fixed 30-day window; the
 * artist's own dashboard has the date-range picker if a wider look is needed. */
const ArtistSaleAnalytics: React.FC<{ artistId: string }> = ({ artistId }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-artist-analytics-summary', artistId],
    queryFn: () => adminApi.getArtistSaleAnalytics(artistId),
  })
  const { data: products } = useQuery({
    queryKey: ['admin-artist-analytics-products', artistId],
    queryFn: () => adminApi.getArtistSaleProducts(artistId, undefined, 'gross'),
  })

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Sale analytics (last 30 days)
      </p>
      {isLoading || !data ? (
        <div className="mt-2 flex justify-center py-6">
          <Spinner size="sm" />
        </div>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile icon={<PoundSterling size={12} />} label="Net earnings">
              {formatPrice(data.totals.net)}
            </StatTile>
            <StatTile icon={<ShoppingBag size={12} />} label="Sales">{data.totals.sales}</StatTile>
            <StatTile icon={<Eye size={12} />} label="Views">{data.totals.views}</StatTile>
            <StatTile icon={<Target size={12} />} label="Conversion">
              {(data.totals.conversion * 100).toFixed(1)}%
            </StatTile>
            <StatTile icon={<TrendingUp size={12} />} label="Top model">
              {data.topModels[0] ? (
                <span className="line-clamp-1 text-sm">{data.topModels[0].name}</span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </StatTile>
          </div>

          {products && products.length > 0 && (
            <div className="mt-3 divide-y divide-border rounded-lg border border-border">
              {products.slice(0, 5).map((p) => (
                <div key={p.modelId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="truncate text-foreground">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {p.units} sold · {formatPrice(p.gross)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const IntroOfferModal: React.FC<{
  user: AdminUserRow
  onClose: () => void
  onSaved: () => void
}> = ({ user, onClose, onSaved }) => {
  const [introRate, setIntroRate] = useState('')
  const [months, setMonths] = useState('3')
  const [standardRate, setStandardRate] = useState(user.commission_rate ?? '85')

  const mut = useMutation({
    mutationFn: () =>
      adminApi.setIntroCommission(user.id, {
        introRate: Number(introRate),
        months: Number(months),
        standardRate: Number(standardRate),
      }),
    onSuccess: (res) => {
      toast.success(res.message)
      onSaved()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to set introductory offer'),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const rate = Number(introRate)
    const term = Number(months)
    const std = Number(standardRate)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
      toast.error('Introductory rate must be between 0 and 100')
      return
    }
    if (!Number.isInteger(term) || term <= 0 || term > 60) {
      toast.error('Months must be a whole number between 1 and 60')
      return
    }
    if (!Number.isFinite(std) || std <= 0 || std > 100) {
      toast.error('Standard rate must be between 0 and 100')
      return
    }
    mut.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-lg bg-card p-6 shadow-xl"
      >
        <div>
          <h2 className="text-lg font-semibold text-foreground">Introductory offer</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            For {user.artist_name || user.display_name} ({user.email}). The clock starts on their first
            published model, not today, then reverts automatically at the end of the term.
          </p>
        </div>

        <label className="block text-sm">
          <span className="text-foreground">Introductory rate (their share, %)</span>
          <input
            type="number"
            min={1}
            max={100}
            step="0.01"
            required
            autoFocus
            value={introRate}
            onChange={(e) => setIntroRate(e.target.value)}
            placeholder="e.g. 95"
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="text-foreground">Duration (months)</span>
          <input
            type="number"
            min={1}
            max={60}
            step="1"
            required
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="text-foreground">Standard rate to revert to (%)</span>
          <input
            type="number"
            min={1}
            max={100}
            step="0.01"
            required
            value={standardRate}
            onChange={(e) => setStandardRate(e.target.value)}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-muted-foreground hover:underline">
            Cancel
          </button>
          <button
            type="submit"
            disabled={mut.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Set offer'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default AdminUsers
