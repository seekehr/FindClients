'use client'

import { Bookmark } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import DashboardLayout from '@/components/dashboard-layout'
import LeadCard from '@/components/lead-card'
import { Button } from '@/components/ui/button'
import { Alert, EmptyState, LoadingRow } from '@/components/ui/feedback'
import { PageHeader, PageShell } from '@/components/ui/page'
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
      setError(
        err instanceof ApiError ? err.message : 'Could not load your bookmarks.',
      )
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
      <PageShell className="space-y-6">
        <PageHeader
          title="Bookmarks"
          description="Leads you flagged to come back to. Removing one here leaves it in your main list."
        />

        {error && <Alert tone="danger" title={error} />}

        {loading ? (
          <LoadingRow label="Loading your bookmarks" />
        ) : leads.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                bookmarked
                onToggleBookmark={() => removeBookmark(lead.id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState
              icon={Bookmark}
              title="Nothing saved yet"
              description="Use the bookmark button on any lead to keep it here while you decide whether to pitch."
              action={
                <Button
                  variant="outline"
                  render={<Link href="/dashboard/leads" />}
                >
                  Browse leads
                </Button>
              }
            />
          </div>
        )}
      </PageShell>
    </DashboardLayout>
  )
}
