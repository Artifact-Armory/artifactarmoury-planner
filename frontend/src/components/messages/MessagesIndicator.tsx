import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { messagesApi } from '../../api/endpoints/messages'

// Header icon linking to the messages inbox, with a polled unread badge — mirrors
// NotificationBell's polling cadence.
const MessagesIndicator: React.FC = () => {
  const { data: unread = 0 } = useQuery({
    queryKey: ['messages-unread'],
    queryFn: () => messagesApi.unreadCount(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  return (
    <Link
      to="/dashboard/messages"
      className="relative p-2 rounded-full hover:bg-accent focus:outline-hidden focus:ring-2 focus:ring-ring"
      aria-label="Messages"
    >
      <MessageSquare size={22} className="text-foreground" />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 min-w-[20px] px-1 flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}

export default MessagesIndicator
