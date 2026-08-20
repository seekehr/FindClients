export interface CaptchaPage {
  screenshot(opts?: { type?: string }): Promise<Buffer>;
  mouse: { click(x: number, y: number): Promise<void> };
  url(): string;
  title(): Promise<string>;
  viewportSize(): { width: number; height: number } | null;
  waitForLoadState?(state: 'networkidle' | 'load', opts?: { timeout?: number }): Promise<void>;
}

interface CaptchaSession {
  page: CaptchaPage;
  screenshot: Buffer;
  resolve: (solved: boolean) => void;
  createdAt: number;
  platform: string;
  userId: string;
  isSolved?: (page: CaptchaPage) => Promise<boolean>;
}

const sessions = new Map<string, CaptchaSession>();
let nextId = 1;

const TIMEOUT_MS = 5 * 60 * 1000;

export interface CaptchaChallenge {
  sessionId: string;
  platform: string;
  screenshot: string;
  width: number;
  height: number;
  createdAt: number;
}

const CHALLENGE_KEYWORDS = ['captcha', 'challenge', 'verify', 'robot', 'blocked'];

async function waitForImagesLoaded(page: CaptchaPage): Promise<void> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  if (page.waitForLoadState) {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }
  await sleep(2500);
}

async function defaultIsSolved(page: CaptchaPage): Promise<boolean> {
  try {
    const url = page.url().toLowerCase();
    const title = (await page.title()).toLowerCase();
    return !CHALLENGE_KEYWORDS.some((kw) => url.includes(kw) || title.includes(kw));
  } catch {
    return false;
  }
}

export interface RegisterOptions {
  platform: string;
  userId: string;
  isSolved?: (page: CaptchaPage) => Promise<boolean>;
}

export async function registerCaptcha(
  page: CaptchaPage,
  opts: RegisterOptions,
): Promise<boolean> {
  const sessionId = String(nextId++);
  const screenshot = await page.screenshot({ type: 'png' });

  return new Promise<boolean>((resolve) => {
    sessions.set(sessionId, {
      page,
      screenshot,
      resolve,
      createdAt: Date.now(),
      platform: opts.platform,
      userId: opts.userId,
      isSolved: opts.isSolved,
    });

    const timer = setTimeout(() => {
      if (sessions.has(sessionId)) {
        sessions.delete(sessionId);
        resolve(false);
      }
    }, TIMEOUT_MS);

    const originalResolve = resolve;
    sessions.get(sessionId)!.resolve = (solved: boolean) => {
      clearTimeout(timer);
      sessions.delete(sessionId);
      originalResolve(solved);
    };
  });
}

export function getActiveCaptcha(userId: string): CaptchaChallenge | null {
  for (const [sessionId, s] of sessions) {
    if (s.userId === userId) {
      const viewport = s.page.viewportSize() ?? { width: 1280, height: 900 };
      return {
        sessionId,
        platform: s.platform,
        screenshot: s.screenshot.toString('base64'),
        width: viewport.width,
        height: viewport.height,
        createdAt: s.createdAt,
      };
    }
  }
  return null;
}

export async function clickCaptcha(
  sessionId: string,
  x: number,
  y: number,
): Promise<{ screenshot: string; solved: boolean } | null> {
  const s = sessions.get(sessionId);
  if (!s) return null;

  try {
    await s.page.mouse.click(x, y);
    await waitForImagesLoaded(s.page);
    s.screenshot = await s.page.screenshot({ type: 'png' });

    const check = s.isSolved ?? defaultIsSolved;
    if (await check(s.page)) {
      s.resolve(true);
      return { screenshot: s.screenshot.toString('base64'), solved: true };
    }

    return { screenshot: s.screenshot.toString('base64'), solved: false };
  } catch {
    s.resolve(false);
    return null;
  }
}

export function dismissCaptcha(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  s.resolve(false);
  return true;
}

export async function refreshScreenshot(sessionId: string): Promise<string | null> {
  const s = sessions.get(sessionId);
  if (!s) return null;
  try {
    s.screenshot = await s.page.screenshot({ type: 'png' });
    return s.screenshot.toString('base64');
  } catch {
    return null;
  }
}
