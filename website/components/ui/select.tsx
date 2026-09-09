'use client'

import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'

import { controlClass } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/**
 * A select with room to explain itself.
 *
 * The native `<select>` this replaces could only ever show one line of text at
 * the width of the field, which meant the one thing worth knowing about an
 * option — what it is actually for — had to be crammed into the same string as
 * its name and was then cut off mid-word ("Gemini 3.8 Flash — newest and
 * sharpest, r"). Splitting name from description lets the trigger stay short
 * and the list stay useful.
 *
 * It also fixes the other half of the problem: a native option list is drawn by
 * the operating system, so on a dark page it opens as a white menu in a
 * completely different typeface. This one is ours, in the same tokens as the
 * notification popover.
 */

export interface SelectOption {
  value: string
  label: string
  /** One line of what this option is for, shown beneath the label. */
  description?: string
}

interface SelectProps {
  id?: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

function Select({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  className,
}: SelectProps) {
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label

  return (
    <SelectPrimitive.Root
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as string)}
    >
      <SelectPrimitive.Trigger
        id={id}
        className={cn(
          controlClass,
          'flex h-9 cursor-pointer items-center gap-2 px-3 text-left text-sm',
          'data-[popup-open]:border-ring data-[popup-open]:ring-2 data-[popup-open]:ring-ring/25',
          className,
        )}
      >
        <SelectPrimitive.Value className="min-w-0 flex-1 truncate">
          {(current: string) => labelFor(current) ?? placeholder}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon className="flex shrink-0 text-graphite-500 transition-transform duration-150 ease-out data-[popup-open]:rotate-180">
          <ChevronDown className="size-4" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          // A standard dropdown below the field. The default overlaps the
          // trigger to line the selected item up with it, which assumes
          // single-line rows and looks wrong with a description under each.
          alignItemWithTrigger={false}
          className="z-50"
        >
          <SelectPrimitive.Popup
            className={cn(
              // Tall enough for the six models to sit without a scrollbar when
              // there is room, and it scrolls rather than overflowing when not.
              'max-h-[min(24rem,var(--available-height))] overflow-y-auto',
              // Never narrower than the field it belongs to, never so wide it
              // outgrows the column — the descriptions decide the rest.
              'min-w-[var(--anchor-width)] max-w-[min(26rem,calc(100vw-2rem))]',
              'rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover',
              // Grow out of whichever edge it is anchored to: when there is no
              // room below, Base UI flips the popup above the field, and a
              // top-origin scale would then animate away from the trigger.
              'origin-top data-[side=top]:origin-bottom',
              'transition-[opacity,transform] duration-150 ease-out',
              'data-closed:scale-[0.98] data-closed:opacity-0 data-open:scale-100 data-open:opacity-100',
            )}
          >
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'group flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5',
                  'transition-colors duration-100 ease-out outline-none',
                  'data-[highlighted]:bg-secondary/70',
                  'data-[selected]:bg-gold-500/10',
                )}
              >
                <span className="min-w-0 flex-1">
                  {/* Base UI puts data-selected on the Item, not on its children, so
                      the selected styling has to reach in from the row. */}
                  <SelectPrimitive.ItemText className="block text-sm font-medium text-foreground group-data-[selected]:text-primary">
                    {option.label}
                  </SelectPrimitive.ItemText>
                  {option.description && (
                    <span className="mt-0.5 block text-[0.8125rem] leading-5 text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>

                {/* Occupies its column whether or not it is showing, so the
                    rows do not shift as the selection moves. */}
                <span className="flex size-4 shrink-0 items-center justify-center pt-0.5">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="size-4 text-primary" aria-hidden />
                  </SelectPrimitive.ItemIndicator>
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export { Select }
