'use client'

import DashboardLayout from '@/components/dashboard-layout'
import LeadCard from '@/components/lead-card'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Bookmark } from 'lucide-react'
import { ApiError, bookmarksApi, leadsApi, type Lead } from '@/lib/api'

export default function BookmarksPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await bookmarksApi.list({ limit: 60 })
      setLeads(res.data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your bookmarks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function removeBookmark(id: string) {
    // Drop it from the list straight away — this page only shows bookmarks, so
    // un-bookmarking always means "remove". Put it back if the call fails.
    const previous = leads
    setLeads((current) => current.filter((lead) => lead.id !== id))
    try {
      await leadsApi.bookmark(id, false)
    } catch {
      setLeads(previous)
      setError('Could not remove that bookmark.')
    }
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Bookmarked Leads</h1>
          <p className="text-foreground/60">Leads you&apos;ve saved for later review and action.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-foreground/50">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading your bookmarks…
          </div>
        ) : leads.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                bookmarked
                onToggleBookmark={() => removeBookmark(lead.id)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-card rounded-xl border border-border/40">
            <Bookmark className="w-8 h-8 text-foreground/25 mx-auto mb-3" />
            <p className="text-foreground/60 mb-4">No bookmarked leads yet.</p>
            <Link href="/dashboard/leads" className="text-primary hover:underline font-medium">
              Browse leads to bookmark
            </Link>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
