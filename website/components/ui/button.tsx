import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The only button in the app.
 *
 * Every variant shares one radius (--radius-md), one border weight, one focus
 * ring and one transition, so a row of mixed variants still reads as a single
 * control group. Heights come from the 4pt scale: 32 / 36 / 40.
 */
const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center gap-2',
    'rounded-md border text-sm font-medium whitespace-nowrap',
    'transition-[background-color,border-color,color,opacity] duration-150 ease-out',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-45',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-primary text-primary-foreground hover:bg-gold-400 active:bg-gold-600',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-graphite-750 active:bg-graphite-700',
        outline:
          'border-border bg-transparent text-foreground hover:border-border-strong hover:bg-secondary/60 active:bg-secondary',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
        danger:
          'border-destructive/30 bg-destructive/10 text-destructive hover:border-destructive/50 hover:bg-destructive/20',
        link: 'h-auto border-transparent px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[0.8125rem]',
        md: 'h-9 px-4',
        lg: 'h-10 px-5',
        'icon-sm': 'size-8 p-0',
        icon: 'size-9 p-0',
        'icon-lg': 'size-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Swaps the label for a spinner without changing the button's width, so a
     * toolbar never reflows the moment you click something in it.
     */
    loading?: boolean
  }

function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  render,
  nativeButton,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      render={render}
      // A Button asked to render as a link is an anchor, not a button. Callers
      // that swap in a real <button> can say so explicitly.
      nativeButton={nativeButton ?? (render ? false : undefined)}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </span>
      )}
      <span
        className={cn(
          'inline-flex items-center gap-2',
          loading && 'invisible',
        )}
      >
        {children}
      </span>
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
