'use client'

import { useEffect, useRef, useState } from 'react'
import { scrapeApi, type ScrapeStatus } from './api'

const IDLE_POLL_MS = 20_000
const ACTIVE_POLL_MS = 5_000

const EMPTY: ScrapeStatus = { running: false, runs: [], lastFinishedAt: null }

/**
 * Tracks whether a scrape is in flight.
 *
 * Polls slowly when idle and quickly while a run is active, and calls
 * `onFinished` on the running → idle edge so a page can refresh the data a
 * completed run just produced.
 */
export function useScrapeStatus(onFinished?: () => void) {
  const [status, setStatus] = useState<ScrapeStatus>(EMPTY)

  // Keep the callback in a ref so a caller passing an inline arrow function
  // doesn't restart the polling loop on every render.
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let wasRunning = false

    async function tick() {
      try {
        const next = await scrapeApi.status()
        if (cancelled) return

        setStatus(next)
        if (wasRunning && !next.running) finishedRef.current?.()
        wasRunning = next.running

        timer = setTimeout(tick, next.running ? ACTIVE_POLL_MS : IDLE_POLL_MS)
      } catch {
        // Offline or signed out — back off and let the next tick recover.
        if (!cancelled) timer = setTimeout(tick, IDLE_POLL_MS)
      }
    }

    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return status
}

const PLATFORM_LABELS: Record<string, string> = {
  upwork: 'Upwork',
  twitter: 'Twitter / X',
  discord: 'Discord',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
}

/** "Twitter / X" · "Upwork and Twitter / X" · "3 platforms" */
export function describePlatforms(runs: { platform: string }[]): string {
  const names = [...new Set(runs.map((r) => PLATFORM_LABELS[r.platform] ?? r.platform))]
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.length} platforms`
}
