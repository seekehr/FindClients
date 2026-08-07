'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu, X, LogOut, Bell } from 'lucide-react'
import { useRequireAuth, useLogout } from '@/lib/use-auth'

interface DashboardLayoutProps {
  children: React.ReactNode
}

const menuItems = [
  { label: 'Dashboard', href: '/dashboard', icon: '📊' },
  { label: 'Leads', href: '/dashboard/leads', icon: '🔍' },
  { label: 'Bookmarks', href: '/dashboard/bookmarks', icon: '🔖' },
  { label: 'Connections', href: '/dashboard/connections', icon: '🔌' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: '📈' },
  { label: 'Config', href: '/dashboard/config', icon: '🎛️' },
  { label: 'Settings', href: '/dashboard/settings', icon: '⚙️' },
]

function initials(name: string, email: string) {
  const src = (name || email || '?').trim()
  const parts = src.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const { user, checked } = useRequireAuth()
  const logout = useLogout()

  // Avoid a flash of protected content before the auth check resolves.
  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground/50">
        Loading…
      </div>
    )
  }

  const displayName = user?.fullName || user?.email || 'Account'

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 fixed lg:relative w-64 h-screen bg-card border-r border-border/40 transition-transform duration-300 z-40 flex flex-col`}
      >
        {/* Logo */}
        <div className="p-6 border-b border-border/40">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">F</span>
            </div>
            <span className="font-bold text-lg">FindClients</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {menuItems.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                  active
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-foreground/70 hover:bg-primary/10 hover:text-primary'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-border/40 space-y-2">
          <button
            onClick={() => void logout()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-foreground/70 hover:bg-destructive/10 hover:text-destructive transition"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-16 border-b border-border/40 bg-card/50 backdrop-blur-sm flex items-center px-6 gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 hover:bg-secondary rounded-lg transition"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div className="flex-1" />

          {/* User profile */}
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-secondary rounded-lg transition relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
            </button>
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-sm font-bold">{initials(user?.fullName ?? '', user?.email ?? '')}</span>
              </div>
              <span className="hidden sm:inline text-sm font-medium">{displayName}</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 lg:hidden z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  )
}
