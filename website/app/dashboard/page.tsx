'use client'

import DashboardLayout from '@/components/dashboard-layout'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { BarChart3, TrendingUp, Zap, Bookmark, Loader2 } from 'lucide-react'
import { analyticsApi, leadsApi, type Lead } from '@/lib/api'

const platformColor: Record<string, string> = {
  upwork: 'bg-blue-500',
  twitter: 'bg-blue-400',
  discord: 'bg-purple-500',
}

interface Overview {
  newLeads: number
  totalLeads: number
  bookmarked: number
  contacted: number
  conversionRate: number
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [platforms, setPlatforms] = useState<{ platform: string; count: number; percentage: number }[]>([])
  const [recent, setRecent] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([analyticsApi.overview(), analyticsApi.platforms(), leadsApi.list({ limit: 3 })])
      .then(([ov, pl, leads]) => {
        setOverview(ov)
        setPlatforms(pl.data)
        setRecent(leads.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const stats = [
    { label: 'New Leads (24h)', value: overview?.newLeads ?? 0, icon: Zap },
    { label: 'Bookmarked', value: overview?.bookmarked ?? 0, icon: Bookmark },
    { label: 'Contacted', value: overview?.contacted ?? 0, icon: BarChart3 },
    { label: 'Conversion Rate', value: `${overview?.conversionRate ?? 0}%`, icon: TrendingUp },
  ]

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Dashboard</h1>
          <p className="text-foreground/60">Your lead overview.</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-foreground/50 py-16 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat, idx) => {
                const Icon = stat.icon
                return (
                  <div key={idx} className="bg-card rounded-xl border border-border/40 p-6 hover:border-border/80 transition">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-6 h-6 text-primary" />
                      </div>
                    </div>
                    <p className="text-foreground/60 text-sm mb-1">{stat.label}</p>
                    <p className="text-3xl font-bold">{stat.value}</p>
                  </div>
                )
              })}
            </div>

            {/* Recent Activity Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Recent Leads */}
              <div className="lg:col-span-2">
                <div className="bg-card rounded-xl border border-border/40 p-6 h-full">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">Recent Leads</h2>
                    <Link href="/dashboard/leads" className="text-sm text-primary hover:underline">
                      View all
                    </Link>
                  </div>
                  {recent.length === 0 ? (
                    <div className="text-center py-10 text-sm text-foreground/60">
                      No leads yet.{' '}
                      <Link href="/dashboard/connections" className="text-primary hover:underline">
                        Connect an account
                      </Link>{' '}
                      to get started.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {recent.map((lead) => (
                        <Link
                          key={lead.id}
                          href={`/dashboard/leads/${lead.id}`}
                          className="flex items-start gap-4 p-4 rounded-lg hover:bg-secondary transition cursor-pointer"
                        >
                          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
                            <span className="text-sm font-bold capitalize">{lead.platform[0]}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{lead.title}</p>
                            <p className="text-sm text-foreground/60 truncate">{lead.description}</p>
                            <p className="text-xs text-foreground/50 mt-1 capitalize">
                              {lead.postedTime} on {lead.platform}
                            </p>
                          </div>
                          {lead.budget && (
                            <div className="text-right flex-shrink-0">
                              <p className="font-semibold">{lead.budget}</p>
                              <p className="text-xs text-foreground/60">Budget</p>
                            </div>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Platform Distribution */}
              <div className="bg-card rounded-xl border border-border/40 p-6">
                <h2 className="text-xl font-bold mb-6">Platform Distribution</h2>
                {platforms.length === 0 ? (
                  <p className="text-sm text-foreground/60">No data yet.</p>
                ) : (
                  <div className="space-y-4">
                    {platforms.map((p) => (
                      <div key={p.platform}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium capitalize">{p.platform}</span>
                          <span className="text-sm font-semibold">{p.count}</span>
                        </div>
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${platformColor[p.platform] ?? 'bg-primary'}`}
                            style={{ width: `${p.percentage}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
