import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load the repository-wide `.env` (one directory up) so the website shares the
 * same global config file as the server and scrapers. Next.js only looks inside
 * `website/`, so we parse the root file ourselves.
 *
 * Only NEXT_PUBLIC_* keys are forwarded — everything else in that file is for
 * the server process and has no business in the browser bundle. A real
 * environment variable always wins, as does a value in website/.env.local.
 */
function loadRootPublicEnv() {
  const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
  if (!fs.existsSync(rootEnv)) return

  for (const line of fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadRootPublicEnv()

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  env: {
    // Same origin by default: `npm start` serves this build and the API from
    // one process on one port. `npm run dev` overrides it with the API's port.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? '/api',
  },
}

export default nextConfig
