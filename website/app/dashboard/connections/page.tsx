'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import {
  Check,
  Loader2,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Plug,
  RefreshCw,
} from 'lucide-react'
import { credentialsApi, scrapeApi, ApiError, type Connection } from '@/lib/api'
import { describePlatforms, useScrapeStatus } from '@/lib/use-scrape-status'

interface PlatformMeta {
  id: string
  label: string
  icon: string
  site: string
  accent: string
  steps: string[]
  hint: string
}

const PLATFORMS: PlatformMeta[] = [
  {
    id: 'twitter',
    label: 'Twitter / X',
    icon: '𝕏',
    site: 'x.com',
    accent: 'bg-sky-500/10 text-sky-500',
    steps: [
      'Open x.com in your browser and make sure you are logged in.',
      'Press F12 to open DevTools, then go to the Network tab.',
      'Filter the requests by "x.com" in the URL column.',
      'Click any request to x.com, open Headers → Request Headers.',
      'Copy the entire value of the "Cookie:" header and paste it below.',
    ],
    hint: 'Must include your auth_token cookie.',
  },
  {
    id: 'upwork',
    label: 'Upwork',
    icon: '💼',
    site: 'upwork.com',
    accent: 'bg-emerald-500/10 text-emerald-500',
    steps: [
      'Open upwork.com and make sure you are logged in.',
      'Press F12 to open DevTools, then go to the Network tab.',
      'Click any request to upwork.com, open Headers → Request Headers.',
      'Copy the entire value of the "Cookie:" header and paste it below.',
    ],
    hint: 'Paste the full Cookie header so all session cookies are captured.',
  },
]

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [cookieValue, setCookieValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [scraping, setScraping] = useState(false)
  const [notice, setNotice] = useState('')

  // Reflect a run started anywhere (this button, or the scheduler).
  const scrape = useScrapeStatus(() => refresh())

  async function refresh() {
    try {
      const { connections } = await credentialsApi.list()
      setConnections(connections)
    } catch {
      /* handled by auth redirect / empty state */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const byPlatform = (id: string) => connections.find((c) => c.platform === id)

  function startConnect(id: string) {
    setOpenForm(id)
    setCookieValue('')
    setFormError('')
  }

  async function submitConnect(id: string) {
    setFormError('')
    setSubmitting(true)
    try {
      await credentialsApi.connect(id, cookieValue.trim())
      setOpenForm(null)
      setCookieValue('')
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save connection')
    } finally {
      setSubmitting(false)
    }
  }

  async function disconnect(id: string) {
    await credentialsApi.disconnect(id)
    await refresh()
  }

  async function runScrape() {
    setScraping(true)
    setNotice('')
    try {
      // Returns as soon as the run is queued; useScrapeStatus tracks it.
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
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2">Connections</h1>
            <p className="text-foreground/60">
              Connect your accounts so FindClients can monitor leads on your behalf.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={runScrape}
            disabled={scraping || scrape.running}
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

        {/* Security reassurance */}
        <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-secondary/50 p-4">
          <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-foreground/70">
            Your session is <strong>encrypted at rest</strong> and never shown again after you save
            it. We never ask for your password. You can disconnect any time.
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
              const connected = !!conn
              const hasError = conn?.status === 'error'
              const isOpen = openForm === p.id
              return (
                <div key={p.id} className="bg-card rounded-xl border border-border/40 overflow-hidden">
                  {/* Card head */}
                  <div className="flex items-center gap-4 p-5">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${p.accent}`}>
                      {p.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg">{p.label}</h3>
                        {connected && !hasError && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3" /> Connected
                          </span>
                        )}
                        {hasError && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="w-3 h-3" /> Needs attention
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground/60 truncate">
                        {connected
                          ? `${conn!.cookieCount} cookie(s) saved` +
                            (conn!.lastUsedAt
                              ? ` · last used ${new Date(conn!.lastUsedAt).toLocaleString()}`
                              : ' · not used yet')
                          : `Not connected — monitor ${p.site} leads`}
                      </p>
                      {hasError && conn?.lastError && (
                        <p className="text-xs text-destructive mt-1">{conn.lastError}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {connected && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2 text-destructive hover:text-destructive"
                          onClick={() => disconnect(p.id)}
                        >
                          <Trash2 className="w-4 h-4" /> Disconnect
                        </Button>
                      )}
                      <Button size="sm" className="gap-2" onClick={() => startConnect(p.id)}>
                        <Plug className="w-4 h-4" />
                        {connected ? 'Update' : 'Connect'}
                      </Button>
                    </div>
                  </div>

                  {/* Connect form */}
                  {isOpen && (
                    <div className="border-t border-border/40 bg-secondary/30 p-5 space-y-4">
                      <div>
                        <p className="text-sm font-semibold mb-2">
                          How to get your {p.label} session cookie
                        </p>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-foreground/70">
                          {p.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-2">Cookie header</label>
                        <textarea
                          value={cookieValue}
                          onChange={(e) => setCookieValue(e.target.value)}
                          rows={4}
                          placeholder="auth_token=…; ct0=…; guest_id=…"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-foreground/40 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <p className="text-xs text-foreground/50 mt-1">{p.hint}</p>
                      </div>

                      {formError && (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          {formError}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          onClick={() => submitConnect(p.id)}
                          disabled={submitting || !cookieValue.trim()}
                          className="gap-2"
                        >
                          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                          Save connection
                        </Button>
                        <Button variant="outline" onClick={() => setOpenForm(null)} disabled={submitting}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
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
