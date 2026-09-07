import { cva, type VariantProps } from 'class-variance-authority'
import {
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  TriangleAlert,
} from 'lucide-react'

import { cn } from '@/lib/utils'

/* --- Skeletons ---------------------------------------------------------- */

/**
 * Placeholder block. Skeletons mirror the real element's box so content does
 * not jump into place when it arrives.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'animate-shimmer rounded-sm bg-graphite-850',
        className,
      )}
      {...props}
    />
  )
}

/** A card-shaped skeleton, used wherever a Card is about to appear. */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-5',
        className,
      )}
    >
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-7 w-16" />
      <Skeleton className="mt-4 h-3 w-32" />
    </div>
  )
}

/* --- Inline messages ---------------------------------------------------- */

const alertVariants = cva(
  'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-5',
  {
    variants: {
      tone: {
        info: 'border-border bg-surface-raised text-graphite-300',
        gold: 'border-gold-500/25 bg-gold-500/8 text-gold-300',
        success: 'border-success/25 bg-success/8 text-graphite-200',
        warning: 'border-warning/25 bg-warning/8 text-graphite-200',
        danger: 'border-destructive/30 bg-destructive/10 text-graphite-200',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)

const alertIcons = {
  info: Info,
  gold: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const

const alertIconColor = {
  info: 'text-muted-foreground',
  gold: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
} as const

function Alert({
  tone = 'info',
  title,
  className,
  children,
  icon,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & {
    title?: React.ReactNode
    icon?: React.ReactNode
  }) {
  const Icon = alertIcons[tone ?? 'info']
  return (
    <div
      role="status"
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <span className={cn('mt-0.5 shrink-0', alertIconColor[tone ?? 'info'])}>
        {icon ?? <Icon className="size-4" aria-hidden />}
      </span>
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  )
}

/* --- Empty states -------------------------------------------------------- */

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-16 text-center',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-raised">
        <Icon className="size-5 text-muted-foreground" />
      </span>
      <p className="mt-4 font-display text-base font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-5 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* --- Busy ---------------------------------------------------------------- */

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export { Alert, EmptyState, LoadingRow, Skeleton, SkeletonCard }
