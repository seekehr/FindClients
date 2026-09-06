/**
 * Manual smoke test for the Upwork scraper.
 *
 * Runs the real `upworkScraper.scrape()` against Upwork using the saved browser
 * profile, and prints what came back. This is the fastest way to tell a *code*
 * problem (selectors changed, parser broken) apart from a *session* problem
 * (signed out, challenge), which the app can only report as "found 0".
 *
 * Run from the `scrapper/` folder:
 *
 *   node ../server/node_modules/tsx/dist/cli.mjs upwork/__smoke.ts
 *
 * Reads `data/` directly, so the app does not need to be running — but it does
 * need the profile, so sign in first (in the app, or `npm run cli -- --sign-in
 * upwork`). `UPWORK_HEADLESS=false` lets you watch the browser work.
 */

import { loadRootEnv } from '../lib/env';
import { readSavedConfig } from '../lib/local';
import { firstPage, hasProfile, openProfile } from '../lib/profile';
import { loadUpworkConfig, loadUpworkRuntimeConfig } from './config';
import { parseJobTile, upworkScraper } from './index';

loadRootEnv();

/**
 * Look at the feed directly, without the scraper, so a zero-lead run can be
 * explained: is it a challenge page, a signed-out redirect, or a real feed
 * whose tiles we failed to parse?
 */
async function inspectFeed(jobsUrl: string) {
  const runtime = loadUpworkRuntimeConfig();
  const context = await openProfile('upwork', {
    headless: runtime.headless,
    userAgent: runtime.userAgent,
  });
  try {
    const page = await firstPage(context);
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
    await context.close().catch(() => undefined);
  }
}

async function main() {
  if (!hasProfile('upwork')) {
    console.error('Not signed in to Upwork. Run: npm run cli -- --sign-in upwork');
    process.exit(1);
  }

  const saved = readSavedConfig();
  if (!saved) {
    console.error('No data/config.json yet — start the app once to create it.');
    process.exit(1);
  }

  const jobsUrl = saved.upworkJobsUrl || 'https://www.upwork.com/nx/find-work/most-recent';
  const cfg = loadUpworkConfig({ jobsUrl, maxAgeHours: 24, fetchDetails: false });
  console.log('headless  :', cfg.headless);
  console.log('');

  await inspectFeed(jobsUrl);

  console.log('');
  console.log('── full scrape() ───────────────────────────────');
  const started = Date.now();
  const leads = await upworkScraper.scrape({
    config: { ...saved, upworkJobsUrl: jobsUrl },
    limit: 10,
    log: (m) => console.log('   ', m),
    interactive: true,
    captchaTimeoutMs: 5 * 60 * 1000,
  });
  console.log(`leads: ${leads.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const lead of leads.slice(0, 3)) console.log(JSON.stringify(lead, null, 2));
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
