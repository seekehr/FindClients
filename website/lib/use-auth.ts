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
 * background, which also validates that the token is still good.
 */
export function useRequireAuth() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }

    setUser(getStoredUser())
    setChecked(true)

    let cancelled = false
    authApi
      .me()
      .then(({ user }) => {
        if (cancelled) return
        setStoredUser(user)
        setUser(user)
      })
      .catch(() => {
        // api() has already cleared an unrecoverable session.
        if (!cancelled && !getToken()) router.replace('/login')
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
    // Revoking server-side is best effort; the local session goes either way.
    await authApi.logout().catch(() => undefined)
    clearSession()
    router.replace('/login')
  }, [router])
}
