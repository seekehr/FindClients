#!/usr/bin/env node
/**
 * Development mode: the API and the website as two processes, so both reload
 * on save.
 *
 * This is the one setup where they are on different ports (4000 and 3000), so
 * the server is told not to serve the build and the website is pointed at the
 * API's own origin. Open http://localhost:3000.
 */
import path from 'node:path'
import { ROOT, missingDeps, start, fail } from './lib.mjs'

const missing = missingDeps()
if (missing.length) {
  fail(
    `Dependencies are not installed (${missing.join(', ')}).\n\n` +
      'Run this first:\n\n  npm run setup',
  )
}

const children = [
  start('npm', ['run', 'dev'], {
    cwd: path.join(ROOT, 'server'),
    env: { SERVE_WEBSITE: 'false' },
  }),
  start('npm', ['run', 'dev'], {
    cwd: path.join(ROOT, 'website'),
    // 127.0.0.1, not localhost: the server binds to the IPv4 loopback, and on
    // some Windows setups `localhost` resolves to ::1 first and the browser's
    // API calls are refused before they reach it.
    env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000/api' },
  }),
]

console.log('\nAPI      http://localhost:4000')
console.log('Website  http://localhost:3000\n')

// One process dying should take the other with it, rather than leaving a
// half-running app that looks fine until the first request fails.
let closing = false
function shutdown() {
  if (closing) return
  closing = true
  for (const child of children) child.kill()
}

for (const child of children) child.on('exit', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
