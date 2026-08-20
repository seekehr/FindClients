'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  authApi,
  clearSession,
  getStoredUser,
  getToken,
  setStoredUser,
  type SessionUser,
} from './api'

/**
 * Redirects to /login if there is no session. Returns the stored user
 * immediately (so the UI can paint) and refreshes it from /auth/me in the
 * background. With cookie-based auth the token may live only in an HTTP-only
 * cookie, so we always attempt /auth/me even without a localStorage token.
 */
export function useRequireAuth() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const stored = getStoredUser()
    if (stored) {
      setUser(stored)
      setChecked(true)
    }

    let cancelled = false
    authApi
      .me()
      .then(({ user }) => {
        if (cancelled) return
        setStoredUser(user)
        setUser(user)
        setChecked(true)
      })
      .catch(() => {
        if (cancelled) return
        if (!getToken() && !getStoredUser()) {
          router.replace('/login')
        }
      })

    return () => {
      cancelled = true
    }
  }, [router])

  return { user, checked, setUser }
}

export function useLogout() {
  const router = useRouter()
  return useCallback(async () => {
    await authApi.logout().catch(() => undefined)
    clearSession()
    router.replace('/login')
  }, [router])
}
