/**
 * Standalone scraper CLI. Does not need the API server.
 *
 * From this folder:
 *   npm run cli
 *
 * Settings come from cli_config.json. Sessions come from the same persistent
 * browser profiles the app uses (data/browser/<platform>/), so sign in once in
 * the app — or with `npm run cli -- --sign-in <platform>` — and the CLI is
 * signed in too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRootEnv } from './lib/env';
import { scrapers } from './index';
import { hasProfile } from './lib/profile';
import type { AppConfig } from '../server/src/scrapers/types';

loadRootEnv();

const ROOT = __dirname;

interface PlatformCliConfig {
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
  upwork?: PlatformCliConfig;
  twitter?: PlatformCliConfig;
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

/**
 * Build the config the scrapers expect out of cli_config.json, so the CLI
 * drives exactly the same code path the app does without reading the app's
 * data/config.json.
 */
function configFromCli(file: CliConfig): AppConfig {
  const tw = file.twitter ?? {};
  const uw = file.upwork ?? {};
  return {
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
    upworkWatchEnabled: false,
    upworkJobsUrl:
      uw.jobsUrl ?? 'https://www.upwork.com/nx/find-work/most-recent?nav_dir=pop',
    upworkFetchDetails: uw.fetchDetails ?? false,
    upworkMaxAgeHours: uw.maxAgeHours ?? 5,
    upworkReloadMinMinutes: 5,
    upworkReloadMaxMinutes: 10,
    upworkAlertDelayMinSeconds: 120,
    upworkAlertDelayMaxSeconds: 180,
    // The CLI never qualifies: it prints what the scrapers found. Reviewing
    // would need your Gemini key, which lives in data/config.json.
    aiEnabled: false,
    aiPrompt: '',
    aiModel: 'gemini-2.5-flash',
    aiMinScore: 60,
    aiAutoArchive: true,
    aiApiKeySet: false,
    aiApiKeyHint: '',
    updatedAt: new Date().toISOString(),
  };
}

async function runOne(platform: string, config: AppConfig, limit: number): Promise<void> {
  const scraper = scrapers.find((s) => s.platform === platform);
  if (!scraper) {
    console.error(`Unknown platform "${platform}".`);
    process.exit(1);
  }

  console.log(`── ${scraper.name} ────────────────────────────────`);

  // Watched platforms have no scrape() to call, on purpose. Upwork is watched
  // because bulk collection is what gets Upwork accounts banned, and a CLI
  // escape hatch would put that back exactly where it was removed from.
  if (scraper.mode === 'watch' || !scraper.scrape) {
    console.log('skipped : this platform is watched, not scraped.');
    console.log('          Run the app and open the Opportunities page for job alerts.');
    return;
  }

  if (!hasProfile(platform)) {
    console.log(`skipped : not signed in. Run: npm run cli -- --sign-in ${platform}`);
    return;
  }

  console.log(`limit   : ${limit}`);
  console.log('');

  const started = Date.now();
  const leads = await scraper.scrape!({
    config,
    limit,
    log: (m) => console.log('  ', m),
    // Always allowed to open a window here: you ran this from a terminal, so
    // you are by definition sitting in front of it.
    interactive: true,
    captchaTimeoutMs: 5 * 60 * 1000,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  console.log(`leads: ${leads.length} in ${secs}s`);
  for (const lead of leads) console.log(JSON.stringify(lead, null, 2));
}

/** `--sign-in <platform>`: open a window, sign in, save the profile, exit. */
async function signIn(platform: string): Promise<void> {
  const scraper = scrapers.find((s) => s.platform === platform);
  if (!scraper) {
    console.error(`Unknown platform "${platform}".`);
    process.exit(1);
  }
  const ok = await scraper.signIn({
    timeoutMs: 10 * 60 * 1000,
    log: (m) => console.log('  ', m),
  });
  process.exit(ok ? 0 : 1);
}

async function main() {
  const signInAt = process.argv.indexOf('--sign-in');
  if (signInAt >= 0) return signIn(process.argv[signInAt + 1] ?? '');

  const configPath = path.resolve(ROOT, 'cli_config.json');
  const cfg = loadConfig(configPath);
  const limit = cfg.limit || 10;
  const headless = cfg.headless ?? true;

  process.env.UPWORK_HEADLESS = headless ? 'true' : 'false';
  process.env.X_HEADLESS = headless ? 'true' : 'false';

  const config = configFromCli(cfg);

  console.log('config  :', configPath);
  console.log('headless:', headless);
  console.log('');

  for (const scraper of scrapers) {
    await runOne(scraper.platform, config, limit);
    console.log('');
  }
}

main().catch((err) => {
  console.error('cli failed:', err);
  process.exit(1);
});
