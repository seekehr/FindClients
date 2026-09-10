'use client'

import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'

import DashboardLayout from '@/components/dashboard-layout'
import { AiVerdictBadge } from '@/components/lead-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, LoadingRow } from '@/components/ui/feedback'
import { Eyebrow, PageShell } from '@/components/ui/page'
import { PlatformMark } from '@/components/ui/platform-mark'
import { ApiError, leadsApi, type Lead, type LeadStatus } from '@/lib/api'
import { platformMeta } from '@/lib/platforms'
import { cn } from '@/lib/utils'

const STATUSES: { id: LeadStatus; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'viewed', label: 'Viewed' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'won', label: 'Won' },
  { id: 'archived', label: 'Archived' },
]

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1.5 truncate font-display text-base font-semibold tabular">
        {value}
      </p>
    </div>
  )
}

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    leadsApi
      .get(id)
      .then(({ lead }) => {
        if (!cancelled) setLead(lead)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError && err.status === 404
              ? 'That lead no longer exists.'
              : 'Could not load this lead.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  async function toggleBookmark() {
    if (!lead) return
    const next = !lead.bookmarked
    setLead({ ...lead, bookmarked: next })
    try {
      await leadsApi.bookmark(lead.id, next)
    } catch {
      setLead({ ...lead, bookmarked: !next })
    }
  }

  async function changeStatus(status: LeadStatus) {
    if (!lead || status === lead.status) return
    const previous = lead.status
    setLead({ ...lead, status })
    setBusy(true)
    try {
      await leadsApi.setStatus(lead.id, status)
    } catch {
      setLead({ ...lead, status: previous })
      setError('Could not update the status.')
    } finally {
      setBusy(false)
    }
  }

  const backLink = (
    <Link
      href="/dashboard/leads"
      className="inline-flex items-center gap-2 rounded-sm text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      All leads
    </Link>
  )

  if (loading) {
    return (
      <DashboardLayout>
        <PageShell>
          <LoadingRow label="Loading lead" />
        </PageShell>
      </DashboardLayout>
    )
  }

  if (!lead) {
    return (
      <DashboardLayout>
        <PageShell width="narrow" className="space-y-4">
          {backLink}
          <Alert tone="danger" title={error || 'Lead not found.'} />
        </PageShell>
      </DashboardLayout>
    )
  }

  const meta = platformMeta(lead.platform)

  return (
    <DashboardLayout>
      <PageShell className="space-y-6">
        {backLink}

        {error && <Alert tone="danger" title={error} />}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardContent className="space-y-5">
                <div className="flex items-start gap-4">
                  <PlatformMark platform={lead.platform} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.8125rem] font-medium text-graphite-300">
                        {meta.label}
                      </span>
                      <span
                        className="size-0.5 shrink-0 rounded-full bg-graphite-500"
                        aria-hidden
                      />
                      <span className="text-[0.8125rem] text-muted-foreground">
                        Posted {lead.postedTime}
                      </span>
                      <AiVerdictBadge ai={lead.ai} platform={lead.platform} />
                    </div>
                    <h1 className="mt-2 font-display text-2xl leading-8 font-semibold tracking-[-0.02em]">
                      {lead.title}
                    </h1>
                    <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
                      {new Date(lead.postedAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleBookmark}
                    aria-label={
                      lead.bookmarked ? 'Remove bookmark' : 'Save this lead'
                    }
                    aria-pressed={lead.bookmarked}
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ease-out',
                      lead.bookmarked
                        ? 'border-gold-500/30 bg-gold-500/10 text-primary'
                        : 'border-border text-graphite-500 hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    {lead.bookmarked ? (
                      <BookmarkCheck className="size-4" />
                    ) : (
                      <Bookmark className="size-4" />
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface-raised p-4 sm:grid-cols-3">
                  <Fact label="Budget" value={lead.budget || '—'} />
                  <Fact label="Timeline" value={lead.timeline || '—'} />
                  <Fact label="Found" value={lead.postedTime} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>The post</CardTitle>
              </CardHeader>
              <CardContent>
                {lead.description ? (
                  <div className="text-sm leading-6 break-words whitespace-pre-wrap text-graphite-300">
                    {lead.description}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The source post had no description. Open the original to read
                    it in full.
                  </p>
                )}
              </CardContent>
            </Card>

            {lead.ai.verdict && lead.ai.reason && (
              <Card>
                <CardHeader>
                  <CardTitle>AI review</CardTitle>
                  <Badge
                    tone={
                      lead.ai.verdict === 'qualified'
                        ? 'success'
                        : lead.ai.verdict === 'rejected'
                          ? 'danger'
                          : 'warning'
                    }
                    dot
                  >
                    {lead.ai.verdict === 'qualified'
                      ? 'Qualified'
                      : lead.ai.verdict === 'rejected'
                        ? 'Rejected'
                        : 'Check failed'}
                    {lead.ai.score !== null ? ` · ${lead.ai.score}` : ''}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm leading-6 text-graphite-300">
                    {lead.ai.reason}
                  </p>
                  {lead.ai.model && (
                    <p className="text-xs text-muted-foreground">
                      Judged by {lead.ai.model}
                      {lead.ai.checkedAt
                        ? ` on ${new Date(lead.ai.checkedAt).toLocaleString()}`
                        : ''}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {lead.tags.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Tags</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {lead.tags.map((tag) => (
                    <Badge key={tag} tone="neutral">
                      {tag}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-2">
                {lead.url ? (
                  <Button
                    className="w-full"
                    render={
                      <a
                        href={lead.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    <ExternalLink className="size-4" />
                    Open on {meta.label}
                  </Button>
                ) : (
                  <p className="py-1 text-center text-[0.8125rem] text-muted-foreground">
                    No source link was captured for this lead.
                  </p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={toggleBookmark}
                >
                  {lead.bookmarked ? (
                    <BookmarkCheck className="size-4" />
                  ) : (
                    <Bookmark className="size-4" />
                  )}
                  {lead.bookmarked ? 'Saved' : 'Save for later'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pipeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[0.8125rem] leading-5 text-muted-foreground">
                  Where this lead sits for you. This is what your analytics
                  count.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {STATUSES.map((status) => {
                    const active = lead.status === status.id
                    return (
                      <button
                        key={status.id}
                        type="button"
                        onClick={() => changeStatus(status.id)}
                        disabled={busy}
                        aria-pressed={active}
                        className={cn(
                          'h-9 rounded-md border px-3 text-[0.8125rem] font-medium transition-colors duration-150 ease-out disabled:opacity-45',
                          active
                            ? 'border-gold-500/30 bg-gold-500/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                      >
                        {status.label}
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {lead.author && (
              <Card>
                <CardHeader>
                  <CardTitle>Posted by</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised">
                    <User className="size-4 text-muted-foreground" />
                  </span>
                  <p className="min-w-0 text-sm font-medium break-all">
                    {lead.author}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </PageShell>
    </DashboardLayout>
  )
}
