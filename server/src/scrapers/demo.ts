import type { Platform, RawLead, Scraper, ScrapeContext } from './types';

/**
 * Built-in synthetic scrapers. They generate plausible-looking leads so the
 * whole pipeline (schedule → scrape → dedupe → store → notify → API) is visibly
 * alive before the real scrapers in `scrapper/` are implemented.
 *
 * Toggle with USE_DEMO_SCRAPERS in .env.
 */

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const chance = (p: number) => Math.random() < p;

const SKILLS = [
  'React', 'Next.js', 'Node.js', 'TypeScript', 'Python', 'Django', 'React Native',
  'Figma', 'UI/UX', 'Webflow', 'Shopify', 'WordPress', 'SEO', 'Copywriting',
  'Discord Bot', 'Automation', 'AWS', 'PostgreSQL', 'MongoDB', 'AI/LLM',
];

const TEMPLATES: Record<Platform, { titles: string[]; budgets: string[]; timelines: string[] }> = {
  upwork: {
    titles: [
      'E-commerce Website Redesign',
      'Mobile App Development (React Native)',
      'SaaS Dashboard Build-out',
      'Landing Page + Payment Integration',
      'Bug Fixes on Existing Next.js App',
      'API Development with Node.js',
    ],
    budgets: ['$500 - $1,500', '$2,000 - $5,000', '$5,000 - $10,000', '$8,000 - $15,000'],
    timelines: ['1 week', '2-3 weeks', '4-6 weeks', 'Ongoing'],
  },
  twitter: {
    titles: [
      'Looking for a dev to build our MVP',
      'Need a designer for our brand refresh',
      'Anyone do Shopify stores? DMs open',
      'Hiring: part-time automation engineer',
      'Who can build a Chrome extension?',
    ],
    budgets: ['$1,000/mo', '$2,500 fixed', 'Negotiable', '$3,000 - $6,000'],
    timelines: ['ASAP', 'This month', 'Flexible'],
  },
  discord: {
    titles: [
      'Discord bot with moderation + roles',
      'Need help with a trading bot',
      'Community manager wanted',
      'Custom Midjourney workflow build',
      'Looking for a backend dev for our game',
    ],
    budgets: ['$300 - $800', '$1,500 - $3,000', 'Rev share', '$2,000'],
    timelines: ['1-2 weeks', 'Ongoing', 'This weekend'],
  },
  reddit: { titles: [], budgets: [], timelines: [] },
  linkedin: { titles: [], budgets: [], timelines: [] },
};

function makeLead(platform: Platform): RawLead {
  const t = TEMPLATES[platform];
  const title = pick(t.titles);
  const tags = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => pick(SKILLS));
  return {
    title,
    platform,
    description: `${title}. Looking for someone reliable with ${tags.join(', ')} experience. Please share relevant portfolio pieces and availability.`,
    budget: chance(0.85) ? pick(t.budgets) : null,
    timeline: chance(0.7) ? pick(t.timelines) : null,
    url: `https://example.com/${platform}/${Math.random().toString(36).slice(2, 10)}`,
    author: `user_${Math.random().toString(36).slice(2, 7)}`,
    tags: [...new Set(tags)],
    postedAt: new Date(Date.now() - Math.floor(Math.random() * 3 * 60 * 60 * 1000)),
  };
}

function demoScraper(platform: Platform, name: string): Scraper {
  return {
    platform,
    name,
    async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
      // Emit 0–3 fresh leads per run so counts grow gradually.
      const count = Math.min(ctx.limit, Math.floor(Math.random() * 4));
      ctx.log(`generating ${count} demo lead(s)`);
      return Array.from({ length: count }, () => makeLead(platform));
    },
  };
}

export const demoScrapers: Scraper[] = [
  demoScraper('upwork', 'Upwork (demo)'),
  demoScraper('twitter', 'Twitter/X (demo)'),
  demoScraper('discord', 'Discord (demo)'),
];
