/**
 * The timing this whole feature turns on.
 *
 * A watcher that reloads every 7 minutes exactly, and forwards every job the
 * instant it appears, is *more* obviously a robot than a scraper is — it is a
 * metronome with a login. Nothing here is decorative: these functions are the
 * difference between a tab someone left open and a tab something is driving.
 *
 * Two rules shape all of it:
 *
 *  1. **Never uniform, never rounded.** Real intervals cluster, wander, and land
 *     on ugly numbers. A value drawn flat from [5, 10] minutes has a giveaway
 *     signature of its own — a perfectly even histogram — so the draws below are
 *     deliberately lumpy.
 *  2. **Never simultaneous.** Three jobs spotted in one reload must not arrive
 *     together three minutes later, because a person reads them one at a time.
 */

/** Uniform draw in [min, max). */
function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * How long to wait before the next reload.
 *
 * Base draw across the configured window, then two irregularities: a slight
 * pull toward the middle (people check "in about ten minutes", not uniformly
 * across a range), and an occasional long gap for the meeting, lunch or phone
 * call that takes them away from the desk entirely.
 */
export function nextReloadDelayMs(minMinutes: number, maxMinutes: number): number {
  const min = Math.max(1, minMinutes) * 60_000;
  const max = Math.max(min + 60_000, maxMinutes * 60_000);

  // Average of two draws — same range, but the middle is where most land.
  const base = (between(min, max) + between(min, max)) / 2;

  // Roughly one gap in seven is a long one: the user walked away.
  const distracted = Math.random() < 0.14 ? between(0, max - min) * 1.5 : 0;

  // A few seconds of untidiness, so no two gaps are ever the same round number.
  return Math.round(base + distracted + between(0, 9_000));
}

/**
 * How long to sit on a spotted job before it reaches you.
 *
 * The point is not the length of the pause — it is that acting on a job posted
 * four seconds ago, every single time, is a pattern no person produces and the
 * clearest possible signal that something is watching the feed for you.
 */
export function alertDelayMs(minSeconds: number, maxSeconds: number): number {
  const min = Math.max(5, minSeconds) * 1000;
  const max = Math.max(min + 5_000, maxSeconds * 1000);

  let ms = between(min, max);

  // One in four takes noticeably longer — the job was spotted, then something
  // else happened first.
  if (Math.random() < 0.25) ms += between(0, max - min) * 0.8;

  return Math.round(ms + between(0, 2_500));
}

/**
 * Extra spacing for the second, third, … job found in the same reload, so a
 * quiet hour followed by four jobs does not produce four alerts on one tick.
 */
export function staggerMs(index: number): number {
  if (index <= 0) return 0;
  let total = 0;
  for (let i = 0; i < index; i += 1) total += between(9_000, 55_000);
  return Math.round(total);
}
