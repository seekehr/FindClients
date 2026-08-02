import { nanoid } from 'nanoid';
import crypto from 'node:crypto';

export const newId = (prefix = ''): string => (prefix ? `${prefix}_${nanoid(16)}` : nanoid(16));

/**
 * Stable hash used to de-duplicate leads across scrape runs.
 * Two posts with the same platform + url (or platform + title) collapse to one.
 */
export function sourceHash(platform: string, url: string | null | undefined, title: string): string {
  const key = `${platform}::${(url && url.trim()) || title.trim().toLowerCase()}`;
  return crypto.createHash('sha1').update(key).digest('hex');
}
