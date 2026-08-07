import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load the repository-wide `.env` (one directory up) so the website shares the
 * same global config file as the server and scrapers. Next.js only looks inside
 * `website/`, so we parse the root file ourselves.
 *
 * Only NEXT_PUBLIC_* keys are forwarded — everything else in the global file is
 * server-side (including the Supabase service key) and must never be inlined
 * into the browser bundle. A real environment variable always wins, as does a
 * value in website/.env.local.
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
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api',
  },
}

export default nextConfig
