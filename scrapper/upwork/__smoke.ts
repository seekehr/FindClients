/**
 * Manual smoke test for the Upwork scraper.
 *
 * Runs the real `upworkScraper.scrape()` against Upwork with whatever session
 * you give it, and prints what came back. This is the fastest way to tell a
 * *code* problem (selectors changed, parser broken) apart from a *session*
 * problem (cookies expired, CAPTCHA), which the server can only report as
 * "found 0".
 *
 * Run from the `scrapper/` folder:
 *
 *   # 1. Against the session already stored for a user in the app
 *   node ../server/node_modules/tsx/dist/cli.mjs upwork/__smoke.ts --saved
 *
 *   # 2. Against a cookie header you paste yourself
 *   UPWORK_COOKIE="master_access_token=…; oauth2_global_js_token=…" \
 *     node ../server/node_modules/tsx/dist/cli.mjs upwork/__smoke.ts
 *
 *   # 3. No session at all — checks the feed is reachable and what it serves
 *   node ../server/node_modules/tsx/dist/cli.mjs upwork/__smoke.ts
 *
 * `--saved` uses the session and settings you connected in the app (read
 * straight from data/, so the app does not need to be running).
 * `UPWORK_HEADLESS=false` lets you watch the browser work.
 */

import { chromium } from 'playwright';
import { loadRootEnv } from '../lib/env';
import { readSavedConfig, readSavedCookies } from '../lib/local';
import { loadUpworkConfig, loadUpworkRuntimeConfig } from './config';
import { parseJobTile, upworkScraper } from './index';
import type { SessionCookie } from '../../server/src/scrapers/types';

loadRootEnv();

const useSaved = process.argv.includes('--saved');

/** Parse a raw `Cookie:` header into the cookie shape Playwright wants. */
function parseCookieHeader(header: string): SessionCookie[] {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      return {
        name: part.slice(0, eq).trim(),
        value: part.slice(eq + 1).trim(),
        domain: '.upwork.com',
        path: '/',
      };
    })
    .filter((c) => c.name && c.value);
}

/**
 * Look at the feed directly, without the scraper, so a zero-lead run can be
 * explained: is it a challenge page, a logged-out redirect, or a real feed
 * whose tiles we failed to parse?
 */
async function inspectFeed(jobsUrl: string, cookies: SessionCookie[]) {
  const runtime = loadUpworkRuntimeConfig();
  const browser = await chromium.launch({ headless: runtime.headless });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: runtime.userAgent,
    });
    if (cookies.length) {
      await context.addCookies(
        cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.upwork.com',
          path: c.path || '/',
          secure: true,
          sameSite: 'Lax' as const,
        })),
      );
    }

    const page = await context.newPage();
    const response = await page.goto(jobsUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(5000);

    const selectors = [
      'section.air3-card-section',
      '[data-test="job-tile"]',
      '.job-tile-title',
      'article',
      "[data-test='load-more-button']",
    ];
    const counts: Record<string, number> = {};
    for (const sel of selectors) counts[sel] = await page.locator(sel).count();

    const body = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);

    console.log('── feed inspection ─────────────────────────────');
    console.log('requested :', jobsUrl);
    console.log('landed on :', page.url());
    console.log('http      :', response?.status(), response?.statusText());
    console.log('title     :', await page.title());
    console.log('selectors :', counts);
    console.log('body head :', body);

    const tiles = await page.$$('section.air3-card-section');
    if (tiles.length) {
      console.log('── first tile, parsed ──────────────────────────');
      console.log(JSON.stringify(await parseJobTile(tiles[0]), null, 2));
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function main() {
  let cookies: SessionCookie[] = [];
  let jobsUrl = 'https://www.upwork.com/nx/find-work/most-recent?nav_dir=pop';
  let source = 'no session (anonymous)';

  if (process.env.UPWORK_COOKIE) {
    cookies = parseCookieHeader(process.env.UPWORK_COOKIE);
    source = `UPWORK_COOKIE env (${cookies.length} cookie(s))`;
  }

  const saved = readSavedConfig();

  if (useSaved) {
    cookies = readSavedCookies('upwork');
    if (!cookies.length) {
      console.error('No Upwork session saved. Connect Upwork on the Connections page first.');
      process.exit(1);
    }
    jobsUrl = saved?.upworkJobsUrl || jobsUrl;
    source = `saved session (${cookies.length} cookie(s))`;
  }

  const cfg = loadUpworkConfig({ jobsUrl, maxAgeHours: 24, fetchDetails: false });
  console.log('session   :', source);
  console.log('headless  :', cfg.headless);
  console.log('');

  await inspectFeed(jobsUrl, cookies);

  console.log('');
  console.log('── full scrape() ───────────────────────────────');
  if (!saved) {
    console.log('skipped: no data/config.json yet — start the app once to create it.');
    return;
  }
  const started = Date.now();
  const leads = await upworkScraper.scrape({
    config: { ...saved, upworkJobsUrl: jobsUrl },
    cookies,
    limit: 10,
    log: (m) => console.log('   ', m),
  });
  console.log(`leads: ${leads.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const lead of leads.slice(0, 3)) console.log(JSON.stringify(lead, null, 2));
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
