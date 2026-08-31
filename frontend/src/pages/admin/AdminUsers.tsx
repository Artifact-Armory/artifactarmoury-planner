import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Search } from 'lucide-react'
import { adminApi, AdminUserRow } from '../../api/endpoints/admin'
import { useAuthStore } from '../../store/authStore'

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
                <tr key={u.id} className="hover:bg-accent">
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
                  <td className="px-4 py-3 text-right text-foreground">
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
                  <td className="px-4 py-3">
                    {u.id === me?.id ? (
                      <span className="text-xs text-muted-foreground italic block text-right">You</span>
                    ) : (
                      <div className="flex justify-end gap-2 text-xs">
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
