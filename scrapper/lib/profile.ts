import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { loadRootEnv } from './env';

/**
 * Where a scraper's browser comes from.
 *
 * Two modes, in order of preference:
 *
 * 1. **Attach to your own Chrome** (`CHROME_CDP_URL`). You start real Google
 *    Chrome yourself with `--remote-debugging-port=9222` and a `--user-data-dir`,
 *    sign in once, and every scrape attaches to it over CDP. This is the mode
 *    that gets past Cloudflare, because there is nothing to get past: it is a
 *    genuine Chrome you launched, with your profile, your history and no
 *    automation flags. Playwright never launched it, so none of Playwright's
 *    launch-time instrumentation is on it either. `npm run chrome` starts it.
 *
 * 2. **A persistent profile we launch** (the default). `launchPersistentContext`
 *    against `data/browser/<platform>/`, using the real Chrome binary via
 *    `channel: 'chrome'` where it is installed rather than Playwright's bundled
 *    Chromium — the bundled build is a well-known bot signal on its own.
 *
 * Both persist the session across runs. Mode 1 persists it in *your* Chrome
 * profile, which is why signing in there feels like signing in anywhere else.
 */

loadRootEnv();

/** Attach to an already-running Chrome instead of launching one. */
export const cdpUrl = (): string => process.env.CHROME_CDP_URL?.trim() ?? '';

/**
 * Which browser binary to launch when we are launching one. 'chrome' uses the
 * installed Google Chrome; set CHROME_CHANNEL= (empty) to force Playwright's
 * bundled Chromium.
 */
const channel = (): string | undefined => {
  const value = process.env.CHROME_CHANNEL;
  if (value === undefined) return 'chrome';
  return value.trim() || undefined;
};

function dataDir(): string {
  const root = path.resolve(__dirname, '..', '..');
  return process.env.DATA_DIR ? path.resolve(root, process.env.DATA_DIR) : path.join(root, 'data');
}

/** Where a platform's own profile lives, when we are managing one. */
export function profileDir(platform: string): string {
  return path.join(dataDir(), 'browser', platform);
}

/**
 * Is there a session to scrape with?
 *
 * In CDP mode the profile belongs to the Chrome you started, so we cannot
 * inspect it from here and assume yes — `checkSession` is what actually
 * verifies it.
 */
export function hasProfile(platform: string): boolean {
  if (cdpUrl()) return true;
  return fs.existsSync(path.join(profileDir(platform), 'Default'));
}

/** Delete a saved profile. Refuses in CDP mode: that profile is not ours. */
export function deleteProfile(platform: string): void {
  if (cdpUrl()) {
    throw new Error(
      'This session lives in the Chrome you started yourself, so FindClients ' +
        'will not delete it. Sign out in that Chrome window instead.',
    );
  }
  fs.rmSync(profileDir(platform), { recursive: true, force: true });
}

export interface OpenOptions {
  headless: boolean;
  /** Only set when the user has overridden it; otherwise the browser's own. */
  userAgent?: string;
  proxy?: { server: string };
}

/**
 * A browser to work in, and how to let go of it.
 *
 * `release` matters more than it looks: in CDP mode the browser belongs to the
 * user, and closing it would shut down the Chrome they are using. So we close
 * only the pages we opened and drop the connection.
 */
export interface BrowserSession {
  context: BrowserContext;
  /** A page to work in. */
  page(): Promise<Page>;
  release(): Promise<void>;
  /** True when we attached to someone else's Chrome. */
  attached: boolean;
}

async function attachOverCdp(url: string): Promise<BrowserSession> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(url);
  } catch (err) {
    throw new Error(
      `Could not reach Chrome at ${url}: ${(err as Error).message}\n` +
        'Start it first with `npm run chrome` (and leave that window open).',
    );
  }

  // Attaching gives us the browser's existing default context — the one holding
  // the profile that is signed in. Making a new context would get a blank one.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const opened: Page[] = [];

  return {
    context,
    attached: true,
    async page() {
      // Always a fresh tab. Reusing pages[0] would hijack whatever the user has
      // open in the browser they lent us.
      const page = await context.newPage();
      opened.push(page);
      return page;
    },
    async release() {
      for (const page of opened) await page.close().catch(() => undefined);
      // Disconnects the CDP session; it does not close the user's Chrome.
      await browser.close().catch(() => undefined);
    },
  };
}

async function launchOwnProfile(
  platform: string,
  opts: OpenOptions,
  isRetry = false,
): Promise<BrowserSession> {
  const dir = profileDir(platform);
  fs.mkdirSync(dir, { recursive: true });

  const launch = (useChannel: string | undefined) =>
    chromium.launchPersistentContext(dir, {
      headless: opts.headless,
      channel: useChannel,
      viewport: { width: 1280, height: 900 },
      userAgent: opts.userAgent,
      proxy: opts.proxy,
      args: [
        // Chromium's automation banner and the password/leak-detection popups
        // get in the way of a window someone is meant to sign in through.
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check',
        '--no-first-run',
        '--disable-features=PasswordLeakDetection,AutofillServerCommunication',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

  let context: BrowserContext;
  try {
    try {
      context = await launch(channel());
    } catch (err) {
      // Chrome is not installed on this machine — fall back to the bundled
      // Chromium rather than refusing to run at all.
      if (channel() && /executable doesn't exist|channel/i.test((err as Error).message ?? '')) {
        context = await launch(undefined);
      } else {
        throw err;
      }
    }
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (/ProcessSingleton|SingletonLock|already (running|in use)/i.test(message)) {
      // Usually a genuine collision — but not always. Closing a persistent
      // context returns before Chromium has finished releasing the directory,
      // so reopening straight after closing it (which is exactly what the
      // headed CAPTCHA retry does) can lose a race with its own predecessor.
      if (!isRetry) {
        await new Promise((r) => setTimeout(r, 3000));
        return launchOwnProfile(platform, opts, true);
      }
      throw new Error(
        `The ${platform} browser profile is already open in another process. ` +
          'Wait for the current scrape or sign-in to finish, then try again.',
      );
    }
    throw err;
  }

  return {
    context,
    attached: false,
    async page() {
      return context.pages()[0] ?? (await context.newPage());
    },
    async release() {
      await context.close().catch(() => undefined);
    },
  };
}

/** Open a browser for this platform, however this machine is configured. */
export async function openProfile(
  platform: string,
  opts: OpenOptions,
): Promise<BrowserSession> {
  const url = cdpUrl();
  return url ? attachOverCdp(url) : launchOwnProfile(platform, opts);
}

/** Don't re-run the expensive confirmation more than this often. */
const CONFIRM_COOLDOWN_MS = 15_000;

/**
 * Wait for a person to finish signing in.
 *
 * Two checks, deliberately. `looksSignedIn` is a cheap glance at the URL, run
 * every couple of seconds; `confirm` is the expensive one that actually loads
 * the page we care about and reports whether it stayed there.
 *
 * The cheap check alone is not enough, and getting that wrong is expensive:
 * login flows pass through redirects that look like the signed-in app for a
 * moment, so a URL match can fire before the person has typed their password.
 * That saves a profile that is not really signed in, reports success, and the
 * next scrape quietly lands on a login page. Only `confirm` may end the wait.
 */
export async function waitForSignIn(
  session: BrowserSession,
  looksSignedIn: () => Promise<boolean>,
  confirm: () => Promise<boolean>,
  timeoutMs: number,
  log: (msg: string) => void,
): Promise<boolean> {
  let closed = false;
  session.context.once('close', () => {
    closed = true;
  });

  const deadline = Date.now() + timeoutMs;
  const minutes = Math.round(timeoutMs / 60_000);
  log(`sign in using the browser window that just opened — waiting up to ${minutes} minute(s)`);

  let lastConfirm = 0;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    if (closed) {
      log('the browser window was closed before sign-in completed');
      return false;
    }

    try {
      if (!(await looksSignedIn())) continue;
      if (Date.now() - lastConfirm < CONFIRM_COOLDOWN_MS) continue;
      lastConfirm = Date.now();

      if (await confirm()) {
        log('signed in — the session is saved and will be reused from now on');
        // Give the browser a moment to flush cookies to the profile on disk.
        await new Promise((r) => setTimeout(r, 2000));
        return true;
      }
      log('not signed in yet — still waiting');
    } catch {
      // Mid-navigation the page can be briefly unusable. Keep waiting.
    }
  }

  log('timed out waiting for sign-in');
  return false;
}
