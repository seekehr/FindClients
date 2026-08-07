'use client'

import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Mail, Lock, User, Loader2 } from 'lucide-react'
import { authApi, setSession, ApiError } from '@/lib/api'

export default function SignupPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('Passwords do not match')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    if (!agree) return setError('Please accept the Terms of Service')
    setLoading(true)
    try {
      const auth = await authApi.register(email, password, fullName)
      if (auth.needsEmailConfirmation || !auth.token) {
        // Supabase is configured to require email verification before sign-in.
        setNotice(`Almost there — confirm your address from the email we sent to ${email}.`)
        return
      }
      setSession(auth)
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">F</span>
          </div>
          <span className="font-bold text-lg">FindClients</span>
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create your account</h1>
          <p className="text-foreground/60">Start monitoring leads from your favorite platforms</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
            {notice}
          </div>
        )}

        {/* Form */}
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2">
              Full name
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40" />
              <input
                id="name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40" />
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40" />
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium mb-2">
              Confirm password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40" />
              <input
                id="confirm-password"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="rounded border border-border mt-1"
            />
            <span className="text-sm text-foreground/60">
              I agree to the <Link href="#" className="text-primary hover:underline">Terms of Service</Link> and <Link href="#" className="text-primary hover:underline">Privacy Policy</Link>
            </span>
          </label>

          <Button className="w-full" size="lg" type="submit" disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        {/* Login link */}
        <p className="text-center text-sm text-foreground/60 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
