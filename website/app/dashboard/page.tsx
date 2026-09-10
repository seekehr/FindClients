'use client'

import { ArrowUpRight, Inbox, Plug, Radio, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import DashboardLayout from '@/components/dashboard-layout'
import OpportunityRow from '@/components/opportunity-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Alert,
  EmptyState,
  Skeleton,
  SkeletonCard,
} from '@/components/ui/feedback'
import { Eyebrow, Meter, PageHeader, PageShell } from '@/components/ui/page'
import { PlatformMark } from '@/components/ui/platform-mark'
import {
  analyticsApi,
  leadsApi,
  opportunitiesApi,
  type Lead,
  type Opportunity,
} from '@/lib/api'
import { platformLabel } from '@/lib/platforms'
import { countdown, describeWatchState, useWatchStatus } from '@/lib/use-watch-status'
import { cn } from '@/lib/utils'

interface Overview {
  newLeads: number
  totalLeads: number
  bookmarked: number
  contacted: number
  conversionRate: number
}

interface PlatformCount {
  platform: string
  count: number
  percentage: number
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

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [platforms, setPlatforms] = useState<PlatformCount[]>([])
  const [recent, setRecent] = useState<Lead[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadOpportunities = useCallback(async () => {
    try {
      const { data } = await opportunitiesApi.list({ limit: 4 })
      setOpportunities(data)
    } catch {
      // The panel's own empty state covers it.
    }
  }, [])

  // Refreshes the moment the watcher releases an alert, so the Overview is
  // never quietly older than the sidebar badge sitting next to it.
  const watch = useWatchStatus(loadOpportunities)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      analyticsApi.overview(),
      analyticsApi.platforms(),
      leadsApi.list({ limit: 5, ai: 'not-rejected' }),
    ])
      .then(([overview, platforms, leads]) => {
        if (cancelled) return
        setOverview(overview)
        setPlatforms(platforms.data)
        setRecent(leads.data)
      })
      .catch(() => {
        // One message beats four empty cards that look like "you have no leads".
        if (!cancelled) setError('Could not reach the FindClients server.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void loadOpportunities()
  }, [loadOpportunities])

  const watchState = describeWatchState(watch.watcher)
  const watchLive =
    watch.watcher?.enabled &&
    (watch.watcher.state === 'watching' || watch.watcher.state === 'checking')

  const stats = overview
    ? [
        {
          label: 'New in 24 hours',
          value: overview.newLeads,
          hint: `${overview.totalLeads} leads collected in total`,
          emphasis: true,
        },
        {
          label: 'Bookmarked',
          value: overview.bookmarked,
          hint: 'Saved for a closer look',
        },
        {
          label: 'Contacted',
          value: overview.contacted,
          hint: 'Leads you have replied to',
        },
        {
          label: 'Reply-to-win rate',
          value: `${overview.conversionRate}%`,
          hint: 'Of the leads you contacted',
        },
      ]
    : []

  return (
    <DashboardLayout>
      <PageShell className="space-y-6">
        <PageHeader
          title="Overview"
          description="Upwork job alerts as they arrive, what the scrapers found, and what you have done with it."
          actions={
            <Button variant="outline" render={<Link href="/dashboard/leads" />}>
              Browse leads
              <ArrowUpRight className="size-4" />
            </Button>
          }
        />

        {error && (
          <Alert tone="danger" title={error}>
            Start it with{' '}
            <code className="rounded-xs bg-graphite-800 px-1 py-0.5 font-mono text-xs text-graphite-300">
              npm run dev
            </code>{' '}
            in the project folder, then reload this page.
          </Alert>
        )}

        {!error && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading
              ? Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
              : stats.map((stat) => <StatTile key={stat.label} {...stat} />)}
          </section>
        )}

        {!error && (
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Upwork job alerts first: they are the time-sensitive ones. A job
                you hear about tomorrow is a job someone else already took. */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <CardTitle>New Opportunities</CardTitle>
                  {watch.unseen > 0 && <Badge tone="gold">{watch.unseen} new</Badge>}
                </div>
                <Link
                  href="/dashboard/opportunities"
                  className="rounded-sm text-[0.8125rem] font-medium text-primary hover:underline"
                >
                  View all
                </Link>
              </CardHeader>

              {opportunities.length === 0 ? (
                <EmptyState
                  icon={Radio}
                  title="No job alerts yet"
                  description={
                    watchLive
                      ? 'A tab is open on your Upwork feed. New jobs land here a couple of minutes after they are posted.'
                      : 'Start the Upwork watcher and new jobs will land here as they are posted.'
                  }
                  action={
                    watchLive ? undefined : (
                      <Button render={<Link href="/dashboard/opportunities" />}>
                        <Radio className="size-4" />
                        Open the watcher
                      </Button>
                    )
                  }
                />
              ) : (
                <ul className="divide-y divide-border">
                  {opportunities.map((opportunity) => (
                    <OpportunityRow key={opportunity.id} opportunity={opportunity} compact />
                  ))}
                </ul>
              )}
            </Card>

            {/* The watcher is slow and quiet on purpose, so its state gets a
                permanent home rather than surfacing only when something breaks. */}
            <Card>
              <CardHeader>
                <CardTitle>Upwork watcher</CardTitle>
                <Badge tone={watchState.tone} dot>
                  {watchState.label}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-[0.8125rem] leading-5 text-muted-foreground">
                  {watch.watcher?.detail ?? 'Checking...'}
                </p>

                <dl className="space-y-2 text-[0.8125rem]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Next look</dt>
                    <dd className="font-medium tabular">
                      {watchLive ? countdown(watch.watcher?.nextCheckAt ?? null) || 'soon' : '-'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Held back now</dt>
                    <dd className="font-medium tabular">{watch.watcher?.queued.length ?? 0}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Alerts this session</dt>
                    <dd className="font-medium tabular">{watch.watcher?.alerts ?? 0}</dd>
                  </div>
                </dl>

                <div className="flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Upwork is watched for job alerts, never scraped &mdash; bulk scraping it
                    risks your account.
                  </p>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  render={<Link href="/dashboard/opportunities" />}
                >
                  Open Opportunities
                  <ArrowUpRight className="size-4" />
                </Button>
              </CardContent>
            </Card>
          </section>
        )}

        {!error && (
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Latest leads</CardTitle>
                <Link
                  href="/dashboard/leads"
                  className="rounded-sm text-[0.8125rem] font-medium text-primary hover:underline"
                >
                  View all
                </Link>
              </CardHeader>

              {loading ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-4">
                      <Skeleton className="size-9 rounded-md" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recent.length === 0 && (overview?.totalLeads ?? 0) > 0 ? (
                // There are leads — the AI rejected every one, and rejections
                // are kept off this list. "Connect an account" would be wrong.
                <EmptyState
                  icon={Inbox}
                  title="Nothing has passed the AI yet"
                  description="Every lead so far was rejected. They are under the Rejected filter on the Leads page."
                  action={
                    <Button variant="outline" render={<Link href="/dashboard/leads" />}>
                      Browse leads
                    </Button>
                  }
                />
              ) : recent.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="No leads yet"
                  description="Connect an account and run a scrape. Matches land here as they are found."
                  action={
                    <Button render={<Link href="/dashboard/connections" />}>
                      <Plug className="size-4" />
                      Connect an account
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-border">
                  {recent.map((lead) => (
                    <li key={lead.id}>
                      <Link
                        href={`/dashboard/leads/${lead.id}`}
                        className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-secondary/40"
                      >
                        <PlatformMark platform={lead.platform} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {lead.title}
                          </p>
                          <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
                            {platformLabel(lead.platform)} · {lead.postedTime}
                          </p>
                        </div>
                        {lead.budget && (
                          <span className="shrink-0 text-[0.8125rem] font-medium text-graphite-200 tabular">
                            {lead.budget}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Where they came from</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-5">
                    {Array.from({ length: 3 }, (_, i) => (
                      <div key={i} className="space-y-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-1.5 w-full rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : platforms.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nothing collected yet.
                  </p>
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
          </section>
        )}
      </PageShell>
    </DashboardLayout>
  )
}
