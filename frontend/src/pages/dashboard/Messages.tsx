import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Send, ShieldCheck, User as UserIcon, Flag } from 'lucide-react'
import toast from 'react-hot-toast'
import { messagesApi, type ChatMessage } from '../../api/endpoints/messages'
import { useAuthStore } from '../../store/authStore'
import { containsAbuse, ABUSE_BLOCK_MESSAGE } from '../../utils/profanity'
import ReportConversationModal from '../../components/messages/ReportConversationModal'

const SITE_NAME = 'Artifact Armoury'

const timeAgo = (iso: string | null): string => {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const Messages: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('c')
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: conversations = [], isLoading: loadingList } = useQuery({
    queryKey: ['messages-list'],
    queryFn: () => messagesApi.list(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const { data: thread } = useQuery({
    queryKey: ['messages-thread', selectedId],
    queryFn: () => messagesApi.get(selectedId as string),
    enabled: !!selectedId,
    refetchInterval: 15_000,
  })

  // Opening a thread marks it read server-side — refresh the badges.
  useEffect(() => {
    if (selectedId) {
      queryClient.invalidateQueries({ queryKey: ['messages-unread'] })
      queryClient.invalidateQueries({ queryKey: ['messages-list'] })
    }
  }, [selectedId, thread, queryClient])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages.length, selectedId])

  const conv = thread?.conversation
  const isSystem = conv?.kind === 'system'
  const canReply = conv ? (conv.kind === 'direct' || conv.allowReplies) : false
  const headerName = isSystem ? SITE_NAME : conv?.otherName || 'Conversation'

  const handleSend = async () => {
    if (!selectedId || !draft.trim() || sending) return
    if (containsAbuse(draft)) {
      toast.error(ABUSE_BLOCK_MESSAGE)
      return
    }
    setSending(true)
    try {
      await messagesApi.send(selectedId, draft.trim())
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: ['messages-thread', selectedId] })
      queryClient.invalidateQueries({ queryKey: ['messages-list'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not send message')
    } finally {
      setSending(false)
    }
  }

  const mine = (m: ChatMessage): boolean => !m.isSystem && !!m.senderId && m.senderId === user?.id

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Messages</h1>
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:grid-cols-[320px_1fr] md:h-[70vh]">
        {/* Conversation list */}
        <aside className={`border-r border-gray-200 md:overflow-y-auto ${selectedId ? 'hidden md:block' : ''}`}>
          {loadingList ? (
            <p className="p-6 text-center text-sm text-gray-400">Loading…</p>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              <MessageSquare className="mx-auto mb-2 text-gray-300" size={28} />
              No conversations yet. Message an artist from their page to start one.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {conversations.map((c) => {
                const name = c.kind === 'system' ? SITE_NAME : c.otherName || 'Unknown'
                const active = c.id === selectedId
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setSearchParams({ c: c.id })}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 ${
                        active ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200">
                        {c.kind === 'system' ? (
                          <ShieldCheck size={18} className="text-indigo-600" />
                        ) : c.otherAvatar ? (
                          <img src={c.otherAvatar} alt={name} className="h-full w-full object-cover" />
                        ) : (
                          <UserIcon size={18} className="text-gray-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-gray-900">{name}</p>
                          <span className="flex-shrink-0 text-xs text-gray-400">{timeAgo(c.lastMessageAt)}</span>
                        </div>
                        <p className="truncate text-xs text-gray-500">
                          {c.lastMessagePreview || 'No messages yet'}
                        </p>
                      </div>
                      {c.unread > 0 && (
                        <span className="mt-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1 text-xs text-white">
                          {c.unread > 9 ? '9+' : c.unread}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Thread */}
        <section className={`flex flex-col ${selectedId ? '' : 'hidden md:flex'}`}>
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-400">
              Select a conversation to read and reply.
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
                <button
                  onClick={() => setSearchParams({})}
                  className="text-sm text-indigo-600 md:hidden"
                >
                  ← Back
                </button>
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gray-200">
                  {isSystem ? (
                    <ShieldCheck size={16} className="text-indigo-600" />
                  ) : conv?.otherAvatar ? (
                    <img src={conv.otherAvatar} alt={headerName} className="h-full w-full object-cover" />
                  ) : (
                    <UserIcon size={16} className="text-gray-500" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{headerName}</p>
                  {isSystem ? (
                    <p className="text-xs text-indigo-600">Official message</p>
                  ) : (
                    conv?.otherRole === 'artist' && <p className="text-xs text-gray-400">Artist</p>
                  )}
                </div>
                {!isSystem && (
                  <button
                    onClick={() => setReportOpen(true)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:border-red-200 hover:text-red-600"
                    title="Report this conversation"
                  >
                    <Flag size={14} />
                    Report
                  </button>
                )}
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
                {conv?.subject && isSystem && (
                  <p className="text-center text-sm font-semibold text-gray-700">{conv.subject}</p>
                )}
                {(thread?.messages ?? []).map((m) => {
                  const isMine = mine(m)
                  return (
                    <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                          isMine
                            ? 'bg-indigo-600 text-white'
                            : m.isSystem
                            ? 'border border-indigo-100 bg-indigo-50 text-gray-800'
                            : 'border border-gray-200 bg-white text-gray-800'
                        }`}
                      >
                        {!isMine && (
                          <p className="mb-0.5 text-xs font-medium opacity-70">
                            {m.isSystem ? SITE_NAME : m.senderName || 'User'}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`mt-1 text-[10px] ${isMine ? 'text-indigo-100' : 'text-gray-400'}`}>
                          {timeAgo(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {canReply ? (
                <div className="flex items-end gap-2 border-t border-gray-200 p-3">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    rows={1}
                    placeholder="Write a message…"
                    className="max-h-32 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!draft.trim() || sending}
                    className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Send size={16} />
                    Send
                  </button>
                </div>
              ) : (
                <div className="border-t border-gray-200 p-3 text-center text-xs text-gray-400">
                  This is an announcement — you can’t reply.
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {reportOpen && selectedId && conv && !isSystem && (
        <ReportConversationModal
          conversationId={selectedId}
          otherName={conv.otherName || 'this user'}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  )
}

export default Messages
