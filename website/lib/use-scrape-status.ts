'use client'

import { useEffect, useRef, useState } from 'react'
import { scrapeApi, type ScrapeStatus } from './api'

/**
 * Whether a scrape is in flight, shared by every component that asks.
 *
 * One poller for the whole page, not one per component. The header shows a
 * scraping pill on every screen and individual pages show their own inline
 * state, so a naive hook would have three components independently hitting
 * `/api/scrape/status` on their own timers.
 *
 * Polling at all is the right call here despite being unfashionable: a scrape
 * can start from the scheduler, this tab, or another tab, and the server has no
 * way to push. On localhost the request reads an in-memory array, so it costs
 * approximately nothing — which is why the idle interval is seconds rather than
 * the half-minute it used to be. That delay was the whole reason a running
 * scrape only appeared after a manual reload.
 */

const IDLE_POLL_MS = 5_000
const ACTIVE_POLL_MS = 2_000

const EMPTY: ScrapeStatus = { running: false, runs: [], lastFinishedAt: null }

let current: ScrapeStatus = EMPTY
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false

const subscribers = new Set<(status: ScrapeStatus) => void>()

function publish(next: ScrapeStatus) {
  current = next
  for (const notify of subscribers) notify(next)
}

async function tick() {
  if (inFlight) return
  inFlight = true
  try {
    publish(await scrapeApi.status())
  } catch {
    // Server restarting or briefly unreachable — keep the last known state and
    // let the next tick recover rather than flashing "not running".
  } finally {
    inFlight = false
    schedule()
  }
}

function schedule() {
  if (timer) clearTimeout(timer)
  if (!subscribers.size) {
    timer = null
    return
  }
  timer = setTimeout(tick, current.running ? ACTIVE_POLL_MS : IDLE_POLL_MS)
}

/** Check right now — after starting a scrape, or on returning to the tab. */
export function refreshScrapeStatus() {
  void tick()
}

function onVisible() {
  if (document.visibilityState === 'visible') refreshScrapeStatus()
}

/**
 * @param onFinished Called when a scrape run completes. Fires on each platform
 *   finishing, not only when the whole cycle ends — with two scrapers running
 *   back to back, waiting for the cycle meant Twitter's leads sat invisible for
 *   however long Upwork took.
 */
export function useScrapeStatus(onFinished?: () => void) {
  const [status, setStatus] = useState<ScrapeStatus>(current)

  // Held in refs so a caller passing an inline arrow function does not tear
  // down and rebuild the subscription on every render.
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  const wasRunning = useRef(current.running)
  const lastFinished = useRef(current.lastFinishedAt)

  useEffect(() => {
    const notify = (next: ScrapeStatus) => {
      setStatus(next)

      const cycleEnded = wasRunning.current && !next.running
      const platformEnded = next.lastFinishedAt !== lastFinished.current

      wasRunning.current = next.running
      lastFinished.current = next.lastFinishedAt

      if (cycleEnded || platformEnded) finishedRef.current?.()
    }

    subscribers.add(notify)
    if (subscribers.size === 1) {
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', refreshScrapeStatus)
    }
    void tick()

    return () => {
      subscribers.delete(notify)
      if (subscribers.size === 0) {
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('focus', refreshScrapeStatus)
        if (timer) clearTimeout(timer)
        timer = null
      }
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
