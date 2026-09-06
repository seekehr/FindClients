#!/usr/bin/env node
/**
 * Start real Google Chrome with remote debugging on, so FindClients can attach
 * to it instead of driving a browser of its own.
 *
 * Sign in to Upwork and X in the window this opens, then leave it running.
 * Every scrape reuses that session — and because it is an ordinary Chrome you
 * started, with your own profile, Cloudflare treats it like one.
 *
 *   npm run chrome
 *
 * The profile lives in data/chrome-profile/ so it survives restarts. Set
 * CHROME_CDP_URL in .env (npm run chrome prints the value) to switch the
 * scrapers over to it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { ROOT } from './lib.mjs'

const PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9222)
const PROFILE = process.env.CHROME_PROFILE_DIR
  ? path.resolve(ROOT, process.env.CHROME_PROFILE_DIR)
  : path.join(ROOT, 'data', 'chrome-profile')

/** Where Chrome usually lives, per platform. */
const CANDIDATES = {
  win32: [
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Google\Chrome\Application\chrome.exe',
    ),
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  for (const candidate of CANDIDATES[process.platform] ?? []) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return null
}

const chrome = findChrome()
if (!chrome) {
  console.error(
    '\nCould not find Google Chrome.\n\n' +
      'Install it, or set CHROME_PATH in .env to the full path of chrome.exe.\n',
  )
  process.exit(1)
}

fs.mkdirSync(PROFILE, { recursive: true })

console.log(`\nChrome    ${chrome}`)
console.log(`Profile   ${PROFILE}`)
console.log(`Debugging http://127.0.0.1:${PORT}\n`)
console.log('Sign in to Upwork and X in this window, then leave it open.')
console.log(`Add this to your .env so scrapes attach to it:\n`)
console.log(`  CHROME_CDP_URL=http://127.0.0.1:${PORT}\n`)

// Note: no --remote-debugging-address. Binding the debug port to every
// interface hands anyone on the network full control of this browser, cookies
// and all. Loopback is all FindClients needs.
const child = spawn(
  chrome,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  { stdio: 'inherit', detached: false },
)

child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill())
