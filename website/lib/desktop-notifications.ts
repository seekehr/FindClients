'use client'

import { useEffect, useRef, useState } from 'react'
import type { Notification as AppNotification } from './api'

/**
 * Desktop notifications for new job alerts and leads.
 *
 * These are the browser's own notifications, raised by whichever dashboard tab
 * is open — so they reach you while you work in another window, but not with
 * every FindClients tab closed. For your phone, use the Discord webhook.
 *
 * On or off is a choice about *this* browser (it needs this browser's
 * permission), so it is kept in localStorage rather than in data/config.json.
 */

const PREF_KEY = 'findclients.desktopNotifications'

export type DesktopNotificationState = 'unsupported' | 'blocked' | 'off' | 'on'

function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function prefOn(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on'
  } catch {
    return false
  }
}

function setPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked — the toggle just will not survive a reload.
  }
}

export function desktopNotificationState(): DesktopNotificationState {
  if (!supported()) return 'unsupported'
  if (window.Notification.permission === 'denied') return 'blocked'
  return window.Notification.permission === 'granted' && prefOn() ? 'on' : 'off'
}

/** Must be called from a click: browsers only show the permission prompt then. */
export async function setDesktopNotifications(on: boolean): Promise<DesktopNotificationState> {
  if (!supported()) return 'unsupported'
  if (on && window.Notification.permission !== 'granted') {
    await window.Notification.requestPermission()
  }
  setPref(on && window.Notification.permission === 'granted')
  return desktopNotificationState()
}

/** The toggle's state, re-read whenever the tab regains focus. */
export function useDesktopNotificationState() {
  const [state, setState] = useState<DesktopNotificationState>('off')
  useEffect(() => {
    const refresh = () => setState(desktopNotificationState())
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  return [state, setState] as const
}

/**
 * Raise a desktop notification for every in-app notification that arrives
 * while this tab is open.
 *
 * The first list this sees is the baseline: whatever was already in the feed
 * when the page loaded is old news, and popping up ten of them on every reload
 * would train you to ignore the ones that matter.
 */
export function useDesktopNotifications(notifications: AppNotification[], loaded: boolean) {
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!loaded) return
    if (seen.current === null) {
      seen.current = new Set(notifications.map((n) => n.id))
      return
    }

    const fresh = notifications.filter((n) => !n.read && !seen.current!.has(n.id))
    for (const n of notifications) seen.current.add(n.id)
    if (!fresh.length || desktopNotificationState() !== 'on') return

    for (const n of fresh) {
      // `tag` makes a second open dashboard tab replace this one rather than
      // showing the same job twice.
      const shown = new window.Notification(n.title, { body: n.message, tag: n.id })
      shown.onclick = () => {
        window.focus()
        if (n.leadId) window.location.assign(`/dashboard/leads/${n.leadId}`)
        shown.close()
      }
    }
  }, [notifications, loaded])
}
