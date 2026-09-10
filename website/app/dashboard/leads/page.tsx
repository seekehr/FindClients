'use client'

import { Inbox, Plug, RefreshCw, Search, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import DashboardLayout from '@/components/dashboard-layout'
import LeadCard from '@/components/lead-card'
import { Button } from '@/components/ui/button'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { Input } from '@/components/ui/field'
import { PageHeader, PageShell } from '@/components/ui/page'
import { leadsApi, scrapeApi, type Lead } from '@/lib/api'
import {
  describePlatforms,
  refreshScrapeStatus,
  useScrapeStatus,
} from '@/lib/use-scrape-status'
import { cn } from '@/lib/utils'

/** Not a platform: the leads the AI turned down, which no other filter shows. */
const REJECTED = 'rejected'

const FILTERS: { id: string | null; label: string }[] = [
  { id: null, label: 'All' },
  { id: 'upwork', label: 'Upwork' },
  { id: 'twitter', label: 'Twitter' },
  { id: 'discord', label: 'Discord' },
  { id: REJECTED, label: 'Rejected' },
]

/** Matches the real card's box so the grid does not jump when leads arrive. */
function LeadCardSkeleton() {
  return (
    <div className="h-[268px] rounded-xl border border-border bg-card p-5">
      <div className="flex gap-3">
        <div className="size-9 animate-shimmer rounded-md bg-graphite-850" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-24 animate-shimmer rounded-sm bg-graphite-850" />
          <div className="h-4 w-full animate-shimmer rounded-sm bg-graphite-850" />
          <div className="h-4 w-2/3 animate-shimmer rounded-sm bg-graphite-850" />
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <div className="h-3 w-full animate-shimmer rounded-sm bg-graphite-850" />
        <div className="h-3 w-full animate-shimmer rounded-sm bg-graphite-850" />
        <div className="h-3 w-1/2 animate-shimmer rounded-sm bg-graphite-850" />
      </div>
      <div className="mt-6 h-6 w-40 animate-shimmer rounded-sm bg-graphite-850" />
    </div>
  )
}

export default function LeadsPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [scraping, setScraping] = useState(false)
  const [clearing, setClearing] = useState(false)

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchTerm), 300)
    return () => clearTimeout(t)
  }, [searchTerm])

  const load = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const rejected = selectedPlatform === REJECTED
      const res = await leadsApi.list({
        platform: rejected ? undefined : (selectedPlatform ?? undefined),
        ai: rejected ? 'rejected' : 'not-rejected',
        q: debounced || undefined,
        limit: 60,
      })
      setLeads(res.data)
    } catch {
      setError('Could not load leads. Is the FindClients server running?')
    } finally {
      setRefreshing(false)
      setLoaded(true)
    }
  }, [selectedPlatform, debounced])

  useEffect(() => {
    load()
  }, [load])

  // Re-fetch when a scrape finishes — that is when new leads actually land.
  // `load` is stable per filter, so keep it in a ref to avoid resubscribing.
  const loadRef = useRef(load)
  loadRef.current = load
  const scrape = useScrapeStatus(() => loadRef.current())

  async function runScrape() {
    setScraping(true)
    try {
      await scrapeApi.run()
      // Don't wait for the next poll to admit the run exists.
      refreshScrapeStatus()
    } catch {
      // scrape status polling will pick up the state
    } finally {
      setScraping(false)
    }
  }

  async function clearAllLeads() {
    if (!confirm('Clear all leads? This cannot be undone.')) return
    setClearing(true)
    try {
      await leadsApi.clear()
      setLeads([])
    } catch {
      setError('Could not clear leads.')
    } finally {
      setClearing(false)
    }
  }

  async function toggleBookmark(lead: Lead) {
    // Optimistic update.
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, bookmarked: !l.bookmarked } : l)),
    )
    try {
      await leadsApi.bookmark(lead.id, !lead.bookmarked)
    } catch {
      load() // revert on failure
    }
  }

  // Only block the page on the very first fetch. Once there are leads on
  // screen, a refresh (or an in-flight scrape) must never replace them with a
  // spinner.
  const showInitialLoader = !loaded && leads.length === 0
  const isEmpty = loaded && leads.length === 0 && !error
  const filtered = !!debounced || !!selectedPlatform

  return (
    <DashboardLayout>
      <PageShell className="space-y-6">
        <PageHeader
          title="Leads"
          description="Everything the scrapers matched against your keywords, newest first."
          actions={
            <>
              {leads.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={clearAllLeads}
                  loading={clearing}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  Clear all
                </Button>
              )}
              <Button
                variant="outline"
                onClick={runScrape}
                loading={scraping || scrape.running}
                disabled={scrape.running}
              >
                <RefreshCw className="size-4" />
                {scrape.running
                  ? `Scraping ${describePlatforms(scrape.runs)}`
                  : 'Scrape now'}
              </Button>
            </>
          }
        />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative lg:max-w-sm lg:flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-graphite-500"
              aria-hidden
            />
            <Input
              type="search"
              placeholder="Search titles and descriptions"
              aria-label="Search leads"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Segmented control: one container, one radius, no gaps to drift. */}
          <div
            role="tablist"
            aria-label="Filter leads"
            className="flex w-full gap-1 overflow-x-auto rounded-md border border-border bg-card p-1 lg:w-auto"
          >
            {FILTERS.map((filter) => {
              const active = selectedPlatform === filter.id
              const rejected = filter.id === REJECTED
              return (
                <button
                  key={filter.label}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setSelectedPlatform(filter.id)}
                  className={cn(
                    'h-7 shrink-0 rounded-sm px-3 text-[0.8125rem] font-medium transition-colors duration-150 ease-out',
                    rejected
                      ? active
                        ? 'bg-destructive/12 text-destructive'
                        : 'text-destructive/80 hover:bg-destructive/10 hover:text-destructive'
                      : active
                        ? 'bg-gold-500/12 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  {filter.label}
                </button>
              )
            })}
          </div>
        </div>

        {error && <Alert tone="danger" title={error} />}

        {showInitialLoader ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <LeadCardSkeleton key={i} />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="rounded-xl border border-border bg-card">
            {scrape.running ? (
              <EmptyState
                icon={RefreshCw}
                title={`Scraping ${describePlatforms(scrape.runs)}`}
                description="Looking for posts that match your keywords. This takes a couple of minutes and results appear here on their own."
                action={
                  <Button
                    variant="outline"
                    render={<Link href="/dashboard/config" />}
                  >
                    Review your keywords
                  </Button>
                }
              />
            ) : selectedPlatform === REJECTED && !debounced ? (
              <EmptyState
                icon={Inbox}
                title="Nothing rejected"
                description="Leads the AI turns down land here instead of in your main list."
              />
            ) : filtered ? (
              <EmptyState
                icon={Search}
                title="No leads match those filters"
                description="The pool may not be empty — try a broader search term or another platform."
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchTerm('')
                      setSelectedPlatform(null)
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Inbox}
                title="No leads yet"
                description="Sign in to a platform on the Connections page, then run a scrape to start collecting opportunities."
                action={
                  <Button render={<Link href="/dashboard/connections" />}>
                    <Plug className="size-4" />
                    Connect an account
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <div
            className={cn(
              'grid grid-cols-1 gap-4 transition-opacity duration-200 md:grid-cols-2 xl:grid-cols-3',
              refreshing && 'opacity-50',
            )}
          >
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                id={lead.id}
                title={lead.title}
                platform={lead.platform}
                description={lead.description}
                url={lead.url}
                budget={lead.budget}
                timeline={lead.timeline}
                postedTime={lead.postedTime}
                tags={lead.tags}
                ai={lead.ai}
                metadata={lead.metadata}
                bookmarked={lead.bookmarked}
                onToggleBookmark={() => toggleBookmark(lead)}
              />
            ))}
          </div>
        )}
      </PageShell>
    </DashboardLayout>
  )
}
