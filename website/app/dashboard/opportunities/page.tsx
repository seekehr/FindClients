'use client'

import {
  CheckCheck,
  Hourglass,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import DashboardLayout from '@/components/dashboard-layout'
import OpportunityRow from '@/components/opportunity-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, EmptyState, LoadingRow } from '@/components/ui/feedback'
import { Eyebrow, PageHeader, PageShell } from '@/components/ui/page'
import {
  ApiError,
  opportunitiesApi,
  watchApi,
  type Opportunity,
  type WatchedPlatform,
  type WatcherStatus,
} from '@/lib/api'
import { platformLabel } from '@/lib/platforms'
import {
  clearUnseenLocally,
  countdown,
  describeWatchState,
  refreshWatchStatus,
  useWatchStatus,
} from '@/lib/use-watch-status'
import { cn } from '@/lib/utils'

/**
 * New Opportunities — the job-alert feed, from Upwork and LinkedIn.
 *
 * The page has two halves and they answer different questions. The cards at
 * the top answer "is each watcher actually running, and when will it look
 * again?", which matters because the watchers are deliberately slow and silence
 * is their normal state. The list below answers "what came in?".
 *
 * The notice between them is not boilerplate. People arrive here expecting a
 * scraper and are surprised by an empty list; the explanation for why it is
 * empty — and why making it fuller would be a bad trade — has to be on the
 * screen where the expectation forms.
 */

/** Re-render once a second so the countdowns actually count down. */
function useTicker(active: boolean) {
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [active])
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1 truncate text-sm font-medium text-foreground tabular">{value}</p>
    </div>
  )
}

type Action = 'start' | 'stop' | 'check'

/** "/nx/find-work/most-recent" · "/jobs/search-results/?keywords=…" */
function shortFeed(url: string): string {
  return url.replace(/^https:\/\/(www\.)?(upwork|linkedin)\.com/, '')
}

/** One watcher's status, controls and queue. */
function WatcherCard({
  watcher,
  busy,
  onControl,
}: {
  watcher: WatcherStatus
  busy: Action | null
  onControl: (platform: WatchedPlatform, action: Action) => void
}) {
  const site = platformLabel(watcher.platform)
  const state = describeWatchState(watcher)

  // Switched off: one line, not a card of zeroes.
  if (!watcher.enabled) {
    return (
      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised text-muted-foreground">
              <Radio className="size-4" />
            </span>
            <div className="min-w-0">
              <CardTitle>{site} watcher</CardTitle>
              <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
                {site} job alerts are switched off. Turn them on on the{' '}
                <Link href="/dashboard/config" className="font-medium text-primary hover:underline">
                  Config page
                </Link>{' '}
                to start watching.
              </p>
            </div>
          </div>
          <Badge tone={state.tone} dot>
            {state.label}
          </Badge>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md border',
              watcher.running
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-border bg-surface-raised text-muted-foreground',
            )}
          >
            <Radio className={cn('size-4', watcher.state === 'checking' && 'animate-pulse')} />
          </span>
          <div className="min-w-0">
            <CardTitle>{site} watcher</CardTitle>
            <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">{watcher.detail}</p>
          </div>
        </div>
        <Badge tone={state.tone} dot>
          {state.label}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatLine
            label="Next look"
            value={watcher.running ? countdown(watcher.nextCheckAt) || 'soon' : 'Paused'}
          />
          <StatLine
            label="Last look"
            value={
              watcher.lastCheckedAt ? new Date(watcher.lastCheckedAt).toLocaleTimeString() : 'Not yet'
            }
          />
          <StatLine label="Jobs on feed" value={String(watcher.jobsOnFeed)} />
          <StatLine label="Alerts this session" value={String(watcher.alerts)} />
        </div>

        {/* Spotted, still being held. Showing the queue is what makes the
            delay legible instead of feeling like the app is broken. */}
        {watcher.queued.length > 0 && (
          <div className="rounded-md border border-gold-500/25 bg-gold-500/8 px-4 py-3">
            <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-gold-300">
              <Hourglass className="size-3.5" aria-hidden />
              {watcher.queued.length} job{watcher.queued.length === 1 ? '' : 's'} spotted, held
              back for now
            </p>
            <ul className="mt-2 space-y-1">
              {watcher.queued.map((item) => (
                <li
                  key={item.id}
                  className="flex items-baseline justify-between gap-3 text-[0.8125rem]"
                >
                  <span className="truncate text-muted-foreground">{item.title}</span>
                  <span className="shrink-0 text-graphite-300 tabular">{countdown(item.dueAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {watcher.state === 'signed-out' && (
          <Alert tone="danger" title={`Your ${site} session has expired.`}>
            <Link href="/dashboard/connections" className="font-medium text-primary hover:underline">
              Sign in again on Connections
            </Link>{' '}
            and watching picks up on its own.
          </Alert>
        )}

        {(watcher.state === 'error' || watcher.state === 'browser-down') && (
          <Alert tone="danger" title={`The watcher can't read your ${site} feed right now.`}>
            <p>{watcher.lastError ?? watcher.detail}</p>
            <p className="mt-1.5 text-muted-foreground">
              No jobs are being picked up until this clears. It retries on its own, or press
              Check now once you&apos;ve fixed it.
            </p>
          </Alert>
        )}

        {watcher.warning && watcher.state !== 'error' && (
          <Alert tone="warning" title="Heads up about your feed.">
            {watcher.warning}{' '}
            <Link href="/dashboard/config" className="font-medium text-primary hover:underline">
              Open Config
            </Link>
          </Alert>
        )}

        {watcher.state === 'blocked' && (
          <Alert tone="warning" title={`${site} is showing a bot check.`}>
            Clear it in the Chrome window FindClients is attached to. The next look will go
            through as normal.
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {watcher.running ? (
            <Button
              variant="outline"
              onClick={() => onControl(watcher.platform, 'stop')}
              loading={busy === 'stop'}
            >
              <Pause className="size-4" />
              Pause watching
            </Button>
          ) : (
            <Button onClick={() => onControl(watcher.platform, 'start')} loading={busy === 'start'}>
              <Play className="size-4" />
              Start watching
            </Button>
          )}

          <Button
            variant="ghost"
            onClick={() => onControl(watcher.platform, 'check')}
            loading={busy === 'check'}
            disabled={!watcher.running}
          >
            <RefreshCw className="size-4" />
            Check now
          </Button>

          {watcher.feedUrl && (
            <a
              href={watcher.feedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate rounded-sm text-[0.8125rem] text-muted-foreground hover:text-foreground hover:underline"
            >
              {shortFeed(watcher.feedUrl)}
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function OpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  /** Which watcher's button is spinning, and which button. */
  const [busy, setBusy] = useState<{ platform: WatchedPlatform; action: Action } | null>(null)
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState('')
  // Jobs the AI rejected are kept, but only under their own filter. New alerts
  // are not reviewed any more, so the filter only appears while old ones exist.
  const [showRejected, setShowRejected] = useState(false)
  const [counts, setCounts] = useState({ total: 0, rejected: 0 })

  const load = useCallback(async () => {
    try {
      const { data, total, rejected } = await opportunitiesApi.list({
        limit: 100,
        rejected: showRejected,
      })
      setItems(data)
      setCounts({ total, rejected })
    } catch {
      // The empty state covers it; the status cards carry the real diagnosis.
    } finally {
      setLoading(false)
    }
  }, [showRejected])

  // Pull the list the moment a watcher releases an alert, rather than on this
  // page's own timer — the whole promise is that a job shows up without a
  // refresh.
  const { watchers, unseen } = useWatchStatus(() => void load())

  useEffect(() => {
    void load()
  }, [load])

  const anyRunning = watchers.some((w) => w.running)
  useTicker(anyRunning)

  async function control(platform: WatchedPlatform, action: Action) {
    setBusy({ platform, action })
    setNotice('')
    try {
      await watchApi[action](platform)
      refreshWatchStatus()
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  async function markAllSeen() {
    clearUnseenLocally()
    setItems((current) => current.map((o) => ({ ...o, seen: true })))
    await opportunitiesApi.markAllSeen().catch(() => undefined)
    refreshWatchStatus()
  }

  async function clearFeed() {
    setClearing(true)
    try {
      await opportunitiesApi.clear()
      setItems([])
      setCounts({ total: 0, rejected: 0 })
      refreshWatchStatus()
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not clear the feed.')
    } finally {
      setClearing(false)
    }
  }

  // The notice quotes the pacing of whichever watcher is on, Upwork's first.
  const pacing = watchers.find((w) => w.enabled) ?? watchers[0]
  const [reloadMin, reloadMax] = pacing?.reloadMinutes ?? [10, 15]
  const [delayMin, delayMax] = pacing?.delaySeconds ?? [120, 180]

  return (
    <DashboardLayout>
      <PageShell className="space-y-6">
        <PageHeader
          title="New Opportunities"
          description="Upwork and LinkedIn jobs, spotted by a tab left open on each of your job feeds and passed to you after a short, random pause."
          actions={
            counts.total + counts.rejected > 0 ? (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={clearFeed}
                loading={clearing}
              >
                <Trash2 className="size-4" />
                Clear feed
              </Button>
            ) : undefined
          }
        />

        {notice && <Alert tone="danger" title={notice} />}

        {/* The reason this page looks the way it does. */}
        <Alert
          tone="warning"
          icon={<ShieldAlert className="size-4" />}
          title="Job feeds are watched for alerts — they are never scraped."
        >
          <p>
            Bulk-scraping Upwork or LinkedIn job listings breaks their terms of service and is
            the fastest way to get your account restricted. FindClients does not do it, and there
            is no setting that turns it on.
          </p>
          <p className="mt-1.5">
            Instead it keeps one tab open on each job feed you choose, reloads that single page
            every {reloadMin}–{reloadMax} minutes, and holds each new job for{' '}
            {Math.round(delayMin / 60)}–{Math.round(delayMax / 60)} minutes — randomly, per job —
            before it reaches this panel. It never pages through a feed and never opens a job you
            were not going to be told about. Expect a handful of alerts a day, not a list of
            hundreds.
          </p>
        </Alert>

        {/* ── Watcher status, one card each ──────────────────── */}
        {watchers.length === 0 ? (
          <Card>
            <LoadingRow label="Checking the watchers" />
          </Card>
        ) : (
          watchers.map((watcher) => (
            <WatcherCard
              key={watcher.platform}
              watcher={watcher}
              busy={busy?.platform === watcher.platform ? busy.action : null}
              onControl={control}
            />
          ))
        )}

        {/* ── The feed ───────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <CardTitle>Job alerts</CardTitle>
              <span className="text-xs text-muted-foreground tabular">
                {unseen > 0 ? `${unseen} unread · ` : ''}
                {counts.total}
              </span>
              {unseen > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={markAllSeen}
                >
                  <CheckCheck className="size-3.5" />
                  Mark all read
                </Button>
              )}
            </div>

            {(counts.rejected > 0 || showRejected) && (
              <div
                role="tablist"
                aria-label="Filter job alerts"
                className="flex gap-1 rounded-md border border-border bg-card p-1"
              >
                <button
                  role="tab"
                  type="button"
                  aria-selected={!showRejected}
                  onClick={() => setShowRejected(false)}
                  className={cn(
                    'h-7 shrink-0 rounded-sm px-3 text-[0.8125rem] font-medium transition-colors duration-150 ease-out',
                    !showRejected
                      ? 'bg-gold-500/12 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  All
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={showRejected}
                  onClick={() => setShowRejected(true)}
                  className={cn(
                    'h-7 shrink-0 rounded-sm px-3 text-[0.8125rem] font-medium transition-colors duration-150 ease-out tabular',
                    showRejected
                      ? 'bg-destructive/12 text-destructive'
                      : 'text-destructive/80 hover:bg-destructive/10 hover:text-destructive',
                  )}
                >
                  Rejected{counts.rejected > 0 ? ` ${counts.rejected}` : ''}
                </button>
              </div>
            )}
          </CardHeader>

          {loading ? (
            <LoadingRow label="Loading opportunities" />
          ) : items.length === 0 && showRejected ? (
            <EmptyState
              icon={Radio}
              title="Nothing rejected"
              description="Jobs the AI turned down before job alerts stopped being reviewed."
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="Nothing yet"
              description={
                anyRunning
                  ? 'The tabs are open and watching. Jobs posted from now on show up here a couple of minutes after they appear — the pause is deliberate.'
                  : 'Start a watcher above and new jobs will land here as they are posted.'
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((opportunity) => (
                <OpportunityRow key={opportunity.id} opportunity={opportunity} />
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs leading-5 text-muted-foreground">
          Clearing the feed removes the alerts only — the jobs themselves stay on your Leads page.
        </p>
      </PageShell>
    </DashboardLayout>
  )
}
