/**
 * Manual smoke test for the X / Twitter scraper.
 *
 * Tells a *session* problem (auth_token expired, account locked) apart from a
 * *code* problem (X changed its markup), which a server run can only report as
 * "found 0".
 *
 * Run from the `scrapper/` folder:
 *
 *   # Against the session you connected in the app
 *   node ../server/node_modules/tsx/dist/cli.mjs twitter/__smoke.ts --saved
 *
 *   # Against a cookie header you paste yourself
 *   X_COOKIE="auth_token=…; ct0=…" \
 *     node ../server/node_modules/tsx/dist/cli.mjs twitter/__smoke.ts --keyword "looking to hire"
 *
 * `--saved` reads data/ directly, so the app need not be running.
 * `X_HEADLESS=false` shows the browser.
 */

import { chromium } from 'playwright';
import { loadRootEnv } from '../lib/env';
import { readSavedCookies } from '../lib/local';
import { loadTwitterRuntimeConfig } from './config';
import { extractTweetFromArticle } from './index';
import type { SessionCookie } from '../../server/src/scrapers/types';

loadRootEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseCookieHeader(header: string): SessionCookie[] {
  return header
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const eq = p.indexOf('=');
      return {
        name: p.slice(0, eq).trim(),
        value: p.slice(eq + 1).trim(),
        domain: '.x.com',
        path: '/',
      };
    })
    .filter((c) => c.name && c.value);
}

async function main() {
  const useSaved = process.argv.includes('--saved');
  const keyword = arg('keyword') ?? 'looking for a developer';

  let cookies: SessionCookie[] = [];
  let source = 'no session (anonymous)';

  if (process.env.X_COOKIE) {
    cookies = parseCookieHeader(process.env.X_COOKIE);
    source = `X_COOKIE env (${cookies.length} cookie(s))`;
  }
  if (useSaved) {
    cookies = readSavedCookies('twitter');
    if (!cookies.length) {
      console.error('No X session saved. Connect X on the Connections page first.');
      process.exit(1);
    }
    source = `saved session (${cookies.length} cookie(s))`;
  }

  const runtime = loadTwitterRuntimeConfig();
  console.log('session   :', source);
  console.log('auth_token:', cookies.some((c) => c.name === 'auth_token') ? 'present' : 'MISSING');
  console.log('ct0       :', cookies.some((c) => c.name === 'ct0') ? 'present' : 'missing');
  console.log('headless  :', runtime.headless);
  console.log('');

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
          domain: c.domain || '.x.com',
          path: c.path || '/',
          secure: true,
          sameSite: 'None' as const,
        })),
      );
    }

    // 1. Is the session actually logged in? The home timeline redirects
    //    anonymous visitors to the marketing / login page.
    const home = await context.newPage();
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
    const page = await context.newPage();
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
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
