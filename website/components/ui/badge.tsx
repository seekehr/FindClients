import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Status and metadata labels. Rectilinear (--radius-sm) like every other
 * chip in the app; pills are reserved for counts and dots.
 */
const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs leading-5 font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-secondary/70 text-graphite-300',
        gold: 'border-gold-500/25 bg-gold-500/10 text-gold-400',
        success: 'border-success/25 bg-success/10 text-success',
        warning: 'border-warning/25 bg-warning/10 text-warning',
        danger: 'border-destructive/25 bg-destructive/10 text-destructive',
        outline: 'border-border bg-transparent text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

function Badge({
  className,
  tone,
  dot = false,
  children,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    >
      {dot && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-current"
          aria-hidden
        />
      )}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
