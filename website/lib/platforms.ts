/**
 * Platform identity, in one place.
 *
 * Deliberately monochrome: a lead list is scanned, not admired, so the
 * platform mark is a typographic initial on the neutral surface rather than a
 * coloured emoji. Gold stays reserved for the actions you can take.
 */
export interface PlatformMeta {
  id: string
  label: string
  /** One or two characters for the square mark. */
  mark: string
  /** Where the leads come from, shown on Connections. */
  site: string
}

const PLATFORMS: Record<string, PlatformMeta> = {
  upwork: { id: 'upwork', label: 'Upwork', mark: 'Up', site: 'upwork.com' },
  twitter: { id: 'twitter', label: 'Twitter / X', mark: 'X', site: 'x.com' },
  discord: { id: 'discord', label: 'Discord', mark: 'Dc', site: 'discord.com' },
  reddit: { id: 'reddit', label: 'Reddit', mark: 'Rd', site: 'reddit.com' },
  linkedin: { id: 'linkedin', label: 'LinkedIn', mark: 'in', site: 'linkedin.com' },
}

/** Never throws on a platform the API knows about and this build does not. */
export function platformMeta(id: string): PlatformMeta {
  return (
    PLATFORMS[id] ?? {
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      mark: id.slice(0, 2),
      site: id,
    }
  )
}

export function platformLabel(id: string): string {
  return platformMeta(id).label
}

/** The platforms that have a working scraper today. */
export const SUPPORTED_PLATFORMS = new Set(['upwork', 'twitter'])
