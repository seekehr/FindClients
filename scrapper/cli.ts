/**
 * Standalone scraper CLI. Does not need the API server.
 *
 * From this folder:
 *   npm run cli -- upwork
 *   npm run cli -- twitter
 *   npm run cli -- all
 *
 * Cookies and search settings come from cli_config.json (copy from
 * cli_config.example.json). Paste a browser Cookie header into `cookie`.
 *
 *   --config <path>   other json file (default: ./cli_config.json)
 *   --limit <n>       cap leads this run
 *   --headed          show the browser (overrides config.headless)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRootEnv } from './lib/env';
import { seedUserConfig } from './lib/api';
import { scrapers } from './index';
import type { SessionCookie, UserConfig } from '../server/src/scrapers/types';

loadRootEnv();

const ROOT = __dirname;
const PLATFORMS = scrapers.map((s) => s.platform);

interface PlatformCliConfig {
  /** Raw `Cookie:` header pasted from DevTools. */
  cookie?: string;
  /** Or a list of cookies (takes priority over `cookie` if non-empty). */
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

function usage(code = 1): never {
  console.error(
    `Usage: npm run cli -- <${PLATFORMS.join('|')}|all> [--config path] [--limit n] [--headed]`,
  );
  process.exit(code);
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { positional, flags };
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

function cookiesFor(platform: PlatformCliConfig | undefined, domain: string): SessionCookie[] {
  if (!platform) return [];
  if (platform.cookies?.length) {
    return platform.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || domain,
      path: c.path || '/',
    }));
  }
  if (platform.cookie?.trim()) return parseCookieHeader(platform.cookie, domain);
  return [];
}

function loadConfig(filePath: string): CliConfig {
  if (!fs.existsSync(filePath)) {
    console.error(
      `Missing ${filePath}\nCopy cli_config.example.json to cli_config.json and paste your cookies.`,
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
): Promise<void> {
  const scraper = scrapers.find((s) => s.platform === platform);
  if (!scraper) {
    console.error(`Unknown platform "${platform}". Known: ${PLATFORMS.join(', ')}`);
    process.exit(1);
  }

  const domain = platform === 'twitter' ? '.x.com' : `.${platform}.com`;
  const cookies = cookiesFor(cfg[platform as 'upwork' | 'twitter'], domain);
  if (!cookies.length) {
    console.error(
      `No cookies for ${platform}. Paste a Cookie header into cli_config.json → ${platform}.cookie`,
    );
    process.exit(1);
  }

  console.log(`── ${scraper.name} ────────────────────────────────`);
  console.log(`cookies : ${cookies.length} (${cookies.map((c) => c.name).join(', ')})`);
  console.log(`limit   : ${limit}`);
  console.log('');

  const started = Date.now();
  const leads = await scraper.scrape({
    userId,
    cookies,
    limit,
    log: (m) => console.log('  ', m),
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log(`leads: ${leads.length} in ${secs}s`);
  for (const lead of leads) console.log(JSON.stringify(lead, null, 2));
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const target = positional[0];
  if (!target || target === 'help' || flags.has('help') || flags.has('h')) {
    usage(target === 'help' || flags.has('help') || flags.has('h') ? 0 : 1);
  }

  const configRel = typeof flags.get('config') === 'string' ? (flags.get('config') as string) : 'cli_config.json';
  const configPath = path.resolve(ROOT, configRel);
  const cfg = loadConfig(configPath);
  const userId = cfg.userId || 'cli-test';
  const limitFlag = flags.get('limit');
  const limit =
    (typeof limitFlag === 'string' ? Number.parseInt(limitFlag, 10) : NaN) ||
    cfg.limit ||
    10;
  const headless = flags.has('headed') ? false : (cfg.headless ?? true);

  process.env.UPWORK_HEADLESS = headless ? 'true' : 'false';
  process.env.X_HEADLESS = headless ? 'true' : 'false';

  seedUserConfig(userId, userConfigFromCli(cfg));

  console.log('config  :', configPath);
  console.log('headless:', headless);
  console.log('');

  const wanted = target === 'all' ? PLATFORMS : [target];
  for (const platform of wanted) {
    await runOne(platform, cfg, userId, limit);
    console.log('');
  }
}

main().catch((err) => {
  console.error('cli failed:', err);
  process.exit(1);
});
