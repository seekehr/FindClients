/**
 * Dev-mode diagnostics for the scrapers.
 *
 * The readers here are deliberately forgiving: a job card without a salary, a
 * tab that closed mid-read, a selector that no longer matches — each costs one
 * field or one card, never the whole run. That is right in production and
 * useless while fixing a scraper, because the error that explains an empty
 * result has been swallowed on the way.
 *
 * In dev mode those swallowed errors are logged with where they happened. Dev
 * mode is on when any of these is true:
 *
 *  - the process was started with `--dev` (`npm run cli -- --dev`);
 *  - `FINDCLIENTS_DEV` is set to 1/true/yes/on;
 *  - it is running under `npm run dev`, which sets `FINDCLIENTS_DEV` for the API.
 *
 * Outside dev mode every function here is a no-op.
 */

export function isDevMode(): boolean {
  if (process.argv.includes('--dev')) return true;
  return ['1', 'true', 'yes', 'on'].includes((process.env.FINDCLIENTS_DEV ?? '').trim().toLowerCase());
}

/** Report an error that is being handled, and where it happened. */
export type Trace = (where: string, err: unknown) => void;

/** A trace that says nothing. The default wherever one is optional. */
export const noTrace: Trace = () => undefined;

/** The first line of an error: Playwright appends a multi-line call log. */
function headline(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0].trim() || 'unknown error';
}

/** The same line again within this window is dropped: the readers poll. */
const REPEAT_WINDOW_MS = 30_000;

/**
 * A trace that logs `[dev] <scope> › <where>: <error>` in dev mode and nothing
 * otherwise. A failure inside a polling loop would otherwise print the same
 * line every half second, so repeats within 30 seconds are dropped.
 */
export function devTrace(log: (m: string) => void, scope: string): Trace {
  if (!isDevMode()) return noTrace;
  const lastSeen = new Map<string, number>();
  return (where, err) => {
    const line = `[dev] ${scope} › ${where}: ${headline(err)}`;
    const now = Date.now();
    if (now - (lastSeen.get(line) ?? -Infinity) < REPEAT_WINDOW_MS) return;
    if (lastSeen.size > 500) lastSeen.clear();
    lastSeen.set(line, now);
    log(line);
  };
}

/** The same trace, with more context in front of every `where`. */
export function within(trace: Trace, prefix: string): Trace {
  if (trace === noTrace) return noTrace;
  return (where, err) => trace(`${prefix} › ${where}`, err);
}

/** A dev-mode-only progress line, for results that are empty rather than failed. */
export function devNote(log: (m: string) => void, scope: string): (m: string) => void {
  if (!isDevMode()) return () => undefined;
  return (m) => log(`[dev] ${scope} › ${m}`);
}
