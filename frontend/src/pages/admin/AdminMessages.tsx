import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Send, Mail, Inbox } from 'lucide-react'
import toast from 'react-hot-toast'
import { messagesApi, type ChatMessage } from '../../api/endpoints/messages'

import { SITE_NAME } from '../../config/brand'

const timeAgo = (iso: string | null): string => {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const AdminMessages: React.FC = () => {
  const queryClient = useQueryClient()

  // Broadcast form
  const [bSubject, setBSubject] = useState('')
  const [bBody, setBBody] = useState('')
  const [audience, setAudience] = useState<'all' | 'customers' | 'artists'>('all')
  const [bSending, setBSending] = useState(false)

  // Direct message form
  const [email, setEmail] = useState('')
  const [dSubject, setDSubject] = useState('')
  const [dBody, setDBody] = useState('')
  const [dSending, setDSending] = useState(false)

  // Thread viewer
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)

  const { data: threads = [], refetch: refetchThreads } = useQuery({
    queryKey: ['admin-message-threads'],
    queryFn: () => messagesApi.adminThreads(),
    refetchInterval: 30_000,
  })

  const { data: thread } = useQuery({
    queryKey: ['admin-message-thread', openThreadId],
    queryFn: () => messagesApi.get(openThreadId as string),
    enabled: !!openThreadId,
    refetchInterval: 15_000,
  })

  const sendBroadcast = async () => {
    if (!bSubject.trim() || !bBody.trim() || bSending) return
    setBSending(true)
    try {
      const res = await messagesApi.adminBroadcast({ subject: bSubject.trim(), body: bBody.trim(), audience })
      toast.success(`Broadcast sent to ${res.recipients} user${res.recipients === 1 ? '' : 's'}`)
      setBSubject('')
      setBBody('')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not send broadcast')
    } finally {
      setBSending(false)
    }
  }

  const sendDm = async () => {
    if (!email.trim() || !dBody.trim() || dSending) return
    setDSending(true)
    try {
      const conversationId = await messagesApi.adminDm({
        email: email.trim(),
        subject: dSubject.trim() || undefined,
        body: dBody.trim(),
      })
      toast.success('Message sent')
      setEmail('')
      setDSubject('')
      setDBody('')
      refetchThreads()
      setOpenThreadId(conversationId)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not send message')
    } finally {
      setDSending(false)
    }
  }

  const sendReply = async () => {
    if (!openThreadId || !reply.trim() || replying) return
    setReplying(true)
    try {
      await messagesApi.send(openThreadId, reply.trim())
      setReply('')
      await queryClient.invalidateQueries({ queryKey: ['admin-message-thread', openThreadId] })
      refetchThreads()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not send reply')
    } finally {
      setReplying(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200'

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Site messages</h1>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Broadcast */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-xs">
          <div className="mb-4 flex items-center gap-2">
            <Megaphone size={20} className="text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Broadcast announcement</h2>
          </div>
          <p className="mb-4 text-sm text-gray-500">
            One-way message delivered to every user in the audience. Recipients can’t reply.
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value as any)} className={inputCls}>
                <option value="all">All users</option>
                <option value="customers">Customers only</option>
                <option value="artists">Artists only</option>
              </select>
            </div>
            <input
              value={bSubject}
              onChange={(e) => setBSubject(e.target.value)}
              placeholder="Subject"
              maxLength={255}
              className={inputCls}
            />
            <textarea
              value={bBody}
              onChange={(e) => setBBody(e.target.value)}
              placeholder="Announcement message…"
              rows={5}
              maxLength={5000}
              className={inputCls}
            />
            <button
              onClick={sendBroadcast}
              disabled={!bSubject.trim() || !bBody.trim() || bSending}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Send size={16} />
              {bSending ? 'Sending…' : 'Send broadcast'}
            </button>
          </div>
        </div>

        {/* Direct message */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-xs">
          <div className="mb-4 flex items-center gap-2">
            <Mail size={20} className="text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Message a user</h2>
          </div>
          <p className="mb-4 text-sm text-gray-500">
            Sends a message from {SITE_NAME} to one user. They can reply, creating a support thread.
          </p>
          <div className="space-y-3">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Recipient email"
              className={inputCls}
            />
            <input
              value={dSubject}
              onChange={(e) => setDSubject(e.target.value)}
              placeholder="Subject (optional)"
              maxLength={255}
              className={inputCls}
            />
            <textarea
              value={dBody}
              onChange={(e) => setDBody(e.target.value)}
              placeholder="Message…"
              rows={5}
              maxLength={5000}
              className={inputCls}
            />
            <button
              onClick={sendDm}
              disabled={!email.trim() || !dBody.trim() || dSending}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Send size={16} />
              {dSending ? 'Sending…' : 'Send message'}
            </button>
          </div>
        </div>
      </div>

      {/* Support threads */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-xs">
        <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-4">
          <Inbox size={20} className="text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Support threads</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[320px_1fr]">
          <ul className="max-h-[420px] divide-y divide-gray-100 overflow-y-auto border-r border-gray-200">
            {threads.length === 0 ? (
              <li className="p-5 text-center text-sm text-gray-400">No support threads yet.</li>
            ) : (
              threads.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setOpenThreadId(t.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-50 ${
                      t.id === openThreadId ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-gray-900">{t.userName}</p>
                      {t.awaitingReply && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          Needs reply
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-gray-500">{t.userEmail}</p>
                    <p className="truncate text-xs text-gray-400">{t.lastMessagePreview || ''}</p>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="flex min-h-[420px] flex-col">
            {!openThreadId ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-400">
                Select a thread to view and reply.
              </div>
            ) : (
              <>
                <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
                  {(thread?.messages ?? []).map((m: ChatMessage) => {
                    const fromSite = m.isSystem
                    return (
                      <div key={m.id} className={`flex ${fromSite ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                            fromSite ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-800'
                          }`}
                        >
                          <p className="mb-0.5 text-xs font-medium opacity-70">
                            {fromSite ? SITE_NAME : m.senderName || 'User'}
                          </p>
                          <p className="whitespace-pre-wrap wrap-break-word">{m.body}</p>
                          <p className={`mt-1 text-[10px] ${fromSite ? 'text-indigo-100' : 'text-gray-400'}`}>
                            {timeAgo(m.createdAt)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-end gap-2 border-t border-gray-200 p-3">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendReply()
                      }
                    }}
                    rows={1}
                    placeholder="Reply as Artifact Armoury…"
                    className="max-h-32 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                  />
                  <button
                    onClick={sendReply}
                    disabled={!reply.trim() || replying}
                    className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Send size={16} />
                    Reply
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminMessages
