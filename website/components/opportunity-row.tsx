'use client'

import { ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { PlatformMark } from '@/components/ui/platform-mark'
import type { Opportunity } from '@/lib/api'
import { duration } from '@/lib/use-watch-status'
import { cn } from '@/lib/utils'

/**
 * One job alert in the New Opportunities feed.
 *
 * Two things are deliberately on the face of the row rather than hidden in a
 * detail view: how long ago the job was *posted*, and how long FindClients
 * *held it* before telling you. The hold is the whole safety mechanism of this
 * feature, and a number you can see is the only way to know it is working —
 * an alert that always says "held 4s" means the pacing has been turned down to
 * something that will get the account noticed.
 */
export default function OpportunityRow({
  opportunity,
  compact = false,
}: {
  opportunity: Opportunity
  /** Trims the row for the Overview card, where space is tighter. */
  compact?: boolean
}) {
  const facts = [
    opportunity.postedTime,
    `held ${duration(opportunity.heldForSeconds)}`,
    opportunity.client,
  ].filter(Boolean)

  const href = opportunity.leadId ? `/dashboard/leads/${opportunity.leadId}` : null
  // Rejections are filed under their own filter, never announced, so they are
  // never "unread" — including ones stored before that rule existed.
  const unread = !opportunity.seen && opportunity.verdict !== 'rejected'

  const title = (
    <span className={cn('line-clamp-2 font-display font-semibold', compact ? 'text-sm' : 'text-[0.9375rem] leading-5')}>
      {opportunity.title}
    </span>
  )

  return (
    <li
      className={cn(
        'relative flex items-start gap-3 px-5 py-4 transition-colors',
        unread && 'bg-gold-500/[0.06]',
      )}
    >
      {/* Unread marker. A rail rather than a dot, so a run of new alerts reads
          as one block at a glance. */}
      {unread && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
      )}

      <PlatformMark platform={opportunity.platform} size={compact ? 'sm' : 'md'} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {href ? (
              <Link
                href={href}
                className="block rounded-sm text-foreground transition-colors hover:text-primary"
              >
                {title}
              </Link>
            ) : (
              <span className="block text-foreground">{title}</span>
            )}
          </div>

          {opportunity.budget && (
            <span className="shrink-0 text-[0.8125rem] font-medium text-graphite-200 tabular">
              {opportunity.budget}
            </span>
          )}
        </div>

        <p className="mt-1 truncate text-[0.8125rem] leading-5 text-muted-foreground">
          {facts.join(' · ')}
        </p>

        {!compact && (opportunity.verdict || opportunity.tags.length > 0 || opportunity.url) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {opportunity.verdict === 'qualified' && (
              <Badge tone="success" dot>
                Qualified{opportunity.score !== null ? ` ${opportunity.score}` : ''}
              </Badge>
            )}
            {opportunity.verdict === 'rejected' && (
              <Badge tone="danger" dot>
                Rejected{opportunity.score !== null ? ` ${opportunity.score}` : ''}
              </Badge>
            )}
            {opportunity.verdict === 'skipped' && (
              <Badge tone="warning" title="Gemini's rate limit was reached, so this job was sent without an AI review.">
                Not AI reviewed
              </Badge>
            )}
            {opportunity.verdict === 'error' && <Badge tone="warning">AI check failed</Badge>}
            {opportunity.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
            {opportunity.url && (
              <a
                href={opportunity.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded-sm text-[0.8125rem] font-medium text-primary hover:underline"
              >
                Open on Upwork
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
