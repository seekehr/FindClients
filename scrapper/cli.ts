/**
 * Standalone scraper CLI. Does not need the API server.
 *
 * From this folder:
 *   npm run cli
 *
 * Settings come from cli_config.json. Paste a browser Cookie header
 * (raw, no quoting) into upwork.cookie / twitter.cookie in this folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRootEnv } from './lib/env';
import { seedUserConfig } from './lib/api';
import { scrapers } from './index';
import type { SessionCookie, UserConfig } from '../server/src/scrapers/types';

loadRootEnv();

const ROOT = __dirname;

interface PlatformCliConfig {
  /** Optional path to a text file containing the raw Cookie header. */
  cookieFile?: string;
  /** Inline Cookie header — avoid this; quotes in cookies break JSON. */
  cookie?: string;
  /** Or a list of cookies (takes priority over files/`cookie` if non-empty). */
  cookies?: SessionCookie[];
  jobsUrl?: string;
  fetchDetails?: boolean;
  maxAgeHours?: number;
  keywords?: string[];
  minLikes?: number;
  minViews?: number;
  limitPerKeyword?: number;
  maxPostAgeHours?: number;
}

interface CliConfig {
  headless?: boolean;
  limit?: number;
  userId?: string;
  upwork?: PlatformCliConfig;
  twitter?: PlatformCliConfig;
}

function parseCookieHeader(header: string, domain: string): SessionCookie[] {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      return {
        name: part.slice(0, eq).trim(),
        value: part.slice(eq + 1).trim(),
        domain,
        path: '/',
      };
    })
    .filter((c) => c.name && c.value);
}

function readCookieHeader(
  platformName: string,
  platform: PlatformCliConfig | undefined,
  configDir: string,
): string {
  const files: string[] = [];
  if (platform?.cookieFile) files.push(path.resolve(configDir, platform.cookieFile));
  files.push(path.join(configDir, `${platformName}.cookie`));

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8').trim();
    if (text.includes('=')) return text;
  }

  const inline = platform?.cookie?.trim();
  if (inline?.includes('=')) return inline;
  return '';
}

function cookiesFor(
  platformName: string,
  platform: PlatformCliConfig | undefined,
  domain: string,
  configDir: string,
): SessionCookie[] {
  if (platform?.cookies?.length) {
    const listed = platform.cookies
      .filter((c) => c.name?.trim() && c.value?.trim())
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || domain,
        path: c.path || '/',
      }));
    if (listed.length) return listed;
  }

  const header = readCookieHeader(platformName, platform, configDir);
  return header ? parseCookieHeader(header, domain) : [];
}

function loadConfig(filePath: string): CliConfig {
  if (!fs.existsSync(filePath)) {
    console.error(
      `Missing ${filePath}\nCopy cli_config.example.json to cli_config.json.`,
    );
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CliConfig;
  } catch (err) {
    console.error(`Could not parse ${filePath}: ${(err as Error).message}`);
    process.exit(1);
  }
}

function userConfigFromCli(file: CliConfig): UserConfig {
  const tw = file.twitter ?? {};
  const uw = file.upwork ?? {};
  return {
    emailNotifications: false,
    pushNotifications: false,
    newLeadsNotification: false,
    discordWebhookUrl: '',
    platforms: ['upwork', 'twitter'],
    keywords: tw.keywords?.length
      ? tw.keywords
      : ['looking for a developer', 'looking to hire'],
    excludedKeywords: [],
    minBudget: 0,
    scrapeEnabled: true,
    leadsPerRun: file.limit ?? 10,
    maxPostAgeHours: tw.maxPostAgeHours ?? 48,
    twitterMinLikes: tw.minLikes ?? 0,
    twitterMinViews: tw.minViews ?? 0,
    twitterLimitPerKeyword: tw.limitPerKeyword ?? 15,
    upworkJobsUrl:
      uw.jobsUrl ?? 'https://www.upwork.com/nx/find-work/most-recent?nav_dir=pop',
    upworkFetchDetails: uw.fetchDetails ?? false,
    upworkMaxAgeHours: uw.maxAgeHours ?? 5,
    aiEnabled: false,
    aiPrompt: '',
    aiModel: 'claude-opus-5',
    aiMinScore: 60,
    aiAutoArchive: true,
    updatedAt: new Date().toISOString(),
  };
}

async function runOne(
  platform: string,
  cfg: CliConfig,
  userId: string,
  limit: number,
  configDir: string,
): Promise<void> {
  const scraper = scrapers.find((s) => s.platform === platform);
  if (!scraper) {
    console.error(`Unknown platform "${platform}".`);
    process.exit(1);
  }

  const domain = platform === 'twitter' ? '.x.com' : `.${platform}.com`;
  const cookies = cookiesFor(
    platform,
    cfg[platform as 'upwork' | 'twitter'],
    domain,
    configDir,
  );
  if (!cookies.length) {
    console.log(`── ${scraper.name} ────────────────────────────────`);
    console.log(`skipped : paste a Cookie header into ${platform}.cookie`);
    return;
  }

  console.log(`── ${scraper.name} ────────────────────────────────`);
  console.log(`cookies : ${cookies.length} (${cookies.map((c) => c.name).join(', ')})`);
  console.log(`limit   : ${limit}`);
  console.log('');

  const headless = cfg.headless ?? true;
  const started = Date.now();
  const leads = await scraper.scrape({
    userId,
    cookies,
    limit,
    log: (m) => console.log('  ', m),
    interactive: !headless,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log(`leads: ${leads.length} in ${secs}s`);
  for (const lead of leads) console.log(JSON.stringify(lead, null, 2));
}

async function main() {
  const configPath = path.resolve(ROOT, 'cli_config.json');
  const cfg = loadConfig(configPath);
  const userId = cfg.userId || 'cli-test';
  const limit = cfg.limit || 10;
  const headless = cfg.headless ?? true;

  process.env.UPWORK_HEADLESS = headless ? 'true' : 'false';
  process.env.X_HEADLESS = headless ? 'true' : 'false';

  seedUserConfig(userId, userConfigFromCli(cfg));

  console.log('config  :', configPath);
  console.log('headless:', headless);
  console.log('');

  const configDir = path.dirname(configPath);
  for (const scraper of scrapers) {
    await runOne(scraper.platform, cfg, userId, limit, configDir);
    console.log('');
  }
}

main().catch((err) => {
  console.error('cli failed:', err);
  process.exit(1);
});
