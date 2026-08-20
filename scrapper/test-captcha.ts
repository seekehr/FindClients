/**
 * Headless CAPTCHA test.
 *
 * Launches a headless browser, navigates to a reCAPTCHA v2 demo page, and
 * spins up a tiny local server so you can solve the CAPTCHA from your real
 * browser by clicking on a screenshot.
 *
 * Usage:
 *   cd scrapper && npx tsx test-captcha.ts
 *   → open http://localhost:3333 in your browser and click to solve
 */
import http from 'node:http';
import { chromium } from 'playwright';
import {
  registerCaptcha,
  getActiveCaptcha,
  clickCaptcha,
  dismissCaptcha,
  refreshScreenshot,
} from './lib/captcha';

const PORT = Number(process.env.TEST_CAPTCHA_PORT) || 3333;
const DEMO_URL = 'https://2captcha.com/demo/recaptcha-v2';
const USER_ID = 'test-captcha';

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>CAPTCHA Solver</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #111; color: #eee; display: flex; flex-direction: column; align-items: center; padding: 24px; min-height: 100vh; }
  h1 { margin-bottom: 8px; }
  .status { margin-bottom: 16px; color: #999; font-size: 14px; }
  .status.solved { color: #4ade80; font-weight: 600; }
  .status.waiting { color: #facc15; }
  .status.none { color: #f87171; }
  .img-wrap { position: relative; display: inline-block; }
  img { max-width: 95vw; border: 2px solid #333; border-radius: 8px; cursor: crosshair; }
  img.clicking { cursor: wait; }
  .loading-overlay { display: none; position: absolute; inset: 0; background: rgba(0,0,0,0.55); border-radius: 8px; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: #fff; }
  .loading-overlay.active { display: flex; }
  .spinner { width: 32px; height: 32px; border: 3px solid #555; border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .actions { margin-top: 12px; display: flex; gap: 8px; }
  button { padding: 8px 20px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; cursor: pointer; font-size: 14px; }
  button:hover { background: #333; }
  .dismiss { border-color: #7f1d1d; color: #fca5a5; }
</style>
</head>
<body>
  <h1>CAPTCHA Solver</h1>
  <div class="status waiting" id="status">Waiting for CAPTCHA…</div>
  <div class="img-wrap">
    <img id="screenshot" alt="CAPTCHA" style="display:none" />
    <div class="loading-overlay" id="overlay">
      <div class="spinner"></div>
      <span style="font-size:14px">Waiting for page to update…</span>
    </div>
  </div>
  <div class="actions">
    <button onclick="refresh()">Refresh screenshot</button>
    <button class="dismiss" onclick="dismiss()">Skip</button>
  </div>
<script>
let sessionId = null;
let width = 1280;
let height = 900;
let clicking = false;

const img = document.getElementById('screenshot');
const status = document.getElementById('status');
const overlay = document.getElementById('overlay');

async function poll() {
  try {
    const res = await fetch('/api/captcha');
    const data = await res.json();
    if (data.challenge) {
      sessionId = data.challenge.sessionId;
      width = data.challenge.width;
      height = data.challenge.height;
      img.src = 'data:image/png;base64,' + data.challenge.screenshot;
      img.style.display = 'block';
      status.textContent = 'Click on the image to solve the CAPTCHA';
      status.className = 'status waiting';
    } else {
      img.style.display = 'none';
      sessionId = null;
      status.textContent = 'No active CAPTCHA — waiting…';
      status.className = 'status none';
    }
  } catch {}
  setTimeout(poll, 2000);
}

img.addEventListener('click', async (e) => {
  if (!sessionId || clicking) return;
  clicking = true;
  img.classList.add('clicking');
  overlay.classList.add('active');
  status.textContent = 'Clicking…';

  const rect = img.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) * (width / rect.width));
  const y = Math.round((e.clientY - rect.top) * (height / rect.height));

  try {
    const res = await fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, x, y }),
    });
    const data = await res.json();
    if (data.screenshot) {
      img.src = 'data:image/png;base64,' + data.screenshot;
    }
    if (data.solved) {
      status.textContent = 'Solved!';
      status.className = 'status solved';
    } else {
      status.textContent = 'Click again if needed…';
      status.className = 'status waiting';
    }
  } catch {
    status.textContent = 'Error — try again';
  } finally {
    clicking = false;
    img.classList.remove('clicking');
    overlay.classList.remove('active');
  }
});

async function refresh() {
  if (!sessionId) return;
  try {
    const res = await fetch('/api/screenshot?sessionId=' + sessionId);
    const data = await res.json();
    if (data.screenshot) img.src = 'data:image/png;base64,' + data.screenshot;
  } catch {}
}

async function dismiss() {
  if (!sessionId) return;
  await fetch('/api/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  sessionId = null;
  status.textContent = 'Dismissed';
  status.className = 'status none';
}

poll();
</script>
</body>
</html>`;

function jsonRes(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => resolve(data));
  });
}

async function main() {
  console.log('Launching headless browser…');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log(`Navigating to ${DEMO_URL}`);
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3000);

  console.log('Page loaded. Starting solver server…');

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
      return;
    }

    if (url.pathname === '/api/captcha' && req.method === 'GET') {
      jsonRes(res, 200, { challenge: getActiveCaptcha(USER_ID) });
      return;
    }

    if (url.pathname === '/api/click' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as { sessionId: string; x: number; y: number };
      const result = await clickCaptcha(body.sessionId, body.x, body.y);
      if (!result) { jsonRes(res, 404, { error: 'Session expired' }); return; }
      if (result.solved) console.log('CAPTCHA solved!');
      jsonRes(res, 200, result);
      return;
    }

    if (url.pathname === '/api/dismiss' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as { sessionId: string };
      dismissCaptcha(body.sessionId);
      jsonRes(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/screenshot' && req.method === 'GET') {
      const sid = url.searchParams.get('sessionId');
      if (!sid) { jsonRes(res, 400, { error: 'Missing sessionId' }); return; }
      const screenshot = await refreshScreenshot(sid);
      if (!screenshot) { jsonRes(res, 404, { error: 'Session expired' }); return; }
      jsonRes(res, 200, { screenshot });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Kill the other process or set TEST_CAPTCHA_PORT.`);
        reject(err);
      } else {
        reject(err);
      }
    });
    server.listen(PORT, () => {
      console.log(`\n  Open http://localhost:${PORT} in your browser to solve the CAPTCHA\n`);
      resolve();
    });
  });

  console.log('Registering CAPTCHA with solver…');
  const solved = await registerCaptcha(page, { platform: 'test', userId: USER_ID });

  console.log(solved ? '\nCAPTCHA was solved successfully!' : '\nCAPTCHA was NOT solved (timed out or dismissed).');

  const finalShot = await page.screenshot({ type: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync('captcha-result.png', finalShot);
  console.log('Final screenshot saved to captcha-result.png');

  server.close();
  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('test-captcha failed:', err);
  process.exit(1);
});
