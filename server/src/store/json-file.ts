import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';

/**
 * A JSON file that behaves like a tiny table.
 *
 * The whole file is read once at boot and kept in memory; every read after
 * that is a plain object access, and writes are debounced and flushed to disk
 * atomically. At this scale — one person's leads on one machine — that is the
 * entire storage engine, and it means no database to install, no migrations to
 * run and no connection to fail.
 *
 * Two properties matter more than speed here:
 *
 *  - **Atomicity.** Writes go to a sibling `.tmp` file which is then renamed
 *    over the real one. Rename is atomic on every OS we care about, so a crash
 *    (or a Ctrl-C mid-save) leaves either the old file or the new one, never a
 *    half-written one.
 *  - **Never lose the user's data to a parse error.** A corrupt file is moved
 *    aside rather than overwritten, so a bug here costs a restart, not months
 *    of collected leads.
 */
export class JsonFile<T> {
  private value: T;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    private readonly file: string,
    private readonly fallback: () => T,
    /** How long to batch rapid writes before touching the disk. */
    private readonly debounceMs = 250,
  ) {
    this.value = this.load();
  }

  private load(): T {
    if (!fs.existsSync(this.file)) return this.fallback();
    try {
      const raw = fs.readFileSync(this.file, 'utf8').trim();
      if (!raw) return this.fallback();
      return JSON.parse(raw) as T;
    } catch (err) {
      // Keep the damaged file. Whatever went wrong, the user's data is more
      // valuable than a clean start, and they can inspect or repair it.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.file, backup);
        logger.error(
          `${path.basename(this.file)} could not be parsed (${(err as Error).message}). ` +
            `Moved it to ${path.basename(backup)} and started fresh.`,
        );
      } catch {
        logger.error(`${path.basename(this.file)} is unreadable and could not be moved aside`);
      }
      return this.fallback();
    }
  }

  /** The in-memory contents. Mutate freely, then call `save()`. */
  get data(): T {
    return this.value;
  }

  set data(next: T) {
    this.value = next;
    this.save();
  }

  /** Mark dirty and schedule a flush. Cheap enough to call on every change. */
  save(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    // A pending save must never be the reason the process stays alive.
    this.timer.unref?.();
  }

  /** Write now, synchronously. Called on shutdown and by `save()`'s timer. */
  flush(): void {
    if (!this.dirty) return;
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (err) {
      logger.error(`Could not save ${path.basename(this.file)}: ${(err as Error).message}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* the temp file is already gone or unreachable — nothing useful to do */
      }
    }
  }
}

/** Every open file, so shutdown can flush them all. */
const openFiles: JsonFile<unknown>[] = [];

export function registerForFlush<T>(file: JsonFile<T>): JsonFile<T> {
  openFiles.push(file as JsonFile<unknown>);
  return file;
}

export function flushAll(): void {
  for (const file of openFiles) file.flush();
}
