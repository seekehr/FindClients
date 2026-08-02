import 'dotenv/config';
import path from 'node:path';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const rootDir = path.resolve(__dirname, '..', '..');

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),

  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwtSecret: process.env.JWT_SECRET ?? 'dev-super-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',

  databaseFile: path.isAbsolute(process.env.DATABASE_FILE ?? '')
    ? (process.env.DATABASE_FILE as string)
    : path.join(rootDir, process.env.DATABASE_FILE ?? './data/findclients.db'),

  schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
  scrapeCron: process.env.SCRAPE_CRON ?? '*/2 * * * *',
  useDemoScrapers: bool(process.env.USE_DEMO_SCRAPERS, true),

  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',

  rootDir,
} as const;
