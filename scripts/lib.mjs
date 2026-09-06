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
      if (code === 0) return resolve()
      // Tagged so `main` can exit quietly: the child already said what broke.
      const err = new Error(`${command} ${args.join(' ')} exited with code ${code}`)
      err.childFailed = true
      err.exitCode = code ?? 1
      reject(err)
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

/**
 * Run a script's body, exiting quietly when a child process fails.
 *
 * A child that exits non-zero has already explained itself on the terminal the
 * user is looking at. Letting the rejection reach Node's default handler prints
 * a stack trace through these wrapper scripts on top of that explanation, which
 * buries the real message — a busy port ends up looking like a crash in
 * lib.mjs. Anything that is not a child-exit still gets a real stack.
 */
export async function main(body) {
  try {
    await body()
  } catch (err) {
    if (err?.childFailed) process.exit(err.exitCode ?? 1)
    throw err
  }
}
