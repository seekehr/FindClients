'use client'

import { LogIn, Radio, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import DashboardLayout from '@/components/dashboard-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, LoadingRow } from '@/components/ui/feedback'
import { PageHeader, PageShell } from '@/components/ui/page'
import { PlatformMark } from '@/components/ui/platform-mark'
import {
  ApiError,
  connectionsApi,
  scrapeApi,
  type Connection,
  type SignInState,
  type WatcherStatus,
} from '@/lib/api'
import { isWatchedPlatform, platformMeta } from '@/lib/platforms'
import {
  describePlatforms,
  refreshScrapeStatus,
  useScrapeStatus,
} from '@/lib/use-scrape-status'

/** The platforms this build can sign in to. */
const PLATFORM_IDS = ['twitter', 'upwork']

/** How often to check on a sign-in window while it is open. */
const SIGN_IN_POLL_MS = 2_000

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [signIn, setSignIn] = useState<SignInState | null>(null)
  const [watcher, setWatcher] = useState<WatcherStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [scraping, setScraping] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const { connections, signIn, watcher } = await connectionsApi.list()
      setConnections(connections)
      setSignIn(signIn)
      setWatcher(watcher)
    } catch {
      /* the empty state covers it */
    } finally {
      setLoading(false)
    }
  }, [])

  // Reflect a run started anywhere (this button, or the scheduler).
  const scrape = useScrapeStatus(() => void refresh())

  useEffect(() => {
    void refresh()
  }, [refresh])

  // While a sign-in window is open on the server, poll so the card can narrate
  // what is happening — otherwise the page looks frozen for however long the
  // person spends typing their password.
  const waiting = signIn?.status === 'waiting'
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => void refreshRef.current(), SIGN_IN_POLL_MS)
    return () => clearInterval(timer)
  }, [waiting])

  const byPlatform = (id: string) => connections.find((c) => c.platform === id)

  // Read from the shared status poller, not from `connectionsApi.list()`. That
  // call only runs on mount and while a sign-in is open, so the buttons would
  // still be enabled minutes after the browser went away.
  const browser = scrape.browser
  const browserDown = browser ? !browser.reachable : false

  async function startSignIn(id: string) {
    setNotice('')
    setBusy(id)
    try {
      const { signIn } = await connectionsApi.signIn(id)
      setSignIn(signIn)
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not start sign-in')
    } finally {
      setBusy(null)
    }
  }

  async function check(id: string) {
    setNotice('')
    setBusy(id)
    try {
      const { session, connections } = await connectionsApi.check(id)
      setConnections(connections)
      setNotice(
        session.signedIn
          ? 'Session is still good.'
          : (session.detail ?? 'That session no longer works — sign in again.'),
      )
    } catch (err) {
      setNotice(
        err instanceof ApiError ? err.message : 'Could not check the session',
      )
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(id: string) {
    setBusy(id)
    try {
      const { connections } = await connectionsApi.disconnect(id)
      setConnections(connections)
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not disconnect')
    } finally {
      setBusy(null)
    }
  }

  async function runScrape() {
    setScraping(true)
    setNotice('')
    try {
      await scrapeApi.run()
      // Don't wait for the next poll to admit the run exists.
      refreshScrapeStatus()
      setNotice('Scrape started — new leads appear on your Leads page as they are found.')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not start scrape')
    } finally {
      setScraping(false)
    }
  }

  return (
    <DashboardLayout>
      <PageShell width="narrow" className="space-y-6">
        <PageHeader
          title="Connections"
          description="Sign in to the platforms you want FindClients to watch. One browser window, your own credentials."
          actions={
            <Button
              variant="outline"
              onClick={runScrape}
              loading={scraping || scrape.running}
              disabled={scrape.running || waiting || browserDown}
              title="Runs the scraped platforms. Upwork is watched separately and is not included."
            >
              <RefreshCw className="size-4" />
              {scrape.running
                ? `Scraping ${describePlatforms(scrape.runs)}`
                : 'Scrape now'}
            </Button>
          }
        />

        {notice && <Alert tone="gold" title={notice} />}

        {/* A sign-in window is open on this machine right now. */}
        {waiting && (
          <Alert
            tone="gold"
            title={`A browser window is open — sign in to ${signIn?.platform} there.`}
          >
            <p>{signIn?.message}</p>
            <p className="mt-1">
              Take as long as you need — this notices on its own once you are
              in. Close the sign-in tab to cancel; the rest of the browser can
              stay open.
            </p>
          </Alert>
        )}

        {browserDown && (
          <Alert
            tone="danger"
            title="Signing in and scraping need the Chrome window."
          >
            {browser?.hint} These buttons stay disabled until it is back.
          </Alert>
        )}

        <Alert
          tone="warning"
          icon={<ShieldAlert className="size-4" />}
          title="Upwork is used for job alerts only — it is never scraped."
        >
          <p>
            Signing in to Upwork here lets FindClients keep one tab open on your
            jobs feed and tell you when something new is posted. It does not, and
            will not, page through the feed collecting listings: that breaks
            Upwork&rsquo;s terms and is the fastest way to get an account
            suspended. The &ldquo;Scrape now&rdquo; button above does not touch
            Upwork.
          </p>
          <p className="mt-1.5">
            <Link
              href="/dashboard/opportunities"
              className="font-medium text-primary hover:underline"
            >
              New Opportunities
            </Link>{' '}
            is where those alerts arrive.
          </p>
        </Alert>

        <Alert
          tone="info"
          icon={<ShieldCheck className="size-4" />}
          title="Your credentials never reach FindClients."
        >
          You sign in through a real browser window on this machine, exactly as
          you normally would. The session lives in a browser profile under{' '}
          <code className="rounded-xs bg-graphite-800 px-1 py-0.5 font-mono text-xs text-graphite-300">
            data/browser/
          </code>{' '}
          and never leaves your computer — there is no password to store and no
          cookie to re-paste when it expires.
        </Alert>

        {loading ? (
          <LoadingRow label="Loading connections" />
        ) : (
          <div className="space-y-3">
            {PLATFORM_IDS.map((id) => {
              const meta = platformMeta(id)
              const conn = byPlatform(id)
              const connected = !!conn && conn.status !== 'disconnected'
              const needsAttention =
                conn?.status === 'error' || conn?.status === 'expired'
              const isBusy = busy === id
              const locked = isBusy || waiting || scrape.running || browserDown

              return (
                <Card key={id}>
                  <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <PlatformMark platform={id} size="lg" />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-[0.9375rem] font-semibold">
                          {meta.label}
                        </h2>
                        {connected && !needsAttention && (
                          <Badge tone="success" dot>
                            Signed in
                          </Badge>
                        )}
                        {needsAttention && (
                          <Badge tone="danger" dot>
                            {conn?.status === 'expired'
                              ? 'Session expired'
                              : 'Needs attention'}
                          </Badge>
                        )}
                        {!connected && <Badge tone="outline">Not connected</Badge>}
                        {isWatchedPlatform(id) && (
                          <Badge tone="gold">
                            <Radio className="size-3" aria-hidden />
                            Job alerts only
                          </Badge>
                        )}
                      </div>

                      <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
                        {connected
                          ? (conn!.connectedAt
                              ? `Signed in ${new Date(conn!.connectedAt).toLocaleDateString()}`
                              : 'Signed in') +
                            (conn!.lastUsedAt
                              ? ` · last used ${new Date(conn!.lastUsedAt).toLocaleString()}`
                              : ' · not used yet')
                          : isWatchedPlatform(id)
                            ? `Keep a tab open on ${meta.site} and get told when a new job is posted.`
                            : `Watch ${meta.site} for posts matching your keywords.`}
                      </p>

                      {connected && isWatchedPlatform(id) && watcher && (
                        <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
                          {watcher.detail}
                        </p>
                      )}

                      {needsAttention && conn?.lastError && (
                        <p className="mt-1 text-[0.8125rem] text-destructive">
                          {conn.lastError}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {connected && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => check(id)}
                            disabled={locked}
                          >
                            Check
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Disconnect ${meta.label}`}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => disconnect(id)}
                            disabled={locked}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant={connected ? 'outline' : 'primary'}
                        onClick={() => startSignIn(id)}
                        loading={isBusy}
                        disabled={locked}
                      >
                        <LogIn className="size-4" />
                        {connected ? 'Sign in again' : 'Sign in'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        <p className="text-xs leading-5 text-muted-foreground">
          Automating access to these platforms may breach their terms of service
          and can put your account at risk. Only connect accounts you own, and
          leave the Upwork pacing on its defaults unless you know what you are
          trading away.
        </p>
      </PageShell>
    </DashboardLayout>
  )
}
