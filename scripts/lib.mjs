import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const WORKSPACES = ['server', 'website', 'scrapper']

/**
 * Run a command, inheriting stdio so its output is the user's output.
 *
 * `shell: true` is required on Windows, where `npm` is a .cmd shim that
 * `spawn` cannot execute directly.
 */
export function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd ?? ROOT,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...opts.env },
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

/** Start a long-running process and hand back the child. */
export function start(command, args, opts = {}) {
  return spawn(command, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...opts.env },
  })
}

export const hasDeps = (workspace) => fs.existsSync(path.join(ROOT, workspace, 'node_modules'))

export const isBuilt = () => fs.existsSync(path.join(ROOT, 'website', '.next', 'BUILD_ID'))

export const missingDeps = () => WORKSPACES.filter((w) => !hasDeps(w))

export function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}
