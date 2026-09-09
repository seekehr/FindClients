'use client'

import { useEffect, useRef, useState } from 'react'
import { opportunitiesApi, watchApi, type WatcherStatus } from './api'

/**
 * What the Upwork watcher is doing, shared by every component that asks.
 *
 * One poller for the whole page, like `use-scrape-status`: the header shows a
 * "watching" pill and an unread count on every screen, and the Opportunities
 * page shows a countdown, so three independent timers would otherwise be
 * hitting the same two endpoints.
 *
 * The interval is short — the panel's whole promise is that a job appears
 * without you refreshing, and a five-second lag between the server releasing an
 * alert and the badge moving would quietly break that. On localhost each poll
 * reads two in-memory arrays.
 */

const POLL_MS = 5_000

export interface WatchSnapshot {
  watcher: WatcherStatus | null
  /** Alerts you have not looked at yet. Drives the sidebar badge. */
  unseen: number
  /** Total alerts on file, so an empty state can tell "none yet" from "all read". */
  total: number
  /** False until the first successful poll, so nothing flashes an empty state. */
  loaded: boolean
}

const EMPTY: WatchSnapshot = { watcher: null, unseen: 0, total: 0, loaded: false }

let current: WatchSnapshot = EMPTY
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false

const subscribers = new Set<(snapshot: WatchSnapshot) => void>()

function publish(next: WatchSnapshot) {
  current = next
  for (const notify of subscribers) notify(next)
}

async function tick() {
  if (inFlight) return
  inFlight = true
  try {
    const [status, opportunities] = await Promise.all([
      watchApi.status(),
      opportunitiesApi.list({ limit: 1 }),
    ])
    publish({
      watcher: status.watcher,
      unseen: opportunities.unseen,
      total: opportunities.total,
      loaded: true,
    })
  } catch {
    // Server restarting or briefly unreachable — keep the last known state and
    // let the next tick recover, rather than flashing "not watching".
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
  timer = setTimeout(tick, POLL_MS)
}

/** Check right now — after pressing a button, or on returning to the tab. */
export function refreshWatchStatus() {
  void tick()
}

/** Optimistically zero the badge, so marking alerts read feels immediate. */
export function clearUnseenLocally() {
  publish({ ...current, unseen: 0 })
}

function onVisible() {
  if (document.visibilityState === 'visible') refreshWatchStatus()
}

/**
 * @param onAlert Called when the number of alerts on file goes up — i.e. the
 *   watcher just released one. Pages use it to pull the new opportunity in
 *   without waiting for their own refresh.
 */
export function useWatchStatus(onAlert?: () => void): WatchSnapshot {
  const [snapshot, setSnapshot] = useState<WatchSnapshot>(current)

  // Held in a ref so an inline arrow function does not tear down and rebuild
  // the subscription on every render.
  const alertRef = useRef(onAlert)
  alertRef.current = onAlert

  const lastTotal = useRef(current.total)

  useEffect(() => {
    const notify = (next: WatchSnapshot) => {
      setSnapshot(next)
      const grew = next.loaded && next.total > lastTotal.current
      lastTotal.current = next.total
      if (grew) alertRef.current?.()
    }

    subscribers.add(notify)
    if (subscribers.size === 1) {
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', refreshWatchStatus)
    }
    void tick()

    return () => {
      subscribers.delete(notify)
      if (subscribers.size === 0) {
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('focus', refreshWatchStatus)
        if (timer) clearTimeout(timer)
        timer = null
      }
    }
  }, [])

  return snapshot
}

/* ── Describing the watcher in words ─────────────────────────────────────── */

export interface WatchTone {
  /** Badge / dot colour. */
  tone: 'success' | 'gold' | 'warning' | 'danger' | 'neutral'
  label: string
}

export function describeWatchState(watcher: WatcherStatus | null): WatchTone {
  if (!watcher || !watcher.enabled) return { tone: 'neutral', label: 'Off' }

  switch (watcher.state) {
    case 'watching':
      return { tone: 'success', label: 'Watching' }
    case 'checking':
      return { tone: 'gold', label: 'Checking' }
    case 'starting':
      return { tone: 'gold', label: 'Opening tab' }
    case 'blocked':
      return { tone: 'warning', label: 'Bot check' }
    case 'signed-out':
      return { tone: 'danger', label: 'Signed out' }
    case 'browser-down':
      return { tone: 'danger', label: 'Chrome down' }
    case 'error':
      return { tone: 'danger', label: 'Problem' }
    default:
      return { tone: 'neutral', label: 'Paused' }
  }
}

/** "in 4m 12s" · "any moment now". Used for both the next check and the queue. */
export function countdown(iso: string | null): string {
  if (!iso) return ''
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds <= 5) return 'any moment now'
  if (seconds < 60) return `in ${seconds}s`
  const mins = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `in ${mins}m ${String(rest).padStart(2, '0')}s`
}

/** "2m 30s" — a duration, not a countdown. */
export function duration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return `${whole}s`
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
}
