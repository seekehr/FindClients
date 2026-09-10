import { Users } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

/**
 * How many proposals an Upwork job already has — the first thing worth knowing
 * about it, because a job with fewer than five is one you can still win by
 * being early. Coloured by how open the field still is.
 */

/** "Proposals: Less than 5" → "Less than 5". Older leads kept Upwork's label. */
export function proposalsTier(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').replace(/^proposals:\s*/i, '').trim()
}

function tone(tier: string): 'success' | 'gold' | 'neutral' {
  const t = tier.toLowerCase()
  // The feed tile says "Fewer than 5"; the job page says "Less than 5".
  if (/^(fewer|less) than 5\b/.test(t)) return 'success'
  if (t.startsWith('5 to 10')) return 'gold'
  return 'neutral'
}

export function ProposalsBadge({ value }: { value: unknown }) {
  const tier = proposalsTier(value)
  if (!tier) return null
  return (
    <Badge tone={tone(tier)} title="Proposals already sent on Upwork">
      <Users className="size-3" aria-hidden />
      {tier} proposals
    </Badge>
  )
}
