import { Button } from '@/components/ui/button'
import { ArrowRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">F</span>
            </div>
            <span className="font-semibold text-base">FindClients</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-6 text-sm text-foreground/70">
              <Link href="#" className="hover:text-foreground transition">Solutions</Link>
              <Link href="#" className="hover:text-foreground transition">Platforms</Link>
              <Link href="#" className="hover:text-foreground transition">Community</Link>
              <Link href="#" className="hover:text-foreground transition">Resources</Link>
            </div>
            <Link href="/login" className="text-sm text-foreground/70 hover:text-foreground transition">
              Log in
            </Link>
            <Link href="/signup">
              <Button size="sm" variant="outline">Sign up</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative px-6 py-24 md:py-32 overflow-hidden">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          {/* Left: Copy */}
          <div className="space-y-6">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight text-balance">
              FindClients is the AI lead monitor for standout work
            </h1>
            
            <p className="text-base md:text-lg text-foreground/70 leading-relaxed max-w-md">
              Automatically discover and manage opportunities from Upwork, Twitter, Discord, and beyond. Focus on your best leads.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <Link href="/signup">
                <Button size="lg" className="gap-2">
                  Get started for free <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="gap-2">
                Download app <ExternalLink className="w-4 h-4" />
              </Button>
            </div>

            <div className="text-xs text-foreground/60 pt-8">
              <Link href="#" className="text-primary hover:text-accent transition">
                FindClients 2.0 Everything we shipped →
              </Link>
            </div>
          </div>

          {/* Right: Visual with 3D tilted cards */}
          <div className="relative h-96 md:h-full min-h-96 rounded-lg border border-primary/40 bg-card/30 overflow-hidden flex items-center justify-center perspective">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent" />
            <div className="relative w-full h-full flex items-center justify-center" style={{ perspective: '1200px' }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="absolute w-24 h-32 md:w-32 md:h-40 rounded-lg border border-primary/60 bg-primary/5 flex-shrink-0 transition-transform duration-500 hover:scale-110"
                  style={{
                    transform: `rotateY(${(i - 2) * 22}deg) rotateX(${(i - 2) * 12}deg) translateZ(${(i - 2) * 50}px) translateX(${(i - 2) * 70}px)`,
                    opacity: 0.7 + (i * 0.06),
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Used by Section */}
      <section className="px-6 py-16 border-t border-border/40">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs text-foreground/60 uppercase tracking-widest mb-8 font-medium">Used by</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 items-center">
            {['Upwork', 'Fiverr', 'Twitter', 'Discord', 'LinkedIn', 'Slack'].map((platform) => (
              <div key={platform} className="text-sm font-medium text-foreground/60 hover:text-foreground transition cursor-pointer">
                {platform}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agents Section */}
      <section className="px-6 py-20 md:py-24 border-t border-border/40">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-start">
            {/* Left: Visual */}
            <div className="relative rounded-lg border border-border/40 bg-card/30 overflow-hidden h-96 md:h-full min-h-96 flex items-center justify-center order-2 md:order-1">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
              <div className="relative text-center text-foreground/40 space-y-4">
                <div className="text-sm font-medium">AI Lead Detection</div>
                <div className="w-32 h-32 mx-auto rounded-lg border border-primary/40 bg-primary/5" />
              </div>
            </div>

            {/* Right: Copy */}
            <div className="space-y-6 flex flex-col justify-center order-1 md:order-2">
              <h2 className="text-4xl md:text-5xl font-bold leading-tight text-balance">
                Lead agents that work alongside you
              </h2>
              
              <p className="text-base md:text-lg text-foreground/70 leading-relaxed">
                Configure smart filters once, then let AI-powered agents continuously discover opportunities that match your criteria. Everything stays under your control.
              </p>

              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <h4 className="font-semibold text-foreground text-sm">Multi-platform support</h4>
                  <p className="text-sm text-foreground/60">Monitor Upwork, Twitter, Discord, and more from one dashboard.</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold text-foreground text-sm">Smart filtering</h4>
                  <p className="text-sm text-foreground/60">Filter by budget, keywords, client reviews, and custom criteria.</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold text-foreground text-sm">Real-time alerts</h4>
                  <p className="text-sm text-foreground/60">Get instant notifications when matching opportunities appear.</p>
                </div>
              </div>

              <div className="pt-4">
                <Link href="#" className="text-primary hover:text-accent transition inline-flex items-center gap-2 text-sm font-medium">
                  Start with agents <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-20 md:py-24 border-t border-border/40">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 leading-tight text-balance">
            Ready to find better leads?
          </h2>
          <p className="text-base md:text-lg text-foreground/70 mb-8 max-w-2xl mx-auto">
            Join freelancers and agencies discovering high-quality opportunities daily.
          </p>
          <Link href="/signup">
            <Button size="lg" className="gap-2">
              Start your journey <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 px-6 py-16 md:py-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Product</h4>
              <ul className="space-y-2 text-xs text-foreground/60">
                <li><Link href="#" className="hover:text-foreground transition">Features</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Pricing</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Templates</Link></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Company</h4>
              <ul className="space-y-2 text-xs text-foreground/60">
                <li><Link href="#" className="hover:text-foreground transition">About</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Blog</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Careers</Link></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Resources</h4>
              <ul className="space-y-2 text-xs text-foreground/60">
                <li><Link href="#" className="hover:text-foreground transition">Docs</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">API</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Support</Link></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Legal</h4>
              <ul className="space-y-2 text-xs text-foreground/60">
                <li><Link href="#" className="hover:text-foreground transition">Privacy</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Terms</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border/40 pt-8 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-xs">F</span>
              </div>
              <span className="font-semibold text-sm">FindClients</span>
            </div>
            <div className="text-xs text-foreground/60">
              © 2024 FindClients. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
