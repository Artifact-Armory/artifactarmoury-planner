import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { notificationsApi, type AppNotification } from '../../api/endpoints/notifications'

const timeAgo = (iso: string): string => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const openPanel = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoadingList(true)
      try {
        setItems(await notificationsApi.list({ limit: 20 }))
      } finally {
        setLoadingList(false)
      }
    }
  }

  // Marking a notification read here only ever refreshed the bell's own badge —
  // a report-related type (moderation_decision/report_reply) also has its own
  // badge on the artist "Reports" nav link (queryKey 'artist-reports-unread'),
  // which never got the memo: it stayed stuck until the artist's next full visit
  // to that page. Invalidating it here too (harmless no-op if it isn't mounted)
  // clears it immediately, same as clicking straight into the Reports page would.
  const REPORT_TYPES = new Set(['moderation_decision', 'report_reply'])

  const handleClick = async (n: AppNotification) => {
    if (!n.isRead) {
      await notificationsApi.markRead(n.id).catch(() => {})
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)))
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
      if (REPORT_TYPES.has(n.type)) {
        queryClient.invalidateQueries({ queryKey: ['artist-reports-unread'] })
      }
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  const markAll = async () => {
    await notificationsApi.markAllRead().catch(() => {})
    setItems((list) => list.map((x) => ({ ...x, isRead: true })))
    queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
    queryClient.invalidateQueries({ queryKey: ['artist-reports-unread'] })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={openPanel}
        className="relative p-2 rounded-full hover:bg-accent focus:outline-hidden focus:ring-2 focus:ring-ring"
        aria-label="Notifications"
      >
        <Bell size={22} className="text-foreground" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 min-w-[20px] px-1 flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-black ring-opacity-5 z-50">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <button onClick={markAll} className="text-xs text-primary hover:text-primary/80">
              Mark all read
            </button>
          </div>
          {loadingList ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet. Follow artists to hear about new releases.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => handleClick(n)}
                    className={`block w-full px-4 py-3 text-left hover:bg-accent ${
                      n.isRead ? '' : 'bg-primary/5'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      <div className={n.isRead ? 'ml-4' : ''}>
                        <p className="text-sm font-medium text-foreground">{n.title}</p>
                        {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                        <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationBell
