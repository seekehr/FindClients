#!/usr/bin/env node
/**
 * One-time setup: install each workspace's dependencies and the browser the
 * scrapers drive.
 *
 * The three workspaces are deliberately independent — no root node_modules, no
 * workspaces field — so each keeps its own dependency tree and the website's
 * build tooling never ends up in the server's runtime.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WORKSPACES, main, run } from './lib.mjs'

await main(async () => {
  for (const workspace of WORKSPACES) {
    console.log(`\n── installing ${workspace} ─────────────────────────`)
    await run('npm', ['install'], { cwd: path.join(ROOT, workspace) })
  }

  console.log('\n── installing Chromium for the scrapers ────────────')
  await run('npx', ['playwright', 'install', 'chromium'], { cwd: path.join(ROOT, 'scrapper') })

  const envFile = path.join(ROOT, '.env')
  if (!fs.existsSync(envFile)) {
    fs.copyFileSync(path.join(ROOT, '.env.example'), envFile)
    console.log('\nCreated .env from .env.example.')
  }

  console.log('\nSetup complete. Start the app with:\n\n  npm start\n')
})
