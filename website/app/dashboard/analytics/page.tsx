'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { TrendingUp, Eye, MessageSquare, CheckCircle } from 'lucide-react'

export default function AnalyticsPage() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Analytics</h1>
          <p className="text-foreground/60">Track your performance and lead statistics.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-foreground/60 text-sm mb-1">Leads Viewed</p>
                <p className="text-3xl font-bold">156</p>
              </div>
              <Eye className="w-8 h-8 text-primary" />
            </div>
            <p className="text-xs text-accent">+12 this week</p>
          </div>

          <div className="bg-card rounded-xl border border-border/40 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-foreground/60 text-sm mb-1">Proposals Sent</p>
                <p className="text-3xl font-bold">24</p>
              </div>
              <MessageSquare className="w-8 h-8 text-blue-500" />
            </div>
            <p className="text-xs text-accent">+5 this week</p>
          </div>

          <div className="bg-card rounded-xl border border-border/40 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-foreground/60 text-sm mb-1">Response Rate</p>
                <p className="text-3xl font-bold">28%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-xs text-accent">+2% from last month</p>
          </div>

          <div className="bg-card rounded-xl border border-border/40 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-foreground/60 text-sm mb-1">Jobs Won</p>
                <p className="text-3xl font-bold">6</p>
              </div>
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="text-xs text-accent">25% win rate</p>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Leads by Platform */}
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-xl font-bold mb-6">Leads by Platform</h2>
            <div className="space-y-4">
              {[
                { name: 'Upwork', count: 78, percentage: 50 },
                { name: 'Twitter', count: 47, percentage: 30 },
                { name: 'Discord', count: 31, percentage: 20 },
              ].map((item) => (
                <div key={item.name}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-sm text-foreground/60">{item.count}</span>
                  </div>
                  <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary rounded-full" 
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly Activity */}
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-xl font-bold mb-6">Weekly Activity</h2>
            <div className="space-y-4">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => (
                <div key={day} className="flex items-center gap-3">
                  <span className="w-12 text-sm font-medium text-foreground/60">{day}</span>
                  <div className="flex-1 h-8 bg-secondary rounded-lg flex items-center justify-center">
                    <div 
                      className="h-full bg-accent rounded-lg transition-all" 
                      style={{ width: `${[45, 52, 38, 61, 55, 42, 38][idx]}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm font-medium">{[9, 11, 8, 13, 12, 9, 8][idx]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Conversions */}
        <div className="bg-card rounded-xl border border-border/40 p-6">
          <h2 className="text-xl font-bold mb-6">Recent Conversions</h2>
          <div className="space-y-3">
            {[
              { title: 'E-commerce Website Redesign', date: '2 days ago', amount: '$8,500' },
              { title: 'Mobile App Development', date: '5 days ago', amount: '$12,000' },
              { title: 'UI/UX Design Services', date: '1 week ago', amount: '$4,200' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary transition">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-foreground/60">{item.date}</p>
                </div>
                <span className="font-semibold text-accent">{item.amount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
