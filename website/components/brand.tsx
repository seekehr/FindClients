import { cn } from '@/lib/utils'

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

export { Wordmark }
