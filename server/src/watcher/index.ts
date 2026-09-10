import { env } from '../config/env';
import { logger } from '../utils/logger';
import { loadWatcher } from '../scrapers/loader';
import { browserStatus, invalidateBrowserStatus } from '../services/browser.service';
import { getConfig } from '../services/config.service';
import { isConnected, markError, markUsed } from '../services/connection.service';
import { insertLeads, isLeadKnown } from '../services/lead.service';
import { createNotification, postToDiscord } from '../services/notification.service';
import { recordOpportunity } from '../services/opportunity.service';
import { alertDelayMs, nextReloadDelayMs, staggerMs } from './random';
import type { RawLead, WatchTab } from '../scrapers/types';
import type { LeadMetadata } from '../types';

/**
 * The Upwork job watcher.
 *
 * Upwork is the one platform FindClients does not scrape, and this file is what
 * it does instead.
 *
 * A scraper visits: it opens the feed, clicks "Load More" until it has
 * everything, opens every job in turn, and leaves. That is the behaviour
 * Upwork's terms forbid and its systems are built to spot — one session pulling
 * hundreds of listings on a fixed schedule is not a freelancer browsing, and
 * accounts that do it get banned.
 *
 * The watcher does not visit. It leaves one tab open on the feed you already
 * use, reloads that single page every five to ten minutes, and reads what came
 * back. It never pages, never asks for more than the first screen, and never
 * opens a job it was not already shown. When something new appears it waits two
 * or three minutes — drawn fresh for each job — before telling you, because an
 * account that surfaces every listing four seconds after it goes up is the most
 * conspicuous one on the platform.
 *
 * The delay is the feature, not an apology for one. Everything else in here
 * exists to keep the tab alive and honest about its own state.
 */

export type WatchState =
  /** Switched off in your config, or never started. */
  | 'off'
  /** Opening the tab. */
  | 'starting'
  /** Tab is open and idle, waiting out the interval until the next reload. */
  | 'watching'
  /** Reloading the feed right now. */
  | 'checking'
  /** A bot challenge is on screen and needs a person. */
  | 'blocked'
  /** The Upwork session has expired. */
  | 'signed-out'
  /** The Chrome we attach to is not running. */
  | 'browser-down'
  /** Something else went wrong; the loop will retry. */
  | 'error';

/** A job spotted on the feed and deliberately held back. */
interface QueuedAlert {
  id: string;
  title: string;
  url: string | null;
  lead: RawLead;
  spottedAt: string;
  /** When it will be released to you. */
  dueAt: string;
  timer: NodeJS.Timeout;
}

export interface QueuedAlertDTO {
  id: string;
  title: string;
  dueAt: string;
  /** Whole seconds left, so the UI does not have to trust its own clock. */
  dueInSeconds: number;
}

export interface WatcherStatus {
  platform: 'upwork';
  name: string;
  /** Whether job alerts are switched on in your config. */
  enabled: boolean;
  /** Whether the loop is actually alive right now. */
  running: boolean;
  state: WatchState;
  /** One sentence for the UI, in plain words. */
  detail: string;
  feedUrl: string;
  startedAt: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  /** How many jobs were on the feed at the last reload. */
  jobsOnFeed: number;
  /** Reloads performed since the watcher started. */
  checks: number;
  /** Alerts released since the watcher started. */
  alerts: number;
  /** Spotted, waiting out their human delay. */
  queued: QueuedAlertDTO[];
  lastError: string | null;
  /** The windows in force, so the UI can describe them without guessing. */
  reloadMinutes: [number, number];
  delaySeconds: [number, number];
}

const PLATFORM = 'upwork' as const;

/** How long to wait before retrying after a recoverable failure. */
const RETRY_MS = 3 * 60 * 1000;

/** A signed-out session needs you, not a retry loop — check back rarely. */
const SIGNED_OUT_RETRY_MS = 10 * 60 * 1000;

interface WatcherRuntime {
  tab: WatchTab | null;
  timer: NodeJS.Timeout | null;
  queue: Map<string, QueuedAlert>;
  state: WatchState;
  detail: string;
  startedAt: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  jobsOnFeed: number;
  checks: number;
  alerts: number;
  lastError: string | null;
  /** True until the first reload has established what was already on the feed. */
  seeding: boolean;
  /** Set while stop() is unwinding, so an in-flight poll does not reschedule. */
  stopping: boolean;
  /**
   * Serialises everything that touches the tab. One Playwright page cannot be
   * reloaded and read at the same time, and an alert being enriched two minutes
   * after it was spotted would otherwise collide with the next reload.
   */
  lock: Promise<unknown>;
}

const runtime: WatcherRuntime = {
  tab: null,
  timer: null,
  queue: new Map(),
  state: 'off',
  detail: 'Job alerts are off.',
  startedAt: null,
  lastCheckedAt: null,
  nextCheckAt: null,
  jobsOnFeed: 0,
  checks: 0,
  alerts: 0,
  lastError: null,
  seeding: true,
  stopping: false,
  lock: Promise.resolve(),
};

const log = (msg: string) => logger.info(`[Upwork alerts] ${msg}`);

function setState(state: WatchState, detail: string): void {
  runtime.state = state;
  runtime.detail = detail;
}

/** Run `fn` with exclusive use of the tab. */
function withTab<T>(fn: () => Promise<T>): Promise<T> {
  const next = runtime.lock.then(fn, fn);
  // Keep the chain alive even when a link rejects, or one failed poll would
  // deadlock every later one.
  runtime.lock = next.catch(() => undefined);
  return next;
}

// ── Status ────────────────────────────────────────────────

export function watcherStatus(): WatcherStatus {
  const config = getConfig();
  const now = Date.now();

  const queued = [...runtime.queue.values()]
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .map((item) => ({
      id: item.id,
      title: item.title,
      dueAt: item.dueAt,
      dueInSeconds: Math.max(0, Math.round((new Date(item.dueAt).getTime() - now) / 1000)),
    }));

  return {
    platform: PLATFORM,
    name: 'Upwork job alerts',
    enabled: config.upworkWatchEnabled,
    running: runtime.timer !== null || runtime.state === 'checking',
    state: runtime.state,
    detail: runtime.detail,
    feedUrl: config.upworkJobsUrl,
    startedAt: runtime.startedAt,
    lastCheckedAt: runtime.lastCheckedAt,
    nextCheckAt: runtime.nextCheckAt,
    jobsOnFeed: runtime.jobsOnFeed,
    checks: runtime.checks,
    alerts: runtime.alerts,
    queued,
    lastError: runtime.lastError,
    reloadMinutes: [config.upworkReloadMinMinutes, config.upworkReloadMaxMinutes],
    delaySeconds: [config.upworkAlertDelayMinSeconds, config.upworkAlertDelayMaxSeconds],
  };
}

// ── Scheduling ────────────────────────────────────────────

function clearTimer(): void {
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.nextCheckAt = null;
}

function scheduleNext(delayMs: number): void {
  if (runtime.stopping) return;
  clearTimer();
  runtime.nextCheckAt = new Date(Date.now() + delayMs).toISOString();
  runtime.timer = setTimeout(() => {
    runtime.timer = null;
    void tick();
  }, delayMs);
  runtime.timer.unref?.();
}

function scheduleNormal(): void {
  const config = getConfig();
  const delay = nextReloadDelayMs(config.upworkReloadMinMinutes, config.upworkReloadMaxMinutes);
  scheduleNext(delay);
  const mins = Math.floor(delay / 60_000);
  const secs = Math.round((delay % 60_000) / 1000);
  log(`next look in ${mins}m ${secs}s`);
}

// ── The loop ──────────────────────────────────────────────

async function openTab(): Promise<WatchTab | null> {
  const config = getConfig();

  const watcher = await loadWatcher(PLATFORM);
  if (!watcher) {
    setState('error', 'No Upwork watcher is installed in scrapper/.');
    return null;
  }

  invalidateBrowserStatus();
  const browser = await browserStatus();
  if (!browser.reachable) {
    setState('browser-down', `Chrome is not running at ${browser.url}. ${browser.hint}`);
    return null;
  }

  if (!isConnected(PLATFORM)) {
    setState('signed-out', 'Not signed in to Upwork — connect it on the Connections page.');
    return null;
  }

  setState('starting', 'Opening the Upwork tab…');
  return watcher.open({
    feedUrl: config.upworkJobsUrl,
    log,
    interactive: env.captchaOpenWindow,
    captchaTimeoutMs: env.captchaTimeoutMs,
    fetchDetails: config.upworkFetchDetails,
  });
}

async function closeTab(): Promise<void> {
  const tab = runtime.tab;
  runtime.tab = null;
  if (tab) await tab.close().catch(() => undefined);
}

/** One pass: make sure the tab is there, reload it, queue whatever is new. */
async function tick(): Promise<void> {
  if (runtime.stopping) return;

  try {
    if (!runtime.tab || !runtime.tab.isOpen()) {
      // A tab that closed under us — the user shut it, or Chrome restarted.
      if (runtime.tab) log('the Upwork tab went away — opening a new one');
      await closeTab();
      runtime.tab = await openTab();
      if (!runtime.tab) {
        // openTab has already explained itself through setState.
        scheduleNext(runtime.state === 'signed-out' ? SIGNED_OUT_RETRY_MS : RETRY_MS);
        return;
      }
      // A fresh tab has never seen this feed, so its first read is a baseline
      // rather than a pile of "new" jobs from before we were watching.
      runtime.seeding = true;
    }

    setState('checking', 'Reloading the Upwork feed…');
    const result = await withTab(() => runtime.tab!.poll());

    runtime.checks += 1;
    runtime.lastCheckedAt = new Date().toISOString();

    if (result.problem) {
      await handleProblem(result.problem, result.detail);
      return;
    }

    runtime.lastError = null;
    runtime.jobsOnFeed = result.leads.length;
    markUsed(PLATFORM);

    const queuedNow = queueNew(result.leads);
    const seeded = runtime.seeding;
    runtime.seeding = false;

    if (seeded) {
      log(
        `watching from here — ${result.leads.length} job(s) already on the feed; ` +
          'you will hear about anything that appears from now on',
      );
    }

    setState(
      'watching',
      queuedNow > 0
        ? `${queuedNow} new job${queuedNow === 1 ? '' : 's'} spotted — holding briefly before alerting.`
        : `Watching the Upwork feed. ${result.leads.length} job(s) on it, nothing new.`,
    );
    scheduleNormal();
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    runtime.lastError = message;
    setState('error', message);
    logger.error('[Upwork alerts] check failed', message);
    markError(PLATFORM, message);
    // The tab is the usual casualty; drop it so the next tick reopens one.
    await closeTab();
    scheduleNext(RETRY_MS);
  }
}

async function handleProblem(problem: string, detail?: string): Promise<void> {
  switch (problem) {
    case 'signed-out':
      setState('signed-out', 'Your Upwork session has expired — sign in again on Connections.');
      markError(PLATFORM, 'Session expired');
      await closeTab();
      scheduleNext(SIGNED_OUT_RETRY_MS);
      return;

    case 'challenge':
      setState(
        'blocked',
        'Upwork is showing a bot check. Clear it in the Chrome window and watching resumes.',
      );
      scheduleNext(RETRY_MS);
      return;

    case 'closed':
      setState('error', 'The Upwork tab was closed.');
      await closeTab();
      scheduleNext(RETRY_MS);
      return;

    default:
      setState('error', detail ?? 'The Upwork feed did not load.');
      runtime.lastError = detail ?? 'The feed did not load.';
      scheduleNext(RETRY_MS);
  }
}

// ── Spotting and holding ──────────────────────────────────

/**
 * Queue every job on the feed we have not seen before.
 *
 * On the very first read of a tab that is nearly all of them, and alerting on
 * the lot would mean a restart dumps a day of old listings on you. So the
 * seeding pass only lets through jobs young enough that they could plausibly
 * have appeared while we were connecting.
 *
 * @returns how many were queued.
 */
function queueNew(leads: RawLead[]): number {
  const config = getConfig();
  const maxAgeMs = Math.max(1, config.upworkMaxAgeHours) * 60 * 60 * 1000;
  const seedWindowMs = Math.max(2, config.upworkReloadMaxMinutes) * 60 * 1000;
  const now = Date.now();

  let index = 0;
  for (const lead of leads) {
    if (!lead.title) continue;

    const key = lead.url ?? lead.title;
    if (runtime.queue.has(key)) continue;
    if (isLeadKnown(PLATFORM, lead.url, lead.title)) continue;

    // Nothing stale, ever. The feed reorders itself, and an hours-old job
    // drifting back onto the first screen is not news.
    //
    // An unparseable date counts as brand new, which is right on a normal poll
    // — a job we cannot date is more likely to be the one that just appeared
    // than a lost lead worth dropping. On the seeding pass it is the opposite:
    // treating a screen of unknown-age listings as new would alert on all of
    // them, so seeding requires a date it can actually read.
    const parsed = lead.postedAt ? new Date(lead.postedAt).getTime() : NaN;
    const dated = Number.isFinite(parsed);
    const age = dated ? now - parsed : 0;

    if (age > maxAgeMs) continue;
    if (runtime.seeding && (!dated || age > seedWindowMs)) continue;

    const wait =
      alertDelayMs(config.upworkAlertDelayMinSeconds, config.upworkAlertDelayMaxSeconds) +
      staggerMs(index);

    const timer = setTimeout(() => {
      void release(key).catch((err) =>
        logger.error('[Upwork alerts] could not release an alert', (err as Error).message),
      );
    }, wait);
    timer.unref?.();

    runtime.queue.set(key, {
      id: key,
      title: lead.title,
      url: lead.url ?? null,
      lead,
      spottedAt: new Date().toISOString(),
      dueAt: new Date(now + wait).toISOString(),
      timer,
    });

    log(`spotted "${lead.title.slice(0, 60)}" — holding ${Math.round(wait / 1000)}s`);
    index += 1;
  }

  return index;
}

/** Turn a client's metadata into the one line the panel shows. */
function clientLine(metadata: LeadMetadata | undefined): string {
  if (!metadata) return '';
  const bits: string[] = [];
  const push = (value: unknown, format: (v: string) => string) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) bits.push(format(text));
  };
  push(metadata.clientRating, (v) => `${v}★`);
  push(metadata.clientHireRate, (v) => v);
  push(metadata.clientSpent, (v) => `${v} spent`);
  push(metadata.paymentVerified, (v) => v);
  push(metadata.clientCountry, (v) => v);
  return bits.join(' · ');
}

/**
 * The delay is up: look at the job properly, then tell the user about it.
 *
 * Enrichment happens here rather than at spotting time on purpose. Opening a
 * listing a couple of minutes after noticing it is what a person does, and it
 * keeps the reload itself down to one page load.
 *
 * Every new job is announced. There is no AI review and no keyword or budget
 * filter here: the feed being watched is already the user's own Upwork search,
 * tuned to them, so a second screen only loses jobs and spends Gemini quota.
 */
async function release(key: string): Promise<void> {
  const item = runtime.queue.get(key);
  if (!item) return;
  runtime.queue.delete(key);
  clearTimeout(item.timer);

  const config = getConfig();
  const lead: RawLead = { ...item.lead };
  const short = item.title.slice(0, 60);

  if (config.upworkFetchDetails && item.url) {
    const extra = await withTab(async () => {
      const tab = runtime.tab;
      if (!tab?.isOpen() || !tab.inspect) return null;
      return tab.inspect(item.url as string).catch(() => null);
    }).catch(() => null);
    if (extra) lead.metadata = { ...(lead.metadata ?? {}), ...extra };
  }

  const { inserted } = insertLeads([lead]);
  if (!inserted.length) {
    log(`"${short}" was already on file — not alerting twice`);
    return;
  }

  const job = inserted[0];

  const opportunity = recordOpportunity({
    platform: PLATFORM,
    lead: job,
    spottedAt: item.spottedAt,
    heldForSeconds: (Date.now() - new Date(item.spottedAt).getTime()) / 1000,
    client: clientLine(job.metadata),
  });

  runtime.alerts += 1;
  log(`new opportunity: "${short}"`);

  if (!config.newLeadsNotification) return;

  createNotification({
    type: 'opportunity',
    title: 'New Upwork opportunity',
    message: opportunity.title,
    leadId: job.id,
  });

  if (config.discordWebhookUrl) {
    const budget = opportunity.budget ? ` — ${opportunity.budget}` : '';
    const link = opportunity.url ? `\n${opportunity.url}` : '';
    await postToDiscord(
      config.discordWebhookUrl,
      `**New Upwork opportunity**\n${opportunity.title}${budget}${link}`,
    ).catch((err) => logger.warn('Discord webhook failed', (err as Error).message));
  }
}

// ── Lifecycle ─────────────────────────────────────────────

/**
 * Start watching.
 *
 * The first look is not immediate. A tab that reloads the instant the server
 * boots, every single time the server boots, is a pattern of its own — and it
 * is also the moment the machine is busiest.
 */
export function startWatcher(reason = 'startup'): WatcherStatus {
  const config = getConfig();

  if (!config.upworkWatchEnabled) {
    setState('off', 'Upwork job alerts are switched off in your config.');
    return watcherStatus();
  }
  if (runtime.timer || runtime.state === 'checking' || runtime.state === 'starting') {
    return watcherStatus();
  }

  runtime.stopping = false;
  runtime.seeding = true;
  runtime.startedAt = new Date().toISOString();
  runtime.checks = 0;
  runtime.alerts = 0;
  runtime.lastError = null;

  const first = 5_000 + Math.random() * 25_000;
  setState('starting', 'Opening the Upwork tab…');
  scheduleNext(first);
  log(`watching started (${reason}) — first look in ${Math.round(first / 1000)}s`);

  return watcherStatus();
}

/**
 * Stop watching and let go of the tab.
 *
 * Queued alerts are dropped rather than flushed. They were never stored, so the
 * next run simply finds them on the feed again — and releasing a backlog the
 * instant you press Pause would defeat the pacing this module exists to impose.
 */
export async function stopWatcher(reason = 'stopped'): Promise<WatcherStatus> {
  runtime.stopping = true;
  clearTimer();

  for (const item of runtime.queue.values()) clearTimeout(item.timer);
  const dropped = runtime.queue.size;
  runtime.queue.clear();

  await closeTab();

  setState('off', `Job alerts are paused (${reason}).`);
  runtime.startedAt = null;
  runtime.nextCheckAt = null;
  runtime.stopping = false;

  log(`stopped (${reason})` + (dropped ? ` — ${dropped} queued alert(s) dropped` : ''));
  return watcherStatus();
}

/**
 * Look now, without waiting out the interval.
 *
 * Safe to put behind a button: it is one reload of a page that is already open,
 * and the per-job delays still apply to whatever it finds.
 */
export function checkNow(): WatcherStatus | null {
  // Paused is a decision, not a gap. Restarting the watcher because someone
  // pressed "Check now" would override it silently; the caller says so instead.
  if (!getConfig().upworkWatchEnabled) return null;
  if (runtime.timer === null && runtime.state !== 'checking') return null;

  scheduleNext(250);
  return watcherStatus();
}

/**
 * Hand the browser profile back, so a sign-in or session check can have it.
 *
 * Only one process may hold a Chromium profile open, so a watcher sitting on
 * the Upwork tab makes "Sign in again" fail with a lock error. Callers are
 * expected to `resumeWatcher()` once they are done.
 */
export async function suspendWatcher(): Promise<boolean> {
  const wasRunning = runtime.timer !== null || runtime.tab !== null;
  if (!wasRunning) return false;
  await stopWatcher('paused for sign-in');
  return true;
}

export function resumeWatcher(reason = 'resumed'): void {
  if (!getConfig().upworkWatchEnabled) return;
  startWatcher(reason);
}

/** Apply a config change: start, stop, or leave alone as the new settings say. */
export function syncWatcherWithConfig(): void {
  const enabled = getConfig().upworkWatchEnabled;
  const running = runtime.timer !== null || runtime.tab !== null;

  if (enabled && !running) startWatcher('enabled in config');
  else if (!enabled && running) void stopWatcher('switched off in config');
}
