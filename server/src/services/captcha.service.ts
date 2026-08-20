import type { CaptchaPage } from '../scrapers/types';

interface CaptchaSession {
  page: CaptchaPage;
  screenshot: Buffer;
  resolve: (solved: boolean) => void;
  createdAt: number;
  platform: string;
  userId: string;
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

export async function registerCaptcha(
  page: CaptchaPage,
  platform: string,
  userId: string,
): Promise<boolean> {
  const sessionId = String(nextId++);
  const screenshot = await page.screenshot({ type: 'png' });
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };

  return new Promise<boolean>((resolve) => {
    sessions.set(sessionId, {
      page,
      screenshot,
      resolve,
      createdAt: Date.now(),
      platform,
      userId,
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
    await new Promise((r) => setTimeout(r, 1500));
    s.screenshot = await s.page.screenshot({ type: 'png' });

    const url = s.page.url().toLowerCase();
    let title = '';
    try { title = (await s.page.title()).toLowerCase(); } catch { /* closed */ }
    const stillChallenge = ['captcha', 'challenge', 'verify', 'robot', 'blocked'].some(
      (kw) => url.includes(kw) || title.includes(kw),
    );

    if (!stillChallenge) {
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
