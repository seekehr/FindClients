import type { Locator } from 'playwright';
import { noTrace, type Trace } from './debug';

/**
 * Small, forgiving readers over Playwright locators, shared by the scrapers.
 *
 * Every one answers `''`, `null`, `0` or `[]` when the element is simply not
 * there, rather than waiting for it: a job card without a salary line is
 * normal, and a Playwright read waits 30 seconds by default for an element
 * that will never draw. They read what is already on the page; none of them
 * waits for more.
 *
 * Anything that is not "missing" — a card re-rendered mid-read, a tab closed
 * under us — is handed to `trace` along with `where`, which says where it
 * happened in --dev mode (see ./debug.ts) and nothing otherwise.
 */

/** Short on purpose: the element was already counted, so it is there or it is gone. */
const READ = { timeout: 2_000 };

/** Collapse whitespace, as the page's visible text would read. */
export const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Non-empty trimmed lines of a block of text. */
export const lines = (s: string | null | undefined): string[] =>
  (s ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** How many elements match, 0 on error. */
export async function countOf(loc: Locator, where = 'count', trace: Trace = noTrace): Promise<number> {
  try {
    return await loc.count();
  } catch (err) {
    trace(where, err);
    return 0;
  }
}

/** The first match, or null when nothing matches. */
export async function firstOf(loc: Locator, where = 'first', trace: Trace = noTrace): Promise<Locator | null> {
  return (await countOf(loc, where, trace)) > 0 ? loc.first() : null;
}

/** Every match, one locator each, in document order. */
export async function allOf(loc: Locator, where = 'all', trace: Trace = noTrace): Promise<Locator[]> {
  try {
    return await loc.all();
  } catch (err) {
    trace(where, err);
    return [];
  }
}

/** `innerText` of the first match — the text as drawn, line breaks kept. */
export async function innerTextOf(loc: Locator, where = 'innerText', trace: Trace = noTrace): Promise<string> {
  const el = await firstOf(loc, where, trace);
  if (!el) return '';
  try {
    return await el.innerText(READ);
  } catch (err) {
    trace(where, err);
    return '';
  }
}

/** `textContent` of the first match — every text node, hidden ones included. */
export async function textContentOf(loc: Locator, where = 'textContent', trace: Trace = noTrace): Promise<string> {
  const el = await firstOf(loc, where, trace);
  if (!el) return '';
  try {
    return (await el.textContent(READ)) ?? '';
  } catch (err) {
    trace(where, err);
    return '';
  }
}

/** An attribute of the first match; null when there is no match or no attribute. */
export async function attributeOf(
  loc: Locator,
  name: string,
  where = `@${name}`,
  trace: Trace = noTrace,
): Promise<string | null> {
  const el = await firstOf(loc, where, trace);
  if (!el) return null;
  try {
    return await el.getAttribute(name, READ);
  } catch (err) {
    trace(where, err);
    return null;
  }
}

/** `innerText` of every match, in one round trip. */
export async function allInnerTextsOf(loc: Locator, where = 'allInnerTexts', trace: Trace = noTrace): Promise<string[]> {
  try {
    return await loc.allInnerTexts();
  } catch (err) {
    trace(where, err);
    return [];
  }
}

/** `textContent` of every match, in one round trip. */
export async function allTextContentsOf(
  loc: Locator,
  where = 'allTextContents',
  trace: Trace = noTrace,
): Promise<string[]> {
  try {
    return await loc.allTextContents();
  } catch (err) {
    trace(where, err);
    return [];
  }
}
