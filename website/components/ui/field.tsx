'use client'

import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * Form primitives.
 *
 * Every control is 36px tall, uses --radius-md, sits on the same input
 * surface, and shows the same focus ring. `Field` owns the label/hint/error
 * layout so no page has to reinvent the vertical rhythm around an input.
 */

const controlClass = [
  'w-full rounded-md border border-border bg-input text-foreground',
  'placeholder:text-muted-foreground',
  'transition-[border-color,box-shadow] duration-150 ease-out',
  'hover:border-border-strong',
  'focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25',
  'disabled:cursor-not-allowed disabled:opacity-45',
  'aria-[invalid=true]:border-destructive/60 aria-[invalid=true]:focus:ring-destructive/25',
].join(' ')

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('block text-sm font-medium text-foreground', className)}
      {...props}
    />
  )
}

function Hint({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="hint"
      className={cn('text-[0.8125rem] leading-5 text-muted-foreground', className)}
      {...props}
    />
  )
}

interface FieldProps {
  label: string
  hint?: React.ReactNode
  error?: string
  htmlFor?: string
  className?: string
  children: React.ReactNode
}

function Field({ label, hint, error, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-[0.8125rem] leading-5 text-destructive">{error}</p>
      ) : hint ? (
        <Hint>{hint}</Hint>
      ) : null}
    </div>
  )
}

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(controlClass, 'h-9 px-3 text-sm', className)}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlClass, 'block px-3 py-2 text-sm leading-6', className)}
      {...props}
    />
  )
}

function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        controlClass,
        'h-9 cursor-pointer appearance-none bg-no-repeat px-3 pr-9 text-sm',
        // Chevron drawn in the token colour rather than the OS default arrow,
        // which is the one part of a native select that never matches a theme.
        "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a7a5a0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        'bg-[position:right_0.75rem_center]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Numeric input that clamps on the way out, so a field can never submit a
 * value the API would reject.
 */
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        className="tabular"
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isNaN(next)) return
          onChange(Math.min(max, Math.max(min, Math.round(next))))
        }}
      />
    </Field>
  )
}

export { Field, Hint, Input, Label, NumberField, Select, Textarea, controlClass }
