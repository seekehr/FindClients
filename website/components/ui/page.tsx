import { cn } from '@/lib/utils'

/**
 * Page scaffolding.
 *
 * Every screen uses the same container width, the same gutter (16px on mobile,
 * 24px from `sm` up) and the same 24px gap between sections. Nothing in a page
 * body sets its own outer padding.
 */
function PageShell({
  className,
  width = 'wide',
  ...props
}: React.ComponentProps<'div'> & { width?: 'wide' | 'narrow' }) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-6 sm:px-6 sm:py-8',
        width === 'wide' ? 'max-w-[1360px]' : 'max-w-3xl',
        className,
      )}
      {...props}
    />
  )
}

function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-display text-2xl leading-8 font-semibold tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  )
}

/** Small uppercase label used above dense groups of numbers. */
function Eyebrow({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'text-[0.6875rem] leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  )
}

/** Horizontal proportion bar. Gold by default because it is always the metric. */
function Meter({
  value,
  className,
  tone = 'gold',
}: {
  /** 0–100. */
  value: number
  className?: string
  tone?: 'gold' | 'neutral'
}) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-graphite-800',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          tone === 'gold' ? 'bg-primary' : 'bg-graphite-500',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export { Eyebrow, Meter, PageHeader, PageShell }
