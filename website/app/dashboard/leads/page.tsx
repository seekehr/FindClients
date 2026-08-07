'use client'

import DashboardLayout from '@/components/dashboard-layout'
import LeadCard from '@/components/lead-card'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, Loader2, Inbox, Radar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { leadsApi, type Lead } from '@/lib/api'
import { describePlatforms, useScrapeStatus } from '@/lib/use-scrape-status'

const PLATFORMS = [
  { id: null, label: 'All' },
  { id: 'upwork', label: 'Upwork' },
  { id: 'twitter', label: 'Twitter' },
  { id: 'discord', label: 'Discord' },
]

export default function LeadsPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchTerm), 300)
    return () => clearTimeout(t)
  }, [searchTerm])

  const load = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const res = await leadsApi.list({
        platform: selectedPlatform ?? undefined,
        q: debounced || undefined,
        limit: 60,
      })
      setLeads(res.data)
    } catch {
      setError('Could not load leads.')
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
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl font-bold mb-2">Leads</h1>
            <p className="text-foreground/60">
              Browse and manage all your discovered opportunities.
            </p>
          </div>

          {/* Live scrape indicator — visible whether or not there are leads. */}
          {scrape.running && (
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
              <Loader2 className="w-4 h-4 animate-spin" />
              Scraping {describePlatforms(scrape.runs)}…
            </span>
          )}
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40" />
            <input
              type="text"
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            {PLATFORMS.map((p) => (
              <Button
                key={p.label}
                variant={selectedPlatform === p.id ? 'default' : 'outline'}
                onClick={() => setSelectedPlatform(p.id)}
                size="sm"
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {/* States */}
        {showInitialLoader ? (
          <div className="flex items-center gap-2 text-foreground/50 py-16 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading leads…
          </div>
        ) : error ? (
          <div className="text-center py-12 text-foreground/60">{error}</div>
        ) : isEmpty ? (
          scrape.running ? (
            /* Nothing yet, but a scrape is working on it. */
            <div className="text-center py-16 max-w-md mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Radar className="w-7 h-7 text-primary animate-pulse" />
              </div>
              <p className="font-semibold mb-1">
                Scraping {describePlatforms(scrape.runs)}…
              </p>
              <p className="text-foreground/60 text-sm">
                Looking for opportunities that match your keywords. This can take a couple of
                minutes — results appear here automatically.
              </p>
              <Link
                href="/dashboard/config"
                className="inline-block mt-4 text-sm text-primary hover:underline font-medium"
              >
                Review your keywords
              </Link>
            </div>
          ) : filtered ? (
            /* The pool may be non-empty — it's the filters that match nothing. */
            <div className="text-center py-16 max-w-md mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
                <Search className="w-7 h-7 text-foreground/40" />
              </div>
              <p className="font-semibold mb-1">No matching leads</p>
              <p className="text-foreground/60 text-sm mb-4">
                Nothing matches those filters. Try a different search or platform.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm('')
                  setSelectedPlatform(null)
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="text-center py-16 max-w-md mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
                <Inbox className="w-7 h-7 text-foreground/40" />
              </div>
              <p className="font-semibold mb-1">No leads yet</p>
              <p className="text-foreground/60 text-sm mb-4">
                Connect an account and run a scrape to start discovering opportunities.
              </p>
              <Link href="/dashboard/connections">
                <Button>Connect an account</Button>
              </Link>
            </div>
          )
        ) : (
          <div
            className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transition-opacity ${
              refreshing ? 'opacity-60' : ''
            }`}
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
                bookmarked={lead.bookmarked}
                onToggleBookmark={() => toggleBookmark(lead)}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
