import { cn } from '@/lib/utils'

/**
 * The FindClients mark: a lens over a graphite tile. Drawn rather than
 * imported so it stays sharp at every size and always uses the gold token.
 */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-gold-500/30 bg-gold-500/10',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        className="size-4 text-primary"
        aria-hidden
      >
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M15 15.2 19.5 19.7" />
      </svg>
    </span>
  )
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-display text-[0.9375rem] leading-5 font-semibold tracking-[-0.01em]',
        className,
      )}
    >
      FindClients
    </span>
  )
}

export { BrandMark, Wordmark }
