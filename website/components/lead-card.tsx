'use client'

import { Bookmark, BookmarkCheck, ExternalLink, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface LeadCardProps {
  id: string
  title: string
  /** Any platform string the API returns; unknown ones fall back to a neutral badge. */
  platform: string
  description: string
  url?: string | null
  budget?: string | null
  timeline?: string | null
  bookmarked?: boolean
  postedTime: string
  tags: string[]
  onToggleBookmark?: () => void
}

const platformColors: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  upwork: { bg: 'bg-blue-500/10', text: 'text-blue-600', label: 'Upwork', icon: '💼' },
  twitter: { bg: 'bg-blue-400/10', text: 'text-blue-500', label: 'Twitter', icon: '𝕏' },
  discord: { bg: 'bg-purple-500/10', text: 'text-purple-600', label: 'Discord', icon: '🎮' },
  reddit: { bg: 'bg-orange-500/10', text: 'text-orange-600', label: 'Reddit', icon: '👽' },
  linkedin: { bg: 'bg-sky-600/10', text: 'text-sky-700', label: 'LinkedIn', icon: '💼' },
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
  onToggleBookmark,
}: LeadCardProps) {
  const platformInfo = platformColors[platform] ?? {
    bg: 'bg-secondary',
    text: 'text-foreground/70',
    label: platform,
    icon: '🔎',
  }

  return (
    <div className="bg-card rounded-xl border border-border/40 hover:border-border/80 hover:shadow-md transition overflow-hidden flex flex-col h-full">
      {/* Platform badge */}
      <div className={`${platformInfo.bg} px-4 py-3 flex items-center justify-between border-b border-border/40`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{platformInfo.icon}</span>
          <span className={`text-sm font-semibold ${platformInfo.text}`}>
            {platformInfo.label}
          </span>
        </div>
        <button
          onClick={onToggleBookmark}
          aria-label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
          className={`p-1.5 rounded-lg transition ${bookmarked ? 'bg-accent/20 text-accent' : 'hover:bg-secondary'}`}
        >
          {bookmarked ? <BookmarkCheck className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
        </button>
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col">
        {/* Title */}
        <h3 className="font-semibold text-lg mb-2 line-clamp-2 hover:text-primary transition cursor-pointer">
          {title}
        </h3>

        {/* Description */}
        <p className="text-foreground/70 text-sm mb-4 line-clamp-3 whitespace-pre-line">
          {description}
        </p>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {tags.slice(0, 3).map((tag, idx) => (
              <span key={idx} className="px-2 py-1 rounded-full bg-secondary text-xs font-medium">
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="px-2 py-1 text-xs font-medium text-foreground/50">
                +{tags.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Budget & Timeline */}
        {(budget || timeline) && (
          <div className="grid grid-cols-2 gap-3 mb-4 p-3 bg-secondary rounded-lg">
            {budget && (
              <div>
                <p className="text-xs text-foreground/60 font-medium">Budget</p>
                <p className="text-sm font-semibold">{budget}</p>
              </div>
            )}
            {timeline && (
              <div>
                <p className="text-xs text-foreground/60 font-medium">Timeline</p>
                <p className="text-sm font-semibold">{timeline}</p>
              </div>
            )}
          </div>
        )}

        {/* Posted time */}
        <p className="text-xs text-foreground/50 mb-4 mt-auto">Posted {postedTime}</p>
      </div>

      {/* Actions */}
      <div className="border-t border-border/40 p-4 flex gap-2">
        <Link href={`/dashboard/leads/${id}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full gap-2">
            <MessageCircle className="w-4 h-4" />
            View
          </Button>
        </Link>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="gap-2">
              <ExternalLink className="w-4 h-4" />
              Open
            </Button>
          </a>
        )}
      </div>
    </div>
  )
}
