'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, X, Bell } from 'lucide-react'
import { notificationsApi, type Notification } from '@/lib/api'

interface DashboardLayoutProps {
  children: React.ReactNode
}

const menuItems = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Leads', href: '/dashboard/leads' },
  { label: 'Bookmarks', href: '/dashboard/bookmarks' },
  { label: 'Connections', href: '/dashboard/connections' },
  { label: 'Analytics', href: '/dashboard/analytics' },
  { label: 'Config', href: '/dashboard/config' },
]

/** How often to check for new-lead notifications. */
const POLL_MS = 30_000

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [feedOpen, setFeedOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false

    const load = () =>
      notificationsApi
        .list()
        .then(({ data, unread }) => {
          if (cancelled) return
          setNotifications(data)
          setUnread(unread)
        })
        // The app not being up yet is not worth an error in the UI chrome.
        .catch(() => undefined)

    void load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  async function openFeed() {
    const next = !feedOpen
    setFeedOpen(next)
    if (next && unread > 0) {
      await notificationsApi.markAllRead().catch(() => undefined)
      setUnread(0)
      setNotifications((current) => current.map((n) => ({ ...n, read: true })))
    }
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 fixed lg:relative w-64 h-screen bg-card border-r border-border/40 transition-transform duration-300 z-40 flex flex-col`}
      >
        <div className="p-6 border-b border-border/40">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">F</span>
            </div>
            <span className="font-bold text-lg">FindClients</span>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {menuItems.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                  active
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-foreground/70 hover:bg-primary/10 hover:text-primary'
                }`}
              >
                <span className="font-medium">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-border/40 text-xs text-foreground/40">
          Running locally · your data never leaves this machine
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-border/40 bg-card/50 backdrop-blur-sm flex items-center px-6 gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 hover:bg-secondary rounded-lg transition"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div className="flex-1" />

          <div className="relative">
            <button
              onClick={() => void openFeed()}
              className="p-2 hover:bg-secondary rounded-lg transition relative"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unread > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
              )}
            </button>

            {feedOpen && (
              <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-auto rounded-lg border border-border/40 bg-card shadow-lg z-50">
                {notifications.length === 0 ? (
                  <p className="p-4 text-sm text-foreground/50">Nothing yet.</p>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className="p-4 border-b border-border/40 last:border-0">
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.message && (
                        <p className="text-xs text-foreground/60 mt-1 line-clamp-2">{n.message}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 lg:hidden z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  )
}
