import { db } from './index';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/time';
import { hashPassword } from '../utils/auth';
import { insertLeads } from '../services/lead.service';
import { PLAN_LIMITS } from '../services/billing.service';
import { logger } from '../utils/logger';
import type { RawLead } from '../types';

const DEMO_EMAIL = 'demo@findclients.dev';
const DEMO_PASSWORD = 'demo12345';

const ago = (mins: number) => new Date(Date.now() - mins * 60 * 1000);

// Mirrors the sample leads the website frontend ships with, plus a few extras.
const STARTER_LEADS: RawLead[] = [
  {
    title: 'E-commerce Website Redesign',
    platform: 'upwork',
    description:
      'Looking for a talented web developer to redesign our e-commerce website. We need modern UI/UX with payment integration.',
    budget: '$5,000 - $10,000',
    timeline: '3-4 weeks',
    tags: ['Web Design', 'React', 'Payment Integration'],
    url: 'https://example.com/upwork/redesign-1',
    postedAt: ago(120),
  },
  {
    title: 'Mobile App Development',
    platform: 'upwork',
    description:
      'We need a React Native developer to build a cross-platform mobile app for our startup. Must have experience with APIs.',
    budget: '$8,000 - $15,000',
    timeline: '6-8 weeks',
    tags: ['React Native', 'Mobile', 'Backend Integration'],
    url: 'https://example.com/upwork/mobile-2',
    postedAt: ago(240),
  },
  {
    title: 'Social Media Campaign',
    platform: 'twitter',
    description:
      'Social media expert needed! Looking for someone to manage our Twitter/X and LinkedIn accounts. Need daily posts and engagement.',
    budget: '$2,000/month',
    timeline: 'Ongoing',
    tags: ['Social Media', 'Content', 'Engagement'],
    url: 'https://example.com/twitter/social-3',
    postedAt: ago(60),
  },
  {
    title: 'Discord Bot Development',
    platform: 'discord',
    description:
      'Need a Discord bot developer to create a custom bot with moderation, welcome messages, and role management features.',
    budget: '$1,500 - $3,000',
    timeline: '2 weeks',
    tags: ['Discord', 'Python', 'Bot Development'],
    url: 'https://example.com/discord/bot-4',
    postedAt: ago(180),
  },
  {
    title: 'UI/UX Design Services',
    platform: 'upwork',
    description:
      'Looking for an experienced UI/UX designer to design wireframes and mockups for our new SaaS product. Need 5-10 screens.',
    budget: '$3,000 - $5,000',
    timeline: '3 weeks',
    tags: ['UI/UX', 'Figma', 'Design System'],
    url: 'https://example.com/upwork/uiux-5',
    postedAt: ago(300),
  },
  {
    title: 'API Development',
    platform: 'twitter',
    description:
      'Senior backend developer needed to build RESTful APIs for our platform. Must have experience with Node.js and MongoDB.',
    budget: '$10,000 - $20,000',
    timeline: '8-10 weeks',
    tags: ['Node.js', 'MongoDB', 'API'],
    url: 'https://example.com/twitter/api-6',
    postedAt: ago(360),
  },
];

/** Seed a demo user (idempotent). Returns the user id. */
async function seedDemoUser(): Promise<string> {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;

  const now = nowIso();
  const id = newId('user');
  db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, plan, created_at)
     VALUES (?, ?, ?, ?, 'pro', ?)`,
  ).run(id, DEMO_EMAIL, await hashPassword(DEMO_PASSWORD), 'Demo User', now);
  db.prepare('INSERT INTO settings (user_id, updated_at) VALUES (?, ?)').run(id, now);
  db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, leads_limit, updated_at)
     VALUES (?, 'pro', 'active', ?, ?)`,
  ).run(id, PLAN_LIMITS.pro, now);

  logger.info(`Seeded demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  return id;
}

/** Insert starter leads if the leads table is empty. */
function seedLeads(): number {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM leads').get() as { c: number }).c;
  if (count > 0) return 0;
  const inserted = insertLeads(STARTER_LEADS);
  logger.info(`Seeded ${inserted.length} starter leads`);
  return inserted.length;
}

/** Run on boot: seed only what's missing. */
export async function ensureSeed(): Promise<void> {
  await seedDemoUser();
  seedLeads();
}

// Allow `npm run seed` to (re)seed on demand.
if (require.main === module) {
  ensureSeed()
    .then(() => {
      logger.info('Seed complete.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Seed failed', err);
      process.exit(1);
    });
}
