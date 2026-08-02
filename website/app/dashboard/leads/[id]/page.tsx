'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { ArrowLeft, MessageCircle, Send, ExternalLink, BookmarkCheck, Share2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const [showMessage, setShowMessage] = useState(false)
  const [message, setMessage] = useState('')

  // Mock lead data
  const lead = {
    id: params.id,
    title: 'E-commerce Website Redesign',
    platform: 'upwork',
    platformIcon: '💼',
    platformColor: 'blue',
    description: 'We are looking for a talented and experienced web developer to redesign our e-commerce website. Our current site is outdated and needs a modern UI/UX with improved user experience. Must have strong experience with React and payment integration.',
    budget: '$5,000 - $10,000',
    timeline: '3-4 weeks',
    level: 'Intermediate',
    postedTime: '2 hours ago',
    expiresIn: '30 days',
    skills: ['React', 'Next.js', 'Tailwind CSS', 'Payment Integration', 'Database Design', 'UI/UX'],
    clientName: 'Digital Solutions Inc.',
    clientRating: 4.8,
    clientJobs: 24,
    clientSuccessRate: '92%',
    fullDescription: `We are looking for a talented and experienced web developer to redesign our e-commerce website. Our current site is outdated and needs a modern UI/UX with improved user experience.

Key Requirements:
- 5+ years of web development experience
- Strong proficiency in React and Next.js
- Experience with Stripe or similar payment gateways
- Knowledge of SQL and database design
- Understanding of SEO best practices
- Ability to work with design files (Figma)

Responsibilities:
- Design and implement responsive website layouts
- Integrate payment processing system
- Optimize for performance and SEO
- Implement user authentication
- Create comprehensive documentation

We expect the project to be completed within 3-4 weeks and want someone who can communicate regularly and provide progress updates.`,
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Back button */}
        <Link href="/dashboard/leads" className="flex items-center gap-2 text-primary hover:underline">
          <ArrowLeft className="w-4 h-4" />
          Back to leads
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header */}
            <div className="bg-card rounded-xl border border-border/40 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{lead.platformIcon}</span>
                    <span className="text-sm font-semibold text-blue-600 bg-blue-500/10 px-2 py-1 rounded-full">
                      {lead.platform.charAt(0).toUpperCase() + lead.platform.slice(1)}
                    </span>
                  </div>
                  <h1 className="text-3xl font-bold mb-2">{lead.title}</h1>
                  <p className="text-foreground/60 text-sm">Posted {lead.postedTime}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button className="p-2 hover:bg-secondary rounded-lg transition">
                    <BookmarkCheck className="w-6 h-6 text-accent" />
                  </button>
                  <button className="p-2 hover:bg-secondary rounded-lg transition">
                    <Share2 className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Key Info */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-secondary rounded-lg">
                <div>
                  <p className="text-xs text-foreground/60 font-medium">Budget</p>
                  <p className="text-lg font-bold">{lead.budget}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground/60 font-medium">Timeline</p>
                  <p className="text-lg font-bold">{lead.timeline}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground/60 font-medium">Level</p>
                  <p className="text-lg font-bold">{lead.level}</p>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="bg-card rounded-xl border border-border/40 p-6">
              <h2 className="text-xl font-bold mb-4">About this opportunity</h2>
              <div className="prose prose-invert max-w-none text-foreground/80 whitespace-pre-wrap">
                {lead.fullDescription}
              </div>
            </div>

            {/* Skills */}
            <div className="bg-card rounded-xl border border-border/40 p-6">
              <h2 className="text-xl font-bold mb-4">Required skills</h2>
              <div className="flex flex-wrap gap-2">
                {lead.skills.map((skill, idx) => (
                  <span key={idx} className="px-3 py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* CTA */}
            <div className="bg-card rounded-xl border border-border/40 p-6 space-y-3">
              <Button className="w-full gap-2" size="lg">
                <MessageCircle className="w-5 h-5" />
                Send Proposal
              </Button>
              <Button variant="outline" className="w-full gap-2" size="lg">
                <ExternalLink className="w-5 h-5" />
                Open on {lead.platform}
              </Button>
            </div>

            {/* Client Info */}
            <div className="bg-card rounded-xl border border-border/40 p-6 space-y-4">
              <h3 className="font-bold text-lg">About the client</h3>
              
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="font-bold text-lg">DS</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{lead.clientName}</p>
                  <p className="text-sm text-foreground/60">Verified client</p>
                </div>
              </div>

              <div className="border-t border-border/40 pt-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-foreground/60">Rating</span>
                  <span className="font-semibold">⭐ {lead.clientRating}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-foreground/60">Total jobs</span>
                  <span className="font-semibold">{lead.clientJobs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-foreground/60">Success rate</span>
                  <span className="font-semibold">{lead.clientSuccessRate}</span>
                </div>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-accent/10 rounded-xl border border-accent/20 p-4">
              <p className="text-sm text-accent-foreground">
                <strong>Tip:</strong> Personalize your proposal and highlight relevant experience to increase your chances of winning this project.
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
