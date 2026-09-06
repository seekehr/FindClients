'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Loader2,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  LogIn,
  RefreshCw,
} from 'lucide-react'
import {
  connectionsApi,
  scrapeApi,
  ApiError,
  type Connection,
  type SignInState,
} from '@/lib/api'
import { describePlatforms, useScrapeStatus } from '@/lib/use-scrape-status'

interface PlatformMeta {
  id: string
  label: string
  icon: string
  site: string
  accent: string
}

const PLATFORMS: PlatformMeta[] = [
  {
    id: 'twitter',
    label: 'Twitter / X',
    icon: '𝕏',
    site: 'x.com',
    accent: 'bg-sky-500/10 text-sky-500',
  },
  {
    id: 'upwork',
    label: 'Upwork',
    icon: '💼',
    site: 'upwork.com',
    accent: 'bg-emerald-500/10 text-emerald-500',
  },
]

/** How often to check on a sign-in window while it is open. */
const SIGN_IN_POLL_MS = 2_000

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [signIn, setSignIn] = useState<SignInState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [scraping, setScraping] = useState(false)
  const [notice, setNotice] = useState('')

  // Reflect a run started anywhere (this button, or the scheduler).
  const scrape = useScrapeStatus(() => void refresh())

  const refresh = useCallback(async () => {
    try {
      const { connections, signIn } = await connectionsApi.list()
      setConnections(connections)
      setSignIn(signIn)
    } catch {
      /* the empty state covers it */
    } finally {
      setLoading(false)
    }
  }, [])

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
          : session.detail ?? 'That session no longer works — sign in again.',
      )
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not check the session')
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
      setNotice('Scrape started — new leads will appear on your Leads page as they are found.')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not start scrape')
    } finally {
      setScraping(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2">Connections</h1>
            <p className="text-foreground/60">
              Sign in to the platforms you want FindClients to watch.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={runScrape}
            disabled={scraping || scrape.running || waiting}
            className="gap-2 shrink-0"
          >
            {scraping || scrape.running ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {scrape.running ? `Scraping ${describePlatforms(scrape.runs)}…` : 'Scrape now'}
          </Button>
        </div>

        {notice && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {notice}
          </div>
        )}

        {/* A sign-in window is open on this machine right now. */}
        {waiting && (
          <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4">
            <Loader2 className="w-5 h-5 text-primary mt-0.5 shrink-0 animate-spin" />
            <div className="text-sm">
              <p className="font-semibold text-primary">
                A browser window is open — sign in to {signIn?.platform} there.
              </p>
              <p className="text-foreground/70 mt-1">{signIn?.message}</p>
              <p className="text-foreground/50 mt-1">
                Take as long as you need. Close the window to cancel.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-secondary/50 p-4">
          <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-foreground/70">
            You sign in through a real browser window on this machine, exactly as you normally
            would. The session is kept in a browser profile under{' '}
            <strong>data/browser/</strong> and never leaves your computer — FindClients never sees
            your password, and there are no cookies to copy or re-paste when they expire.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-foreground/50 py-12 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading connections…
          </div>
        ) : (
          <div className="space-y-4">
            {PLATFORMS.map((p) => {
              const conn = byPlatform(p.id)
              const connected = !!conn && conn.status !== 'disconnected'
              const needsAttention = conn?.status === 'error' || conn?.status === 'expired'
              const isBusy = busy === p.id

              return (
                <div key={p.id} className="bg-card rounded-xl border border-border/40 p-5">
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${p.accent}`}
                    >
                      {p.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg">{p.label}</h3>
                        {connected && !needsAttention && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3" /> Signed in
                          </span>
                        )}
                        {needsAttention && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="w-3 h-3" />
                            {conn?.status === 'expired' ? 'Session expired' : 'Needs attention'}
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-foreground/60 truncate">
                        {connected
                          ? (conn!.connectedAt
                              ? `Signed in ${new Date(conn!.connectedAt).toLocaleDateString()}`
                              : 'Signed in') +
                            (conn!.lastUsedAt
                              ? ` · last used ${new Date(conn!.lastUsedAt).toLocaleString()}`
                              : ' · not used yet')
                          : `Not signed in — monitor ${p.site} leads`}
                      </p>

                      {needsAttention && conn?.lastError && (
                        <p className="text-xs text-destructive mt-1">{conn.lastError}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {connected && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => check(p.id)}
                            disabled={isBusy || waiting || scrape.running}
                          >
                            Check
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2 text-destructive hover:text-destructive"
                            onClick={() => disconnect(p.id)}
                            disabled={isBusy || waiting || scrape.running}
                          >
                            <Trash2 className="w-4 h-4" /> Disconnect
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => startSignIn(p.id)}
                        disabled={isBusy || waiting || scrape.running}
                      >
                        {isBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <LogIn className="w-4 h-4" />
                        )}
                        {connected ? 'Sign in again' : 'Sign in'}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-xs text-foreground/40">
          Note: automating access to these platforms may be against their Terms of Service and can
          put your account at risk. Only connect accounts you own.
        </p>
      </div>
    </DashboardLayout>
  )
}
