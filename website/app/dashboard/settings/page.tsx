'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Lock, Shield, Loader2, Check, SlidersHorizontal } from 'lucide-react'
import { ApiError, authApi, clearSession, setStoredUser } from '@/lib/api'
import { useRequireAuth } from '@/lib/use-auth'

/**
 * Account settings. Everything about *what* gets scraped lives on the Config
 * page; this page is only about the account itself.
 */
export default function SettingsPage() {
  const router = useRouter()
  const { user } = useRequireAuth()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [profileState, setProfileState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [profileError, setProfileError] = useState('')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordState, setPasswordState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [passwordError, setPasswordError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Seed the form once the session user resolves.
  useEffect(() => {
    if (!user) return
    setFullName(user.fullName)
    setEmail(user.email)
  }, [user])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileError('')
    setProfileState('saving')
    try {
      const { user: updated } = await authApi.updateProfile({ fullName, email })
      setStoredUser(updated)
      setProfileState('saved')
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not save your profile')
      setProfileState('idle')
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError('')
    if (newPassword.length < 8) return setPasswordError('Password must be at least 8 characters')
    if (newPassword !== confirmPassword) return setPasswordError('New passwords do not match')

    setPasswordState('saving')
    try {
      await authApi.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordState('saved')
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Could not change your password')
      setPasswordState('idle')
    }
  }

  async function deleteAccount() {
    setDeleteError('')
    setDeleting(true)
    try {
      await authApi.deleteAccount()
      clearSession()
      router.replace('/signup')
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete your account')
      setDeleting(false)
    }
  }

  const inputClass =
    'w-full px-4 py-2 rounded-lg border border-border bg-secondary text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50'

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-2xl">
        <div>
          <h1 className="text-4xl font-bold mb-2">Settings</h1>
          <p className="text-foreground/60">Manage your account.</p>
        </div>

        {/* Pointer to the other page, so neither has to guess where a knob lives */}
        <Link
          href="/dashboard/config"
          className="flex items-center gap-3 rounded-xl border border-border/40 bg-secondary/40 p-4 hover:bg-secondary transition"
        >
          <SlidersHorizontal className="w-5 h-5 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Looking for keywords, platforms or notifications?</p>
            <p className="text-sm text-foreground/60">They live on the Config page.</p>
          </div>
        </Link>

        {/* Profile */}
        <form onSubmit={saveProfile} className="bg-card rounded-xl border border-border/40 p-6 space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Profile
          </h2>

          {profileError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {profileError}
            </div>
          )}

          <div>
            <label htmlFor="fullName" className="block text-sm font-medium mb-2">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value)
                setProfileState('idle')
              }}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setProfileState('idle')
              }}
              className={inputClass}
            />
            <p className="text-xs text-foreground/50 mt-1">
              This is the address you sign in with.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={profileState === 'saving'} className="gap-2">
              {profileState === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </Button>
            {profileState === 'saved' && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-500">
                <Check className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </form>

        {/* Password */}
        <form onSubmit={savePassword} className="bg-card rounded-xl border border-border/40 p-6 space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Password
          </h2>

          {passwordError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {passwordError}
            </div>
          )}

          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium mb-2">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium mb-2">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={passwordState === 'saving' || !currentPassword || !newPassword}
              className="gap-2"
            >
              {passwordState === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
              Update password
            </Button>
            {passwordState === 'saved' && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-500">
                <Check className="w-4 h-4" /> Password updated
              </span>
            )}
          </div>
        </form>

        {/* Danger zone */}
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 space-y-4">
          <h2 className="text-xl font-bold text-destructive flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Danger zone
          </h2>

          <p className="text-sm text-foreground/70">
            Deleting your account removes your profile, config, saved leads and connected sessions.
            This cannot be undone.
          </p>

          {deleteError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/20 px-4 py-3 text-sm text-destructive">
              {deleteError}
            </div>
          )}

          <div>
            <label htmlFor="confirmDelete" className="block text-sm font-medium mb-2">
              Type <span className="font-mono font-bold">DELETE</span> to confirm
            </label>
            <input
              id="confirmDelete"
              type="text"
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder="DELETE"
              className={inputClass}
            />
          </div>

          <Button
            variant="outline"
            onClick={deleteAccount}
            disabled={confirmDelete !== 'DELETE' || deleting}
            className="w-full text-destructive border-destructive/50 hover:bg-destructive/10 gap-2"
          >
            {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
            Delete account
          </Button>
        </div>
      </div>
    </DashboardLayout>
  )
}
