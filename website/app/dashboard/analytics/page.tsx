'use client'

import { Check, Inbox, Loader2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import DashboardLayout from '@/components/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Alert,
  EmptyState,
  SkeletonCard,
  LoadingRow,
} from '@/components/ui/feedback'
import { Eyebrow, Meter, PageHeader, PageShell } from '@/components/ui/page'
import { ApiError, analyticsApi, type ScrapeRun } from '@/lib/api'
import { platformLabel } from '@/lib/platforms'
import { cn } from '@/lib/utils'

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

function StatTile({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string
  value: string | number
  hint: string
  emphasis?: boolean
}) {
  return (
    <Card className="p-5">
      <Eyebrow>{label}</Eyebrow>
      <p
        className={cn(
          'mt-3 font-display text-[1.75rem] leading-9 font-semibold tracking-[-0.02em] tabular',
          emphasis ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
        {hint}
      </p>
    </Card>
  )
}

/**
 * Bars are scaled against the busiest day so the shape stays readable when the
 * absolute numbers are small. A zero day still draws a 2px stub, so a gap in
 * the run history is visibly a zero rather than a missing bar.
 */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const peak = Math.max(1, ...points.map((p) => p.count))
  return (
    <figure className="space-y-3">
      <div className="flex h-40 items-end gap-1.5" role="list">
        {points.map((point) => {
          const date = new Date(point.date)
          return (
            <div
              key={point.date}
              role="listitem"
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${date.toLocaleDateString()}: ${point.count} lead${
                point.count === 1 ? '' : 's'
              }`}
            >
              <span className="mb-1.5 text-center text-[0.6875rem] leading-3 font-medium text-graphite-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {point.count}
              </span>
              <div
                className="w-full rounded-xs bg-gold-700 transition-colors duration-150 group-hover:bg-primary"
                style={{
                  height: `${Math.max(2, (point.count / peak) * 100)}%`,
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1.5 border-t border-border pt-2">
        {points.map((point, index) => (
          <span
            key={point.date}
            className="flex-1 text-center text-[0.6875rem] leading-4 text-muted-foreground tabular"
          >
            {index % 2 === 0 ? new Date(point.date).getDate() : ''}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        Leads discovered per day over the last {points.length} days.
      </figcaption>
    </figure>
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
          setError(
            err instanceof ApiError ? err.message : 'Could not load your analytics',
          )
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
        <PageShell className="space-y-6">
          <PageHeader
            title="Analytics"
            description="How much the scrapers are finding, and how much of it you act on."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <LoadingRow label="Loading your analytics" />
        </PageShell>
      </DashboardLayout>
    )
  }

  if (error || !overview) {
    return (
      <DashboardLayout>
        <PageShell width="narrow" className="space-y-6">
          <PageHeader
            title="Analytics"
            description="How much the scrapers are finding, and how much of it you act on."
          />
          <Alert
            tone="danger"
            title={error || 'Could not load your analytics.'}
          />
        </PageShell>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <PageShell className="space-y-6">
        <PageHeader
          title="Analytics"
          description="How much the scrapers are finding, and how much of it you act on."
        />

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Total leads"
            value={overview.totalLeads}
            hint={`${overview.newLeads} found in the last 24 hours`}
            emphasis
          />
          <StatTile
            label="Bookmarked"
            value={overview.bookmarked}
            hint="Saved for a closer look"
          />
          <StatTile
            label="Contacted"
            value={overview.contacted}
            hint={`${overview.last7d} new leads this week`}
          />
          <StatTile
            label="Won"
            value={overview.won}
            hint={
              overview.contacted > 0
                ? `${overview.conversionRate}% of leads you contacted`
                : 'No leads contacted yet'
            }
          />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Leads by platform</CardTitle>
            </CardHeader>
            <CardContent>
              {platforms.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="Nothing to compare yet"
                  description="Connect an account and the scrapers will start filling this in."
                />
              ) : (
                <ul className="space-y-4">
                  {platforms.map((item) => (
                    <li key={item.platform}>
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium">
                          {platformLabel(item.platform)}
                        </span>
                        <span className="text-[0.8125rem] text-muted-foreground tabular">
                          {item.count} · {item.percentage}%
                        </span>
                      </div>
                      <Meter value={item.percentage} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Leads found</CardTitle>
              <span className="text-[0.8125rem] text-muted-foreground">
                Last 14 days
              </span>
            </CardHeader>
            <CardContent>
              {trend.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="No leads in the last two weeks"
                  description="Run a scrape, or widen your keywords, and this chart will start to fill."
                />
              ) : (
                <TrendChart points={trend} />
              )}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Recent scrape runs</CardTitle>
          </CardHeader>
          {runs.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No runs yet"
              description="Connect an account under Connections, then start a scrape from the Leads page."
            />
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((run) => {
                const failed = run.status === 'error'
                const active = run.status === 'running'
                return (
                  <li
                    key={run.id}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-md border',
                          failed
                            ? 'border-destructive/25 bg-destructive/10 text-destructive'
                            : active
                              ? 'border-border bg-secondary text-muted-foreground'
                              : 'border-success/25 bg-success/10 text-success',
                        )}
                      >
                        {failed ? (
                          <X className="size-3.5" />
                        ) : active ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {platformLabel(run.platform)}
                        </p>
                        <p className="text-[0.8125rem] text-muted-foreground">
                          {new Date(run.startedAt).toLocaleString()}
                        </p>
                        {failed && run.error && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
                            <TriangleAlert className="size-3 shrink-0" />
                            <span className="truncate">{run.error}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium text-primary tabular">
                        +{run.inserted}
                      </p>
                      <p className="text-xs text-muted-foreground tabular">
                        of {run.found} found
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </PageShell>
    </DashboardLayout>
  )
}
