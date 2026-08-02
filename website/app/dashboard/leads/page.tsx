'use client'

import DashboardLayout from '@/components/dashboard-layout'
import LeadCard from '@/components/lead-card'
import { useState } from 'react'
import { Search, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'

const mockLeads = [
  {
    id: '1',
    title: 'E-commerce Website Redesign',
    platform: 'upwork' as const,
    description: 'Looking for a talented web developer to redesign our e-commerce website. We need modern UI/UX with payment integration.',
    budget: '$5,000 - $10,000',
    timeline: '3-4 weeks',
    postedTime: '2 hours ago',
    tags: ['Web Design', 'React', 'Payment Integration'],
  },
  {
    id: '2',
    title: 'Mobile App Development',
    platform: 'upwork' as const,
    description: 'We need a React Native developer to build a cross-platform mobile app for our startup. Must have experience with APIs.',
    budget: '$8,000 - $15,000',
    timeline: '6-8 weeks',
    postedTime: '4 hours ago',
    tags: ['React Native', 'Mobile', 'Backend Integration'],
  },
  {
    id: '3',
    title: 'Social Media Campaign',
    platform: 'twitter' as const,
    description: 'Social media expert needed! Looking for someone to manage our Twitter/X and LinkedIn accounts. Need daily posts and engagement.',
    budget: '$2,000/month',
    timeline: 'Ongoing',
    postedTime: '1 hour ago',
    tags: ['Social Media', 'Content', 'Engagement'],
  },
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
  },
  {
    id: '6',
    title: 'API Development',
    platform: 'twitter' as const,
    description: 'Senior backend developer needed to build RESTful APIs for our platform. Must have experience with Node.js and MongoDB.',
    budget: '$10,000 - $20,000',
    timeline: '8-10 weeks',
    postedTime: '6 hours ago',
    tags: ['Node.js', 'MongoDB', 'API'],
  },
]

export default function LeadsPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredLeads = mockLeads.filter(lead => {
    const matchesPlatform = !selectedPlatform || lead.platform === selectedPlatform
    const matchesSearch = !searchTerm || 
      lead.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.description.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesPlatform && matchesSearch
  })

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Leads</h1>
          <p className="text-foreground/60">Browse and manage all your discovered opportunities.</p>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/40" />
            <input
              type="text"
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="flex gap-2">
            <Button 
              variant={selectedPlatform === null ? "default" : "outline"}
              onClick={() => setSelectedPlatform(null)}
              size="sm"
            >
              All
            </Button>
            <Button 
              variant={selectedPlatform === 'upwork' ? "default" : "outline"}
              onClick={() => setSelectedPlatform('upwork')}
              size="sm"
            >
              Upwork
            </Button>
            <Button 
              variant={selectedPlatform === 'twitter' ? "default" : "outline"}
              onClick={() => setSelectedPlatform('twitter')}
              size="sm"
            >
              Twitter
            </Button>
            <Button 
              variant={selectedPlatform === 'discord' ? "default" : "outline"}
              onClick={() => setSelectedPlatform('discord')}
              size="sm"
            >
              Discord
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" />
              More Filters
            </Button>
          </div>
        </div>

        {/* Leads Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredLeads.map(lead => (
            <LeadCard key={lead.id} {...lead} />
          ))}
        </div>

        {filteredLeads.length === 0 && (
          <div className="text-center py-12">
            <p className="text-foreground/60 mb-4">No leads found matching your criteria.</p>
            <Button variant="outline" onClick={() => { setSearchTerm(''); setSelectedPlatform(null); }}>
              Clear filters
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
