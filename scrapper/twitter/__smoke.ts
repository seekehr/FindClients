/**
 * Manual smoke test for the X / Twitter scraper.
 *
 * Tells a *session* problem (auth_token expired, account locked) apart from a
 * *code* problem (X changed its markup), which a server run can only report as
 * "found 0".
 *
 * Run from the `scrapper/` folder:
 *
 *   node ../server/node_modules/tsx/dist/cli.mjs twitter/__smoke.ts
 *
 *   # Against a cookie header you paste yourself
 *   X_COOKIE="auth_token=…; ct0=…" \
 *     node ../server/node_modules/tsx/dist/cli.mjs twitter/__smoke.ts --keyword "looking to hire"
 *
 * Uses the saved browser profile, so sign in first (in the app, or
 * `npm run cli -- --sign-in twitter`). `X_HEADLESS=false` shows the browser.
 */

import { loadRootEnv } from '../lib/env';
import { hasProfile, openProfile } from '../lib/profile';
import { loadTwitterRuntimeConfig } from './config';
import { extractTweetFromArticle } from './index';

loadRootEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const keyword = arg('keyword') ?? 'looking for a developer';

  if (!hasProfile('twitter')) {
    console.error('Not signed in to X. Run: npm run cli -- --sign-in twitter');
    process.exit(1);
  }

  const runtime = loadTwitterRuntimeConfig();
  console.log('headless  :', runtime.headless);
  console.log('');

  const session = await openProfile('twitter', {
    headless: runtime.headless,
    userAgent: runtime.userAgent,
  });
  try {
    // 1. Is the session actually logged in? The home timeline redirects
    //    anonymous visitors to the marketing / login page.
    const home = await session.page();
    await home.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await home.waitForTimeout(5000);
    console.log('── session check ───────────────────────────────');
    console.log('landed on :', home.url());
    console.log('title     :', await home.title());
    console.log(
      'logged in :',
      (await home.locator('[data-testid="SideNav_AccountSwitcher_Button"]').count()) > 0
        ? 'yes'
        : 'NO — X is treating this session as logged out',
    );
    await home.close();

    // 2. The search the scraper actually uses.
    const page = await session.page();
    const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(6000);

    console.log('');
    console.log('── search ──────────────────────────────────────');
    console.log('keyword   :', keyword);
    console.log('landed on :', page.url());
    const counts: Record<string, number> = {};
    for (const sel of [
      'article[data-testid="tweet"]',
      'div[data-testid="tweetText"]',
      '[data-testid="emptyState"]',
      'div[data-testid="error-detail"]',
    ]) {
      counts[sel] = await page.locator(sel).count();
    }
    console.log('selectors :', counts);
    console.log(
      'body head :',
      (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 300),
    );

    const articles = await page.$$('article[data-testid="tweet"]');
    if (articles.length) {
      console.log('');
      console.log('── first tweet, parsed ─────────────────────────');
      console.log(JSON.stringify(await extractTweetFromArticle(articles[0]), null, 2));
    }
  } finally {
    await session.release();
  }
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
