/**
 * Tiny in-memory cache with TTL. Stands in for Redis in the demo — swap the
 * implementation here for a Redis client without touching call sites.
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs = 30_000): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Delete every key starting with the given prefix (used for invalidation). */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Fixed-window counter, used by the rate limiter. Returns the new count. */
  incr(key: string, windowMs: number): number {
    const existing = this.get<number>(key);
    const next = (existing ?? 0) + 1;
    this.set(key, next, windowMs);
    return next;
  }

  clear(): void {
    this.store.clear();
  }
}

export const cache = new MemoryCache();
