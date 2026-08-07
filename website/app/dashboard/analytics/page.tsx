'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { useEffect, useState } from 'react'
import {
  TrendingUp,
  Bookmark,
  MessageSquare,
  CheckCircle,
  Loader2,
  Inbox,
  AlertTriangle,
  Check,
  X,
} from 'lucide-react'
import { ApiError, analyticsApi, type ScrapeRun } from '@/lib/api'

interface Overview {
  newLeads: number
  totalLeads: number
  bookmarked: number
  contacted: number
  won: number
  conversionRate: number
  last7d: number
}

interface PlatformCount {
  platform: string
  count: number
  percentage: number
}

interface TrendPoint {
  date: string
  count: number
}

const PLATFORM_LABELS: Record<string, string> = {
  upwork: 'Upwork',
  twitter: 'Twitter / X',
  discord: 'Discord',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string | number
  hint: string
  icon: React.ReactNode
}) {
  return (
    <div className="bg-card rounded-xl border border-border/40 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-foreground/60 text-sm mb-1">{label}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
        {icon}
      </div>
      <p className="text-xs text-foreground/50">{hint}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border/40 p-6">
      <h2 className="text-xl font-bold mb-6">{title}</h2>
      {children}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Inbox className="w-8 h-8 text-foreground/25" />
      <p className="text-sm text-foreground/50 max-w-xs">{message}</p>
    </div>
  )
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [platforms, setPlatforms] = useState<PlatformCount[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [runs, setRuns] = useState<ScrapeRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    Promise.all([
      analyticsApi.overview(),
      analyticsApi.platforms(),
      analyticsApi.trend(14),
      analyticsApi.scrapeRuns(),
    ])
      .then(([overview, platforms, trend, runs]) => {
        if (cancelled) return
        setOverview(overview)
        setPlatforms(platforms.data)
        setTrend(trend.data)
        setRuns(runs.data)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load your analytics')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-24 text-foreground/50">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading your analytics…
        </div>
      </DashboardLayout>
    )
  }

  if (error || !overview) {
    return (
      <DashboardLayout>
        <div className="p-6 max-w-2xl">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error || 'Could not load your analytics.'}
          </div>
        </div>
      </DashboardLayout>
    )
  }

  // Scale the trend bars against the busiest day so the shape stays readable
  // even when the absolute numbers are small.
  const peak = Math.max(1, ...trend.map((t) => t.count))

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Analytics</h1>
          <p className="text-foreground/60">Track your performance and lead statistics.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="Total leads"
            value={overview.totalLeads}
            hint={`${overview.newLeads} in the last 24 hours`}
            icon={<TrendingUp className="w-8 h-8 text-primary" />}
          />
          <StatCard
            label="Bookmarked"
            value={overview.bookmarked}
            hint="Leads you saved for later"
            icon={<Bookmark className="w-8 h-8 text-blue-500" />}
          />
          <StatCard
            label="Contacted"
            value={overview.contacted}
            hint={`${overview.last7d} new leads this week`}
            icon={<MessageSquare className="w-8 h-8 text-amber-500" />}
          />
          <StatCard
            label="Won"
            value={overview.won}
            hint={
              overview.contacted > 0
                ? `${overview.conversionRate}% of contacted leads`
                : 'No leads contacted yet'
            }
            icon={<CheckCircle className="w-8 h-8 text-emerald-500" />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Leads by platform */}
          <Panel title="Leads by platform">
            {platforms.length === 0 ? (
              <EmptyState message="No leads yet. Connect an account and the scrapers will start filling this in." />
            ) : (
              <div className="space-y-4">
                {platforms.map((item) => (
                  <div key={item.platform}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">
                        {PLATFORM_LABELS[item.platform] ?? item.platform}
                      </span>
                      <span className="text-sm text-foreground/60">
                        {item.count} · {item.percentage}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Leads discovered per day */}
          <Panel title="Leads found (last 14 days)">
            {trend.length === 0 ? (
              <EmptyState message="No leads discovered in the last two weeks." />
            ) : (
              <div className="flex items-end gap-1 h-40" role="img" aria-label="Leads found per day">
                {trend.map((point) => (
                  <div
                    key={point.date}
                    className="flex-1 flex flex-col items-center justify-end gap-1 group"
                    title={`${new Date(point.date).toLocaleDateString()}: ${point.count} lead${
                      point.count === 1 ? '' : 's'
                    }`}
                  >
                    <span className="text-[10px] font-medium text-foreground/60 opacity-0 group-hover:opacity-100 transition">
                      {point.count}
                    </span>
                    <div
                      className="w-full bg-accent rounded-t group-hover:bg-primary transition-colors"
                      style={{ height: `${Math.max(4, (point.count / peak) * 100)}%` }}
                    />
                    <span className="text-[10px] text-foreground/40">
                      {new Date(point.date).getDate()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Scraping history */}
        <Panel title="Recent scraping activity">
          {runs.length === 0 ? (
            <EmptyState message="No scrape runs yet. Connect an account under Connections, then hit “Scrape now”." />
          ) : (
            <div className="space-y-2">
              {runs.map((run) => {
                const failed = run.status === 'error'
                const active = run.status === 'running'
                return (
                  <div
                    key={run.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg hover:bg-secondary transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          failed
                            ? 'bg-destructive/10 text-destructive'
                            : active
                              ? 'bg-secondary text-foreground/50'
                              : 'bg-emerald-500/10 text-emerald-500'
                        }`}
                      >
                        {failed ? (
                          <X className="w-4 h-4" />
                        ) : active ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">
                          {PLATFORM_LABELS[run.platform] ?? run.platform}
                        </p>
                        <p className="text-sm text-foreground/60">
                          {new Date(run.startedAt).toLocaleString()}
                        </p>
                        {failed && run.error && (
                          <p className="text-xs text-destructive mt-0.5 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span className="truncate">{run.error}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-semibold text-accent">+{run.inserted}</p>
                      <p className="text-xs text-foreground/50">of {run.found} found</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>
    </DashboardLayout>
  )
}
