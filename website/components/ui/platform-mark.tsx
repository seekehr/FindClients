import { platformMeta } from '@/lib/platforms'
import { cn } from '@/lib/utils'

/**
 * The square typographic mark that stands in for a platform logo. One shape,
 * one surface, one radius — so a mixed list of sources stays calm.
 */
function PlatformMark({
  platform,
  size = 'md',
  className,
}: {
  platform: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const meta = platformMeta(platform)
  return (
    <span
      aria-hidden
      title={meta.label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-graphite-850 font-display font-semibold text-graphite-300',
        size === 'sm' && 'size-7 text-[0.6875rem]',
        size === 'md' && 'size-9 text-xs',
        size === 'lg' && 'size-11 text-sm',
        className,
      )}
    >
      {meta.mark}
    </span>
  )
}

export { PlatformMark }
