import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Paperclip, Mail, CheckCircle2, RotateCcw, Loader2, User as UserIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminContactApi, ContactStatus } from '../../api/endpoints/adminContact'
import Spinner from '../../components/ui/Spinner'

const FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
]

const AdminContactMessages: React.FC = () => {
  const [filter, setFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-contact', filter],
    queryFn: () => adminContactApi.list(filter || undefined),
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center gap-3">
        <Mail className="text-primary" size={24} />
        <h1 className="text-2xl font-semibold text-foreground">Contact messages</h1>
        {data && data.unreadCount > 0 && (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-700">{data.unreadCount} new</span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Submissions from the public Contact page. Each one is also emailed to support — this is just a way to see the backlog without a database console.
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
      ) : (data?.messages.length ?? 0) === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
          Nothing here. {filter ? 'No resolved messages yet.' : 'The inbox is empty.'}
        </div>
      ) : (
        <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
          {data!.messages.map((m) => (
            <button
              key={m.id}
              onClick={() => setOpenId(m.id)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-accent"
            >
              {!m.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" title="Unread" />}
              {m.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-transparent" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={`truncate text-sm ${m.is_read ? 'text-foreground' : 'font-semibold text-foreground'}`}>{m.subject}</p>
                  {m.status === 'resolved' && <span className="shrink-0 rounded-sm bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">Resolved</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {m.name} &lt;{m.email}&gt;{m.user_display_name && <span className="ml-1">· {m.user_display_name}</span>}
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{m.message}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                {new Date(m.created_at).toLocaleDateString()}
                {m.attachment_count > 0 && <span className="flex items-center gap-0.5"><Paperclip size={11} />{m.attachment_count}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {openId && <DetailPanel messageId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

const DetailPanel: React.FC<{ messageId: string; onClose: () => void }> = ({ messageId, onClose }) => {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-contact-message', messageId],
    queryFn: () => adminContactApi.get(messageId),
  })

  const setStatus = useMutation({
    mutationFn: (status: ContactStatus) => adminContactApi.setStatus(messageId, status),
    onSuccess: (res) => {
      toast.success(res.message.status === 'resolved' ? 'Marked resolved' : 'Reopened')
      qc.invalidateQueries({ queryKey: ['admin-contact'] })
      qc.invalidateQueries({ queryKey: ['admin-contact-message', messageId] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Action failed'),
  })

  const message = data?.message
  const mailtoHref = message
    ? `mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`
    : undefined

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Message</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"><X size={20} /></button>
        </div>

        {isLoading || !data || !message ? (
          <div className="flex justify-center py-24"><Spinner size="lg" /></div>
        ) : (
          <div className="space-y-6 px-6 py-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">{message.subject}</h3>
                {message.status === 'resolved' && (
                  <span className="rounded-sm bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Resolved</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</p>
            </div>

            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">From</p>
              <p className="mt-1 text-sm font-medium text-foreground">{message.name}</p>
              <p className="text-xs text-muted-foreground">{message.email}</p>
              {message.user_id ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <UserIcon size={12} />
                  {message.user_display_name || message.user_email} ({message.user_role}) — signed-in account
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Not signed in when sent</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{message.message}</p>
            </div>

            {data.attachments.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments ({data.attachments.length})</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {data.attachments.map((a) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="group relative block h-24 w-24 overflow-hidden rounded-lg border border-border bg-muted">
                      {a.content_type?.startsWith('image/') ? (
                        <img src={a.url} alt={a.file_name ?? ''} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-muted-foreground"><Paperclip size={16} />{a.file_name ?? 'file'}</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {message.status === 'resolved' && message.resolved_by_name && (
              <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                Marked resolved by {message.resolved_by_name}
                {message.resolved_at && <> on {new Date(message.resolved_at).toLocaleString()}</>}
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border pt-5">
              <a
                href={mailtoHref}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
              >
                <Mail size={14} /> Reply by email
              </a>
              {message.status === 'open' ? (
                <button
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('resolved')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                >
                  {setStatus.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Mark resolved
                </button>
              ) : (
                <button
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('open')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
                >
                  {setStatus.isPending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Reopen
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminContactMessages
