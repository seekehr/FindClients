'use client'

import { Bookmark, BookmarkCheck, ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PlatformMark } from '@/components/ui/platform-mark'
import { platformMeta } from '@/lib/platforms'
import type { LeadAiReview } from '@/lib/api'
import { cn } from '@/lib/utils'

interface LeadCardProps {
  id: string
  title: string
  /** Any platform string the API returns; unknown ones fall back to their name. */
  platform: string
  description: string
  url?: string | null
  budget?: string | null
  timeline?: string | null
  bookmarked?: boolean
  postedTime: string
  tags: string[]
  ai?: LeadAiReview
  onToggleBookmark?: () => void
}

export default function LeadCard({
  id,
  title,
  platform,
  description,
  url,
  budget,
  timeline,
  bookmarked = false,
  postedTime,
  tags,
  ai,
  onToggleBookmark,
}: LeadCardProps) {
  const meta = platformMeta(platform)
  const facts = [
    budget ? { label: 'Budget', value: budget } : null,
    timeline ? { label: 'Timeline', value: timeline } : null,
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <Card interactive className="h-full">
      <div className="flex items-start gap-3 p-5 pb-4">
        <PlatformMark platform={platform} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.8125rem] font-medium text-graphite-300">
              {meta.label}
            </span>
            <span
              className="size-0.5 shrink-0 rounded-full bg-graphite-500"
              aria-hidden
            />
            <span className="shrink-0 text-[0.8125rem] text-muted-foreground">
              {postedTime}
            </span>
          </div>

          <Link
            href={`/dashboard/leads/${id}`}
            className="mt-1 block font-display text-[0.9375rem] leading-5 font-semibold text-foreground transition-colors hover:text-primary"
          >
            <span className="line-clamp-2">{title}</span>
          </Link>
        </div>

        <button
          type="button"
          onClick={onToggleBookmark}
          aria-label={bookmarked ? 'Remove bookmark' : 'Save this lead'}
          aria-pressed={bookmarked}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ease-out',
            bookmarked
              ? 'border-gold-500/30 bg-gold-500/10 text-primary'
              : 'border-transparent text-graphite-500 hover:border-border hover:bg-secondary hover:text-foreground',
          )}
        >
          {bookmarked ? (
            <BookmarkCheck className="size-4" />
          ) : (
            <Bookmark className="size-4" />
          )}
        </button>
      </div>

      <div className="flex-1 px-5">
        <p className="line-clamp-3 text-[0.8125rem] leading-5 whitespace-pre-line text-muted-foreground">
          {description}
        </p>

        {(facts.length > 0 || tags.length > 0 || ai?.verdict) && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {facts.map((fact) => (
              <Badge key={fact.label} tone="outline">
                <span className="text-muted-foreground">{fact.label}</span>
                <span className="text-graphite-200 tabular">{fact.value}</span>
              </Badge>
            ))}
            {ai?.verdict === 'qualified' && (
              <Badge tone="success" dot>
                Qualified{ai.score !== null ? ` ${ai.score}` : ''}
              </Badge>
            )}
            {ai?.verdict === 'rejected' && (
              <Badge tone="danger" dot>
                Rejected{ai.score !== null ? ` ${ai.score}` : ''}
              </Badge>
            )}
            {tags.slice(0, 2).map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
            {tags.length > 2 && (
              <span className="text-xs text-muted-foreground">
                +{tags.length - 2}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-border px-5 py-3">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          render={<Link href={`/dashboard/leads/${id}`} />}
        >
          View lead
        </Button>
        {url && (
          <Button
            size="sm"
            variant="ghost"
            render={
              <a href={url} target="_blank" rel="noopener noreferrer" />
            }
          >
            <ExternalLink className="size-3.5" />
            Open
          </Button>
        )}
      </div>
    </Card>
  )
}
