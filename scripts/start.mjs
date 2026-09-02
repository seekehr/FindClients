#!/usr/bin/env node
/**
 * Start FindClients: one command, one port.
 *
 * Builds the website if it has not been built yet, then starts the server —
 * which serves that build and the API from the same process. The first run
 * takes a minute for the Next.js build; every run after that is instant.
 */
import path from 'node:path'
import { ROOT, isBuilt, missingDeps, run, fail } from './lib.mjs'

const missing = missingDeps()
if (missing.length) {
  fail(
    `Dependencies are not installed (${missing.join(', ')}).\n\n` +
      'Run this first:\n\n  npm run setup',
  )
}

if (!isBuilt()) {
  console.log('Building the website (first run only)…\n')
  await run('npm', ['run', 'build'], { cwd: path.join(ROOT, 'website') })
  console.log('')
}

await run('npm', ['start'], { cwd: path.join(ROOT, 'server') })
