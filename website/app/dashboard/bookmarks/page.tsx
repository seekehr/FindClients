'use client'

import DashboardLayout from '@/components/dashboard-layout'
import LeadCard from '@/components/lead-card'

const mockBookmarkedLeads = [
  {
    id: '4',
    title: 'Discord Bot Development',
    platform: 'discord' as const,
    description: 'Need a Discord bot developer to create a custom bot with moderation, welcome messages, and role management features.',
    budget: '$1,500 - $3,000',
    timeline: '2 weeks',
    postedTime: '3 hours ago',
    tags: ['Discord', 'Python', 'Bot Development'],
    bookmarked: true,
  },
  {
    id: '5',
    title: 'UI/UX Design Services',
    platform: 'upwork' as const,
    description: 'Looking for an experienced UI/UX designer to design wireframes and mockups for our new SaaS product. Need 5-10 screens.',
    budget: '$3,000 - $5,000',
    timeline: '3 weeks',
    postedTime: '5 hours ago',
    tags: ['UI/UX', 'Figma', 'Design System'],
    bookmarked: true,
  },
]

export default function BookmarksPage() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Bookmarked Leads</h1>
          <p className="text-foreground/60">Leads you&apos;ve saved for later review and action.</p>
        </div>

        {/* Leads Grid */}
        {mockBookmarkedLeads.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {mockBookmarkedLeads.map(lead => (
              <LeadCard key={lead.id} {...lead} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-card rounded-xl border border-border/40">
            <p className="text-foreground/60 mb-4">No bookmarked leads yet.</p>
            <a href="/dashboard/leads" className="text-primary hover:underline font-medium">
              Browse leads to bookmark
            </a>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
