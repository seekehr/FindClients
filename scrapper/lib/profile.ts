import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { loadRootEnv } from './env';

/**
 * Persistent browser profiles — one real Chromium user-data directory per
 * platform, living in `data/browser/<platform>/`.
 *
 * This is what replaced pasting session cookies. A profile is an actual Chrome
 * profile: you sign in once, in a window, exactly as you would normally, and
 * the cookies, localStorage and device trust that come out of that live on disk
 * and are reused by every later run. Sessions refresh themselves as the browser
 * is used, so there is nothing to re-paste when a cookie expires.
 *
 * It is also the more honest fingerprint. A pasted `auth_token` replayed from a
 * fresh, empty browser context is a session with no history, no localStorage and
 * no prior device — visibly not the browser that logged in. A persistent profile
 * *is* that browser.
 *
 * One rule: **a profile directory can only be open in one process at a time.**
 * Chromium locks it. `openProfile` reports that as a readable error rather than
 * a stack trace, and the server serializes scraping and signing in so it should
 * not come up.
 */

loadRootEnv();

function dataDir(): string {
  const root = path.resolve(__dirname, '..', '..');
  return process.env.DATA_DIR ? path.resolve(root, process.env.DATA_DIR) : path.join(root, 'data');
}

/** Where a platform's browser profile lives. */
export function profileDir(platform: string): string {
  return path.join(dataDir(), 'browser', platform);
}

/** Has this platform ever been signed in to? */
export function hasProfile(platform: string): boolean {
  const dir = profileDir(platform);
  // Chromium writes 'Default/' on first launch; an empty dir is not a profile.
  return fs.existsSync(path.join(dir, 'Default'));
}

/** Delete a saved profile. This is what signing out means. */
export function deleteProfile(platform: string): void {
  fs.rmSync(profileDir(platform), { recursive: true, force: true });
}

export interface OpenOptions {
  headless: boolean;
  /** Only set when the user has overridden it; otherwise Chromium's own. */
  userAgent?: string;
  proxy?: { server: string };
}

/**
 * Open a platform's profile. Creates it on first use.
 *
 * Returns a `BrowserContext`, not a `Browser` — a persistent context *is* the
 * browser, and closing it closes the window.
 */
export async function openProfile(
  platform: string,
  opts: OpenOptions,
  /** Internal: set when this is the automatic retry after a lock collision. */
  isRetry = false,
): Promise<BrowserContext> {
  const dir = profileDir(platform);
  fs.mkdirSync(dir, { recursive: true });

  try {
    return await chromium.launchPersistentContext(dir, {
      headless: opts.headless,
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
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (/ProcessSingleton|SingletonLock|already (running|in use)/i.test(message)) {
      // Usually a genuine collision — but not always. Closing a persistent
      // context returns before Chromium has finished releasing the directory,
      // so reopening a profile straight after closing it (which is exactly what
      // the headed CAPTCHA retry does) can lose a race with its own predecessor.
      // Give it a moment and try once more before blaming the user.
      if (!isRetry) {
        await new Promise((r) => setTimeout(r, 3000));
        return openProfile(platform, opts, true);
      }
      throw new Error(
        `The ${platform} browser profile is already open in another process. ` +
          'Wait for the current scrape or sign-in to finish, then try again.',
      );
    }
    throw err;
  }
}

/** The first page of a freshly opened profile, or a new one if it has none. */
export async function firstPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? (await context.newPage());
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
 * next scrape quietly lands on a login page — the exact failure this pairing
 * exists to prevent. Only `confirm` may end the wait.
 *
 * Watching for the window closing matters too: someone who gives up should not
 * leave the app waiting the full timeout on a browser that no longer exists.
 */
export async function waitForSignIn(
  context: BrowserContext,
  looksSignedIn: () => Promise<boolean>,
  confirm: () => Promise<boolean>,
  timeoutMs: number,
  log: (msg: string) => void,
): Promise<boolean> {
  let closed = false;
  context.once('close', () => {
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
        // Give Chromium a moment to flush cookies to the profile on disk.
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
