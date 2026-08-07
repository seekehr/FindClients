/**
 * Make scraped text safe to store in Postgres.
 *
 * Two things routinely arrive from a scraper that Postgres will reject, taking
 * the whole insert batch down with them:
 *
 *   • **Lone surrogates.** Slicing a string to a fixed length (`text.slice(0,
 *     100)`) can cut an emoji's surrogate pair in half. The result is not valid
 *     UTF-8, and PostgREST fails with "Unicode low surrogate must follow a high
 *     surrogate". Tweets are full of emoji, so this is common, not exotic.
 *
 *   • **NUL bytes.** Postgres `text` cannot store U+0000 at all — "unsupported
 *     Unicode escape sequence".
 *
 * Sanitising here rather than in each scraper is deliberate: scrapers are
 * user-authored and one malformed field should never be able to discard an
 * entire run's leads.
 */

// A high surrogate not followed by a low one, or a low not preceded by a high.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const NUL = /\u0000/g;

export function sanitizeText(value: string): string {
  return value.replace(NUL, '').replace(LONE_SURROGATE, '');
}

/** Sanitise a nullable field, preserving null. */
export function sanitizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return sanitizeText(value);
}

/**
 * Truncate to a maximum number of *code points*, never splitting a surrogate
 * pair. Use this instead of `String.prototype.slice` when shortening text that
 * may contain emoji.
 */
export function truncateByCodePoint(value: string, max: number): string {
  const points = Array.from(value);
  if (points.length <= max) return value;
  return points.slice(0, max).join('');
}
