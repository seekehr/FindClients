'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { BarChart3, TrendingUp, Zap, Users } from 'lucide-react'

const mockStats = [
  { label: 'New Leads', value: '24', change: '+12%', icon: Zap },
  { label: 'Bookmarked', value: '8', change: '+2', icon: Users },
  { label: 'Contacted', value: '12', change: '+3', icon: BarChart3 },
  { label: 'Conversion Rate', value: '24%', change: '+5%', icon: TrendingUp },
]

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Dashboard</h1>
          <p className="text-foreground/60">Welcome back! Here&apos;s your lead overview.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {mockStats.map((stat, idx) => {
            const Icon = stat.icon
            return (
              <div key={idx} className="bg-card rounded-xl border border-border/40 p-6 hover:border-border/80 transition">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <span className="text-xs font-semibold text-accent px-2 py-1 bg-accent/10 rounded-full">
                    {stat.change}
                  </span>
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
            <div className="bg-card rounded-xl border border-border/40 p-6">
              <h2 className="text-xl font-bold mb-6">Recent Leads</h2>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-4 p-4 rounded-lg hover:bg-secondary transition cursor-pointer">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-sm font-bold">L{i}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">Lead title {i}</p>
                      <p className="text-sm text-foreground/60 truncate">Brief description of the opportunity...</p>
                      <p className="text-xs text-foreground/50 mt-1">2 hours ago on Upwork</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold">$500-$2k</p>
                      <p className="text-xs text-foreground/60">Budget</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Platform Distribution */}
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-xl font-bold mb-6">Platform Distribution</h2>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Upwork</span>
                  <span className="text-sm font-semibold">12</span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-3/4 bg-blue-500 rounded-full" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Twitter</span>
                  <span className="text-sm font-semibold">7</span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-1/2 bg-blue-400 rounded-full" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Discord</span>
                  <span className="text-sm font-semibold">5</span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-1/3 bg-purple-500 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
