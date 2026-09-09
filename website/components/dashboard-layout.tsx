'use client'

import { Popover } from '@base-ui/react/popover'
import {
  Bell,
  Bookmark,
  ChartNoAxesColumn,
  LayoutDashboard,
  Loader2,
  Menu,
  Plug,
  Radio,
  SlidersHorizontal,
  Target,
  TriangleAlert,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { Wordmark } from '@/components/brand'
import { notificationsApi, type Notification } from '@/lib/api'
import { describePlatforms, useScrapeStatus } from '@/lib/use-scrape-status'
import { describeWatchState, useWatchStatus } from '@/lib/use-watch-status'
import { cn } from '@/lib/utils'

interface DashboardLayoutProps {
  children: React.ReactNode
}

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  /** Marks the item that carries the unread job-alert count. */
  badge?: 'opportunities'
}

/**
 * Two groups, because the seven screens do two different jobs: five you use
 * daily, two you set up once.
 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
      {
        label: 'Opportunities',
        href: '/dashboard/opportunities',
        icon: Radio,
        badge: 'opportunities',
      },
      { label: 'Leads', href: '/dashboard/leads', icon: Target },
      { label: 'Bookmarks', href: '/dashboard/bookmarks', icon: Bookmark },
      { label: 'Analytics', href: '/dashboard/analytics', icon: ChartNoAxesColumn },
    ],
  },
  {
    label: 'Setup',
    items: [
      { label: 'Connections', href: '/dashboard/connections', icon: Plug },
      { label: 'Config', href: '/dashboard/config', icon: SlidersHorizontal },
    ],
  },
]

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items)

/** How often to check for new-lead notifications. */
const POLL_MS = 30_000

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const pathname = usePathname()

  const loadNotifications = useCallback(async () => {
    try {
      const { data, unread } = await notificationsApi.list()
      setNotifications(data)
      setUnread(unread)
    } catch {
      // The app not being up yet is not worth an error in the UI chrome.
    }
  }, [])

  // Declared after loadNotifications on purpose: it is a `const`, so reading it
  // above its own initialiser is a temporal-dead-zone crash, not a hoist.
  //
  // Lives in the layout so a running scrape is visible on every page, not only
  // the two that happened to ask for it. A scrape can start from the scheduler
  // or another tab, so the page you are on has no other way to know. Refreshing
  // notifications on the finished edge means new-lead alerts land immediately.
  const scrape = useScrapeStatus(loadNotifications)

  // The Upwork watcher runs on its own clock, so the sidebar badge and the
  // header pill are the only places most people will ever see it working.
  const watch = useWatchStatus(loadNotifications)

  useEffect(() => {
    void loadNotifications()
    const timer = setInterval(() => void loadNotifications(), POLL_MS)
    return () => clearInterval(timer)
  }, [loadNotifications])

  // Close the mobile drawer on navigation rather than in every link handler.
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  async function onFeedOpenChange(open: boolean) {
    if (!open || unread === 0) return
    await notificationsApi.markAllRead().catch(() => undefined)
    setUnread(0)
    setNotifications((current) => current.map((n) => ({ ...n, read: true })))
  }

  const current =
    ALL_ITEMS.find((item) => item.href === pathname) ??
    ALL_ITEMS.find(
      (item) => item.href !== '/dashboard' && pathname.startsWith(item.href),
    )

  const browserDown = scrape.browser && !scrape.browser.reachable

  const watchState = describeWatchState(watch.watcher)
  const watchLive =
    watch.watcher?.enabled &&
    (watch.watcher.state === 'watching' || watch.watcher.state === 'checking')

  return (
    <div className="flex min-h-screen bg-background">
      {/* Backdrop for the mobile drawer. */}
      <div
        onClick={() => setSidebarOpen(false)}
        aria-hidden
        className={cn(
          'fixed inset-0 z-30 bg-graphite-950/70 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden',
          sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-sidebar',
          'transition-transform duration-200 ease-out-quint lg:translate-x-0',
          sidebarOpen ? 'translate-x-0 shadow-drawer' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href="/dashboard" className="min-w-0 rounded-md">
            <Wordmark />
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
            className="ml-auto -mr-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 pb-1 text-[0.6875rem] leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = item.href === current?.href
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium',
                      'transition-colors duration-150 ease-out',
                      active
                        ? 'bg-gold-500/10 text-primary'
                        : 'text-graphite-400 hover:bg-secondary/70 hover:text-foreground',
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute inset-y-1.5 -left-3 w-0.5 rounded-full bg-primary"
                      />
                    )}
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                    {item.badge === 'opportunities' && watch.unseen > 0 && (
                      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-foreground tabular">
                        {watch.unseen > 99 ? '99+' : watch.unseen}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-border px-4 py-4">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'size-1.5 rounded-full',
                browserDown ? 'bg-destructive' : 'bg-success',
              )}
              aria-hidden
            />
            <p className="text-[0.8125rem] font-medium text-graphite-300">
              Running locally
            </p>
          </div>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            Leads, sessions and config stay on this machine.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
          >
            <Menu className="size-4" />
          </button>

          <p className="truncate font-display text-sm font-semibold">
            {current?.label ?? 'Overview'}
          </p>

          <div className="flex-1" />

          {/* The watcher is deliberately quiet and slow, so the one place it
              can prove it is alive is here, on every screen. */}
          {watchLive && (
            <span
              className="inline-flex h-8 items-center gap-2 rounded-md border border-success/25 bg-success/10 px-2.5 text-[0.8125rem] font-medium text-success"
              title={watch.watcher?.detail}
            >
              <Radio
                className={cn('size-3.5', watch.watcher?.state === 'checking' && 'animate-pulse')}
                aria-hidden
              />
              <span className="hidden sm:inline">{watchState.label} Upwork</span>
            </span>
          )}

          {/* Visible on every page, however the run was started. */}
          {scrape.running && (
            <span className="inline-flex h-8 items-center gap-2 rounded-md border border-gold-500/25 bg-gold-500/10 px-2.5 text-[0.8125rem] font-medium text-gold-400">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              <span className="hidden sm:inline">
                Scraping {describePlatforms(scrape.runs)}
              </span>
              <span className="sm:hidden">Scraping</span>
            </span>
          )}

          <Popover.Root onOpenChange={(open) => void onFeedOpenChange(open)}>
            <Popover.Trigger
              aria-label={
                unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
              }
              className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[popup-open]:bg-secondary data-[popup-open]:text-foreground"
            >
              <Bell className="size-4" />
              {unread > 0 && (
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full border-2 border-background bg-primary" />
              )}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="end" sideOffset={8}>
                <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] origin-top overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-popover transition-[opacity,transform] duration-150 ease-out data-closed:scale-[0.98] data-closed:opacity-0 data-open:scale-100 data-open:opacity-100">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <p className="font-display text-sm font-semibold">
                      Notifications
                    </p>
                    <span className="text-xs text-muted-foreground tabular">
                      {notifications.length}
                    </span>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No alerts yet. New Upwork jobs and matching leads show up here.
                    </p>
                  ) : (
                    <ul className="max-h-80 overflow-y-auto">
                      {notifications.map((n) => (
                        <li
                          key={n.id}
                          className="border-b border-border px-4 py-3 last:border-0"
                        >
                          <p className="text-sm font-medium">{n.title}</p>
                          {n.message && (
                            <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-5 text-muted-foreground">
                              {n.message}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </header>

        {/* The browser we scrape with is gone. Nothing will work until it is
            back, so say so on every page rather than only where it is noticed. */}
        {browserDown && scrape.browser && (
          <div className="flex items-start gap-3 border-b border-destructive/25 bg-destructive/10 px-4 py-3 sm:px-6">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 text-[0.8125rem] leading-5">
              <p className="font-medium text-foreground">
                Chrome is not running — scraping and signing in are paused.
              </p>
              <p className="mt-0.5 text-muted-foreground">
                FindClients drives the Chrome you start yourself at{' '}
                <code className="rounded-xs bg-graphite-800 px-1 py-0.5 font-mono text-xs text-graphite-300">
                  {scrape.browser.url}
                </code>
                . Run{' '}
                <code className="rounded-xs bg-graphite-800 px-1 py-0.5 font-mono text-xs text-graphite-300">
                  npm run chrome
                </code>{' '}
                and leave that window open.
              </p>
            </div>
          </div>
        )}

        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
