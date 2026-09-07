'use client'

import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * Accessible on/off control. The thumb slides; nothing else moves, so a row of
 * settings never reflows when one is toggled.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-graphite-800 p-0.5',
        'transition-colors duration-150 ease-out',
        'data-checked:border-transparent data-checked:bg-primary',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'size-4 rounded-full bg-graphite-300 shadow-sm',
          'transition-[transform,background-color] duration-150 ease-out',
          'data-checked:translate-x-4 data-checked:bg-primary-foreground',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

/**
 * The row form used everywhere in Config: label and hint on the left, switch
 * on the right, whole row clickable.
 */
function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-6 py-1">
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="block cursor-pointer text-sm font-medium text-foreground"
        >
          {label}
        </label>
        {hint && (
          <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next)}
        className="mt-0.5"
      />
    </div>
  )
}

export { Switch, SwitchRow }
