'use client'

import DashboardLayout from '@/components/dashboard-layout'
import LeadCard from '@/components/lead-card'
import { useCallback, useEffect, useState } from 'react'
import { Search, Loader2, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { leadsApi, type Lead } from '@/lib/api'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchTerm), 300)
    return () => clearTimeout(t)
  }, [searchTerm])

  const load = useCallback(async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }, [selectedPlatform, debounced])

  useEffect(() => {
    load()
  }, [load])

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

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Leads</h1>
          <p className="text-foreground/60">Browse and manage all your discovered opportunities.</p>
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
        {loading ? (
          <div className="flex items-center gap-2 text-foreground/50 py-16 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading leads…
          </div>
        ) : error ? (
          <div className="text-center py-12 text-foreground/60">{error}</div>
        ) : leads.length === 0 ? (
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                id={lead.id}
                title={lead.title}
                platform={lead.platform as 'upwork' | 'twitter' | 'discord'}
                description={lead.description}
                url={lead.url ?? undefined}
                budget={lead.budget ?? undefined}
                timeline={lead.timeline ?? undefined}
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
