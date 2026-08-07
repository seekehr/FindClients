'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  Loader2,
  User,
  Calendar,
  Wallet,
  Clock,
} from 'lucide-react'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { ApiError, leadsApi, type Lead, type LeadStatus } from '@/lib/api'

const PLATFORMS: Record<string, { label: string; icon: string; badge: string }> = {
  upwork: { label: 'Upwork', icon: '💼', badge: 'text-blue-600 bg-blue-500/10' },
  twitter: { label: 'Twitter / X', icon: '𝕏', badge: 'text-sky-600 bg-sky-500/10' },
  discord: { label: 'Discord', icon: '🎮', badge: 'text-purple-600 bg-purple-500/10' },
  reddit: { label: 'Reddit', icon: '👽', badge: 'text-orange-600 bg-orange-500/10' },
  linkedin: { label: 'LinkedIn', icon: '💼', badge: 'text-sky-700 bg-sky-600/10' },
}

const STATUSES: { id: LeadStatus; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'viewed', label: 'Viewed' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'won', label: 'Won' },
  { id: 'archived', label: 'Archived' },
]

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-24 text-foreground/50">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading lead…
        </div>
      </DashboardLayout>
    )
  }

  if (!lead) {
    return (
      <DashboardLayout>
        <div className="p-6 max-w-2xl space-y-4">
          <Link href="/dashboard/leads" className="flex items-center gap-2 text-primary hover:underline">
            <ArrowLeft className="w-4 h-4" />
            Back to leads
          </Link>
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error || 'Lead not found.'}
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const platform = PLATFORMS[lead.platform] ?? {
    label: lead.platform,
    icon: '🔎',
    badge: 'text-foreground/70 bg-secondary',
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <Link href="/dashboard/leads" className="flex items-center gap-2 text-primary hover:underline">
          <ArrowLeft className="w-4 h-4" />
          Back to leads
        </Link>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-card rounded-xl border border-border/40 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{platform.icon}</span>
                    <span className={`text-sm font-semibold px-2 py-1 rounded-full ${platform.badge}`}>
                      {platform.label}
                    </span>
                  </div>
                  <h1 className="text-3xl font-bold mb-2">{lead.title}</h1>
                  <p className="text-foreground/60 text-sm">
                    Posted {lead.postedTime} · {new Date(lead.postedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={toggleBookmark}
                  aria-label={lead.bookmarked ? 'Remove bookmark' : 'Add bookmark'}
                  className={`p-2 rounded-lg transition shrink-0 ${
                    lead.bookmarked ? 'bg-accent/20 text-accent' : 'hover:bg-secondary'
                  }`}
                >
                  {lead.bookmarked ? (
                    <BookmarkCheck className="w-6 h-6" />
                  ) : (
                    <Bookmark className="w-6 h-6" />
                  )}
                </button>
              </div>

              {/* Only render facts the source actually gave us. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-secondary rounded-lg">
                <div>
                  <p className="text-xs text-foreground/60 font-medium flex items-center gap-1">
                    <Wallet className="w-3 h-3" /> Budget
                  </p>
                  <p className="text-lg font-bold">{lead.budget || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground/60 font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Timeline
                  </p>
                  <p className="text-lg font-bold">{lead.timeline || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground/60 font-medium flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Found
                  </p>
                  <p className="text-lg font-bold">{lead.postedTime}</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border/40 p-6">
              <h2 className="text-xl font-bold mb-4">About this opportunity</h2>
              {lead.description ? (
                <div className="max-w-none text-foreground/80 whitespace-pre-wrap break-words">
                  {lead.description}
                </div>
              ) : (
                <p className="text-foreground/50 text-sm">
                  The source post had no description. Open the original to read it in full.
                </p>
              )}
            </div>

            {lead.tags.length > 0 && (
              <div className="bg-card rounded-xl border border-border/40 p-6">
                <h2 className="text-xl font-bold mb-4">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {lead.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="bg-card rounded-xl border border-border/40 p-6 space-y-3">
              {lead.url ? (
                <a href={lead.url} target="_blank" rel="noopener noreferrer" className="block">
                  <Button className="w-full gap-2" size="lg">
                    <ExternalLink className="w-5 h-5" />
                    Open on {platform.label}
                  </Button>
                </a>
              ) : (
                <p className="text-sm text-foreground/50 text-center">
                  No source link was captured for this lead.
                </p>
              )}
              <Button variant="outline" className="w-full gap-2" size="lg" onClick={toggleBookmark}>
                {lead.bookmarked ? (
                  <BookmarkCheck className="w-5 h-5" />
                ) : (
                  <Bookmark className="w-5 h-5" />
                )}
                {lead.bookmarked ? 'Bookmarked' : 'Bookmark'}
              </Button>
            </div>

            {/* Pipeline status */}
            <div className="bg-card rounded-xl border border-border/40 p-6 space-y-3">
              <h3 className="font-bold text-lg">Your pipeline</h3>
              <p className="text-sm text-foreground/60">
                Where this lead sits for you. Drives your analytics.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => changeStatus(s.id)}
                    disabled={busy}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition disabled:opacity-50 ${
                      lead.status === s.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 hover:bg-secondary'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {lead.author && (
              <div className="bg-card rounded-xl border border-border/40 p-6 space-y-3">
                <h3 className="font-bold text-lg">Posted by</h3>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <p className="font-semibold break-all">{lead.author}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
