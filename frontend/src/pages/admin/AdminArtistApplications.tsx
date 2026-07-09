import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Copy, Trash2, Plus } from 'lucide-react'
import { adminApi, AdminInvite } from '../../api/endpoints/admin'
import Button from '../../components/ui/Button'

/**
 * Artist onboarding is invite-code based (there's no "application" table).
 * This page manages invite codes: create, share, and revoke them.
 */
const AdminArtistApplications: React.FC = () => {
  const qc = useQueryClient()
  const [maxUses, setMaxUses] = useState(1)
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'invites'],
    queryFn: adminApi.getInvites,
  })

  const createMut = useMutation({
    mutationFn: () =>
      adminApi.createInvite({
        maxUses,
        expiresInDays: expiresInDays === '' ? undefined : Number(expiresInDays),
      }),
    onSuccess: (res) => {
      toast.success(`Invite created: ${res.invite.code}`)
      qc.invalidateQueries({ queryKey: ['admin', 'invites'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create invite'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteInvite(id),
    onSuccess: () => {
      toast.success('Invite revoked')
      qc.invalidateQueries({ queryKey: ['admin', 'invites'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to revoke invite'),
  })

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(
      () => toast.success('Code copied'),
      () => toast.error('Could not copy'),
    )
  }

  const isExpired = (inv: AdminInvite) =>
    inv.expires_at ? new Date(inv.expires_at) < new Date() : false
  const isUsedUp = (inv: AdminInvite) => inv.current_uses >= inv.max_uses

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Artist Invites</h1>
        <p className="mt-1 text-sm text-gray-500">
          Artists join via invite code. Create a code and share it with a creator to onboard them.
        </p>
      </div>

      {/* Create */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Create invite code</h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-gray-500 mb-1">Max uses</span>
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value)))}
              className="w-24 py-2 px-3 border border-gray-300 rounded-md"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 mb-1">Expires in (days, optional)</span>
            <input
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Never"
              className="w-40 py-2 px-3 border border-gray-300 rounded-md"
            />
          </label>
          <Button
            onClick={() => createMut.mutate()}
            loading={createMut.isPending}
            leftIcon={<Plus size={16} />}
          >
            Create
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Uses</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Redeemed by</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-red-600">
                    Failed to load invites.
                  </td>
                </tr>
              )}
              {data?.invites.map((inv) => {
                const dead = isExpired(inv) || isUsedUp(inv)
                return (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => copyCode(inv.code)}
                        className="font-mono font-medium text-gray-900 inline-flex items-center gap-1.5 hover:text-indigo-600"
                        title="Copy code"
                      >
                        {inv.code}
                        <Copy size={13} className="text-gray-400" />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {inv.current_uses} / {inv.max_uses}
                    </td>
                    <td className="px-4 py-3">
                      {isExpired(inv) ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          Expired
                        </span>
                      ) : isUsedUp(inv) ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          Used up
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {inv.used_by_email || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {inv.expires_at
                        ? new Date(inv.expires_at).toLocaleDateString('en-GB')
                        : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          if (window.confirm(`Revoke invite code ${inv.code}?`))
                            deleteMut.mutate(inv.id)
                        }}
                        className="text-gray-400 hover:text-red-600 inline-flex items-center gap-1 text-xs"
                      >
                        <Trash2 size={14} /> Revoke
                      </button>
                    </td>
                  </tr>
                )
              })}
              {data && data.invites.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No invite codes yet. Create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default AdminArtistApplications
