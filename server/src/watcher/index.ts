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
import {
  WATCHED_PLATFORMS,
  type AppConfig,
  type LeadMetadata,
  type WatchedPlatform,
} from '../types';

/**
 * The job watchers — Upwork, and LinkedIn's job search.
 *
 * These are the platforms FindClients does not scrape for jobs, and this file
 * is what it does instead.
 *
 * A scraper visits: it opens the feed, clicks "Load More" until it has
 * everything, opens every job in turn, and leaves. That is the behaviour
 * Upwork's terms forbid and its systems are built to spot — one session pulling
 * hundreds of listings on a fixed schedule is not a freelancer browsing, and
 * accounts that do it get banned. LinkedIn restricts accounts for the same.
 *
 * A watcher does not visit. It leaves one tab open on the feed you already
 * use, reloads that single page every ten to fifteen minutes, and reads what came
 * back. It never pages, never asks for more than the first screen, and never
 * opens a job it was not already shown. When something new appears it waits two
 * or three minutes — drawn fresh for each job — before telling you, because an
 * account that surfaces every listing four seconds after it goes up is the most
 * conspicuous one on the platform.
 *
 * Each platform gets its own loop, its own tab and its own clock. They share
 * nothing but the code: a LinkedIn sign-in pausing the LinkedIn tab must not
 * cost you Upwork alerts, and two tabs reloading in lockstep would be a pattern
 * of its own.
 *
 * The delay is the feature, not an apology for one. Everything else in here
 * exists to keep the tabs alive and honest about their own state.
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
  /** The session has expired. */
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
  platform: WatchedPlatform;
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
  /** The feed was read, but something about it needs your attention. */
  warning: string | null;
  /** The windows in force, so the UI can describe them without guessing. */
  reloadMinutes: [number, number];
  delaySeconds: [number, number];
}

/** One platform's knobs, read out of the config under its own names. */
interface WatchSettings {
  enabled: boolean;
  feedUrl: string;
  fetchDetails: boolean;
  maxAgeHours: number;
  reloadMinutes: [number, number];
  delaySeconds: [number, number];
}

/** What a platform is called in logs, notifications and the UI. */
const SITE: Record<WatchedPlatform, string> = { upwork: 'Upwork', linkedin: 'LinkedIn' };

function settingsFor(platform: WatchedPlatform, c: AppConfig): WatchSettings {
  if (platform === 'linkedin') {
    return {
      enabled: c.linkedinWatchEnabled,
      feedUrl: c.linkedinJobsUrl,
      fetchDetails: c.linkedinFetchDetails,
      maxAgeHours: c.linkedinMaxAgeHours,
      reloadMinutes: [c.linkedinReloadMinMinutes, c.linkedinReloadMaxMinutes],
      delaySeconds: [c.linkedinAlertDelayMinSeconds, c.linkedinAlertDelayMaxSeconds],
    };
  }
  return {
    enabled: c.upworkWatchEnabled,
    feedUrl: c.upworkJobsUrl,
    fetchDetails: c.upworkFetchDetails,
    maxAgeHours: c.upworkMaxAgeHours,
    reloadMinutes: [c.upworkReloadMinMinutes, c.upworkReloadMaxMinutes],
    delaySeconds: [c.upworkAlertDelayMinSeconds, c.upworkAlertDelayMaxSeconds],
  };
}

const settings = (platform: WatchedPlatform) => settingsFor(platform, getConfig());

/** How long to wait before retrying after a recoverable failure. */
const RETRY_MS = 3 * 60 * 1000;

/** On the first read of a tab, jobs up to this old are still alerted on. */
const SEED_WINDOW_MS = 30 * 60 * 1000;

/** A signed-out session needs you, not a retry loop — check back rarely. */
const SIGNED_OUT_RETRY_MS = 10 * 60 * 1000;

interface WatcherRuntime {
  platform: WatchedPlatform;
  tab: WatchTab | null;
  /** The feed URL the open tab was pointed at, so a changed one reopens it. */
  openedWith: string | null;
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
  warning: string | null;
  /** True until the first reload has established what was already on the feed. */
  seeding: boolean;
  /**
   * Jobs the seeding pass decided were already there. Remembered, not just
   * skipped once: otherwise the very next reload finds them again, they are
   * still unknown, and a restart's worth of old listings gets announced ten
   * minutes late as "new".
   */
  baseline: Set<string>;
  /** Set while stop() is unwinding, so an in-flight poll does not reschedule. */
  stopping: boolean;
  /**
   * Serialises everything that touches the tab. One Playwright page cannot be
   * reloaded and read at the same time, and an alert being enriched two minutes
   * after it was spotted would otherwise collide with the next reload.
   */
  lock: Promise<unknown>;
}

function newRuntime(platform: WatchedPlatform): WatcherRuntime {
  return {
    platform,
    tab: null,
    openedWith: null,
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
    warning: null,
    seeding: true,
    baseline: new Set(),
    stopping: false,
    lock: Promise.resolve(),
  };
}

const runtimes = new Map<WatchedPlatform, WatcherRuntime>(
  WATCHED_PLATFORMS.map((p) => [p, newRuntime(p)]),
);

export function isWatchedPlatform(platform: string): platform is WatchedPlatform {
  return (WATCHED_PLATFORMS as readonly string[]).includes(platform);
}

function rt(platform: WatchedPlatform): WatcherRuntime {
  return runtimes.get(platform)!;
}

const logFor = (platform: WatchedPlatform) => (msg: string) =>
  logger.info(`[${SITE[platform]} alerts] ${msg}`);

function setState(r: WatcherRuntime, state: WatchState, detail: string): void {
  r.state = state;
  r.detail = detail;
}

/** Run `fn` with exclusive use of the tab. */
function withTab<T>(r: WatcherRuntime, fn: () => Promise<T>): Promise<T> {
  const next = r.lock.then(fn, fn);
  // Keep the chain alive even when a link rejects, or one failed poll would
  // deadlock every later one.
  r.lock = next.catch(() => undefined);
  return next;
}

const isRunning = (r: WatcherRuntime) => r.timer !== null || r.state === 'checking';

// ── Status ────────────────────────────────────────────────

/**
 * The idle status line, worked out when asked rather than frozen at reload
 * time — a count of jobs "spotted" that were released minutes ago is wrong.
 */
function watchingDetail(r: WatcherRuntime): string {
  const held = r.queue.size;
  return held > 0
    ? `${held} new job${held === 1 ? '' : 's'} spotted — holding briefly before alerting.`
    : `Watching the ${SITE[r.platform]} feed. ${r.jobsOnFeed} job(s) on it, nothing waiting.`;
}

export function watcherStatus(platform: WatchedPlatform): WatcherStatus {
  const r = rt(platform);
  const s = settings(platform);
  const now = Date.now();

  const queued = [...r.queue.values()]
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .map((item) => ({
      id: item.id,
      title: item.title,
      dueAt: item.dueAt,
      dueInSeconds: Math.max(0, Math.round((new Date(item.dueAt).getTime() - now) / 1000)),
    }));

  return {
    platform,
    name: `${SITE[platform]} job alerts`,
    enabled: s.enabled,
    running: isRunning(r),
    state: r.state,
    detail: r.state === 'watching' ? watchingDetail(r) : r.detail,
    feedUrl: s.feedUrl,
    startedAt: r.startedAt,
    lastCheckedAt: r.lastCheckedAt,
    nextCheckAt: r.nextCheckAt,
    jobsOnFeed: r.jobsOnFeed,
    checks: r.checks,
    alerts: r.alerts,
    queued,
    lastError: r.lastError,
    warning: r.warning,
    reloadMinutes: s.reloadMinutes,
    delaySeconds: s.delaySeconds,
  };
}

/** Every watcher, Upwork first. */
export function watcherStatuses(): WatcherStatus[] {
  return WATCHED_PLATFORMS.map(watcherStatus);
}

// ── Scheduling ────────────────────────────────────────────

function clearTimer(r: WatcherRuntime): void {
  if (r.timer) clearTimeout(r.timer);
  r.timer = null;
  r.nextCheckAt = null;
}

function scheduleNext(r: WatcherRuntime, delayMs: number): void {
  if (r.stopping) return;
  clearTimer(r);
  r.nextCheckAt = new Date(Date.now() + delayMs).toISOString();
  r.timer = setTimeout(() => {
    r.timer = null;
    void tick(r);
  }, delayMs);
  r.timer.unref?.();
}

function scheduleNormal(r: WatcherRuntime): void {
  const [min, max] = settings(r.platform).reloadMinutes;
  const delay = nextReloadDelayMs(min, max);
  scheduleNext(r, delay);
  const mins = Math.floor(delay / 60_000);
  const secs = Math.round((delay % 60_000) / 1000);
  logFor(r.platform)(`next look in ${mins}m ${secs}s`);
}

// ── The loop ──────────────────────────────────────────────

async function openTab(r: WatcherRuntime): Promise<WatchTab | null> {
  const site = SITE[r.platform];
  const s = settings(r.platform);

  const watcher = await loadWatcher(r.platform);
  if (!watcher) {
    setState(r, 'error', `No ${site} watcher is installed in scrapper/.`);
    return null;
  }

  invalidateBrowserStatus();
  const browser = await browserStatus();
  if (!browser.reachable) {
    setState(r, 'browser-down', `Chrome is not running at ${browser.url}. ${browser.hint}`);
    return null;
  }

  if (!isConnected(r.platform)) {
    setState(r, 'signed-out', `Not signed in to ${site} — connect it on the Connections page.`);
    return null;
  }

  setState(r, 'starting', `Opening the ${site} tab…`);
  const tab = await watcher.open({
    feedUrl: s.feedUrl,
    log: logFor(r.platform),
    interactive: env.captchaOpenWindow,
    captchaTimeoutMs: env.captchaTimeoutMs,
    fetchDetails: s.fetchDetails,
  });
  r.openedWith = s.feedUrl;
  return tab;
}

async function closeTab(r: WatcherRuntime): Promise<void> {
  const tab = r.tab;
  r.tab = null;
  r.openedWith = null;
  if (tab) await tab.close().catch(() => undefined);
}

/** One pass: make sure the tab is there, reload it, queue whatever is new. */
async function tick(r: WatcherRuntime): Promise<void> {
  if (r.stopping) return;
  const site = SITE[r.platform];
  const log = logFor(r.platform);

  try {
    if (!r.tab || !r.tab.isOpen()) {
      // A tab that closed under us — the user shut it, or Chrome restarted.
      if (r.tab) log(`the ${site} tab went away — opening a new one`);
      await closeTab(r);
      r.tab = await openTab(r);
      if (!r.tab) {
        // openTab has already explained itself through setState.
        scheduleNext(r, r.state === 'signed-out' ? SIGNED_OUT_RETRY_MS : RETRY_MS);
        return;
      }
      // A fresh tab has never seen this feed, so its first read is a baseline
      // rather than a pile of "new" jobs from before we were watching.
      r.seeding = true;
      r.baseline.clear();
    }

    setState(r, 'checking', `Reloading the ${site} feed…`);
    const result = await withTab(r, () => r.tab!.poll());

    r.checks += 1;
    r.lastCheckedAt = new Date().toISOString();

    if (result.problem) {
      await handleProblem(r, result.problem, result.detail);
      return;
    }

    r.lastError = null;
    r.warning = result.warning ?? null;
    r.jobsOnFeed = result.leads.length;
    markUsed(r.platform);

    const queuedNow = queueNew(r, result.leads);
    const seeded = r.seeding;
    r.seeding = false;

    if (seeded) {
      log(
        `watching from here — ${result.leads.length} job(s) already on the feed; ` +
          'you will hear about anything that appears from now on',
      );
    }

    if (queuedNow > 0) log(`${queuedNow} new job(s) spotted`);
    setState(r, 'watching', watchingDetail(r));
    scheduleNormal(r);
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    r.lastError = message;
    setState(r, 'error', message);
    logger.error(`[${site} alerts] check failed`, message);
    markError(r.platform, message);
    // The tab is the usual casualty; drop it so the next tick reopens one.
    await closeTab(r);
    scheduleNext(r, RETRY_MS);
  }
}

async function handleProblem(r: WatcherRuntime, problem: string, detail?: string): Promise<void> {
  const site = SITE[r.platform];
  switch (problem) {
    case 'signed-out':
      setState(r, 'signed-out', `Your ${site} session has expired — sign in again on Connections.`);
      markError(r.platform, 'Session expired');
      await closeTab(r);
      scheduleNext(r, SIGNED_OUT_RETRY_MS);
      return;

    case 'challenge':
      setState(
        r,
        'blocked',
        `${site} is showing a bot check. Clear it in the Chrome window and watching resumes.`,
      );
      scheduleNext(r, RETRY_MS);
      return;

    case 'closed':
      setState(r, 'error', `The ${site} tab was closed.`);
      await closeTab(r);
      scheduleNext(r, RETRY_MS);
      return;

    default: {
      const message = detail ?? `The ${site} feed did not load.`;
      setState(r, 'error', message);
      r.lastError = message;
      // Nothing was read, so the count from an earlier look is no longer true.
      r.jobsOnFeed = 0;
      logger.warn(`[${site} alerts] ${message}`);
      markError(r.platform, message);
      scheduleNext(r, RETRY_MS);
    }
  }
}

// ── Spotting and holding ──────────────────────────────────

/**
 * What identifies a job across reloads: the platform's own job id when the URL
 * has one. The same Upwork job can arrive with the tile's slugged URL on one
 * reload and a bare `/jobs/~02…` one on the next, depending on which reader
 * found it; a LinkedIn job's URL picks up tracking parameters.
 */
function alertKey(platform: WatchedPlatform, lead: RawLead): string {
  const url = lead.url ?? '';
  const id =
    platform === 'linkedin' ? url.match(/\/jobs\/view\/(\d+)/)?.[1] : url.match(/~0[0-9a-z]{6,}/i)?.[0];
  return id ? id.toLowerCase() : url || lead.title;
}

/**
 * Queue every job on the feed we have not seen before.
 *
 * On the very first read of a tab that is nearly all of them, and alerting on
 * the lot would mean a restart dumps a day of old listings on you. So the
 * seeding pass only lets through jobs from the last 30 minutes that are not
 * already on file.
 *
 * @returns how many were queued.
 */
function queueNew(r: WatcherRuntime, leads: RawLead[]): number {
  const s = settings(r.platform);
  const maxAgeMs = Math.max(1, s.maxAgeHours) * 60 * 60 * 1000;
  const now = Date.now();
  const log = logFor(r.platform);

  let index = 0;
  for (const lead of leads) {
    if (!lead.title) continue;

    const key = alertKey(r.platform, lead);
    if (r.queue.has(key)) continue;
    if (r.baseline.has(key)) continue;
    if (isLeadKnown(r.platform, lead.url, lead.title)) continue;

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
    if (r.seeding && (!dated || age > SEED_WINDOW_MS)) {
      r.baseline.add(key);
      continue;
    }

    const wait = alertDelayMs(s.delaySeconds[0], s.delaySeconds[1]) + staggerMs(index);

    const timer = setTimeout(() => {
      void release(r, key).catch((err) =>
        logger.error(`[${SITE[r.platform]} alerts] could not release an alert`, (err as Error).message),
      );
    }, wait);
    timer.unref?.();

    r.queue.set(key, {
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
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (text) bits.push(format(text));
  };
  // Upwork's client, then LinkedIn's company. A lead only ever has one set.
  push(metadata.clientRating, (v) => `${v}★`);
  push(metadata.clientHireRate, (v) => v);
  push(metadata.clientSpent, (v) => `${v} spent`);
  push(metadata.paymentVerified, (v) => v);
  push(metadata.clientCountry, (v) => v);
  push(metadata.company, (v) => v);
  push(metadata.location, (v) => v);
  push(metadata.applicants, (v) => v);
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
 * filter here: the feed being watched is already the user's own job search,
 * tuned to them, so a second screen only loses jobs and spends Gemini quota.
 */
async function release(r: WatcherRuntime, key: string): Promise<void> {
  const item = r.queue.get(key);
  if (!item) return;
  r.queue.delete(key);
  clearTimeout(item.timer);

  const config = getConfig();
  const site = SITE[r.platform];
  const log = logFor(r.platform);
  const lead: RawLead = { ...item.lead };
  const short = item.title.slice(0, 60);

  if (settings(r.platform).fetchDetails && item.url) {
    const extra = await withTab(r, async () => {
      const tab = r.tab;
      if (!tab?.isOpen() || !tab.inspect) return null;
      return tab.inspect(item.url as string).catch(() => null);
    }).catch(() => null);
    if (extra) {
      // A job's own page has the real description; the tile only a summary.
      const { description, ...facts } = extra;
      if (typeof description === 'string' && description.trim()) lead.description = description;
      lead.metadata = { ...(lead.metadata ?? {}), ...facts };
    }
  }

  const { inserted } = insertLeads([lead]);
  if (!inserted.length) {
    log(`"${short}" was already on file — not alerting twice`);
    return;
  }

  const job = inserted[0];

  const opportunity = recordOpportunity({
    platform: r.platform,
    lead: job,
    spottedAt: item.spottedAt,
    heldForSeconds: (Date.now() - new Date(item.spottedAt).getTime()) / 1000,
    client: clientLine(job.metadata),
  });

  r.alerts += 1;
  log(`new opportunity: "${short}"`);

  if (!config.newLeadsNotification) return;

  // What decides whether to open it, on one line: the pay and the competition.
  const facts = [
    opportunity.budget,
    opportunity.proposals ? `${opportunity.proposals} proposals` : '',
    typeof job.metadata.applicants === 'string' ? job.metadata.applicants : '',
  ].filter(Boolean);
  const factLine = facts.length ? `\n${facts.join(' · ')}` : '';

  createNotification({
    type: 'opportunity',
    title: `New ${site} opportunity`,
    message: `${opportunity.title}${factLine}`,
    leadId: job.id,
  });

  if (config.discordWebhookUrl) {
    const link = opportunity.url ? `\n${opportunity.url}` : '';
    await postToDiscord(
      config.discordWebhookUrl,
      `**New ${site} opportunity**\n${opportunity.title}${factLine}${link}`,
    ).catch((err) => logger.warn('Discord webhook failed', (err as Error).message));
  }
}

// ── Lifecycle ─────────────────────────────────────────────

/**
 * Start watching one platform.
 *
 * The first look is not immediate. A tab that reloads the instant the server
 * boots, every single time the server boots, is a pattern of its own — and it
 * is also the moment the machine is busiest.
 */
export function startWatcher(platform: WatchedPlatform, reason = 'startup'): WatcherStatus {
  const r = rt(platform);
  const site = SITE[platform];

  if (!settings(platform).enabled) {
    setState(r, 'off', `${site} job alerts are switched off in your config.`);
    return watcherStatus(platform);
  }
  if (r.timer || r.state === 'checking' || r.state === 'starting') {
    return watcherStatus(platform);
  }

  r.stopping = false;
  r.seeding = true;
  r.baseline.clear();
  r.startedAt = new Date().toISOString();
  r.checks = 0;
  r.alerts = 0;
  r.lastError = null;

  const first = 5_000 + Math.random() * 25_000;
  setState(r, 'starting', `Opening the ${site} tab…`);
  scheduleNext(r, first);
  logFor(platform)(`watching started (${reason}) — first look in ${Math.round(first / 1000)}s`);

  return watcherStatus(platform);
}

/** Start every watcher switched on in your config. */
export function startWatchers(reason = 'startup'): void {
  for (const platform of WATCHED_PLATFORMS) startWatcher(platform, reason);
}

/**
 * Stop watching one platform and let go of its tab.
 *
 * Queued alerts are dropped rather than flushed. They were never stored, so the
 * next run simply finds them on the feed again — and releasing a backlog the
 * instant you press Pause would defeat the pacing this module exists to impose.
 */
export async function stopWatcher(platform: WatchedPlatform, reason = 'stopped'): Promise<WatcherStatus> {
  const r = rt(platform);
  r.stopping = true;
  clearTimer(r);

  for (const item of r.queue.values()) clearTimeout(item.timer);
  const dropped = r.queue.size;
  r.queue.clear();

  await closeTab(r);

  setState(r, 'off', `Job alerts are paused (${reason}).`);
  r.startedAt = null;
  r.nextCheckAt = null;
  r.stopping = false;

  logFor(platform)(`stopped (${reason})` + (dropped ? ` — ${dropped} queued alert(s) dropped` : ''));
  return watcherStatus(platform);
}

export async function stopWatchers(reason = 'stopped'): Promise<void> {
  await Promise.all(WATCHED_PLATFORMS.map((p) => stopWatcher(p, reason)));
}

/**
 * Look now, without waiting out the interval.
 *
 * Safe to put behind a button: it is one reload of a page that is already open,
 * and the per-job delays still apply to whatever it finds.
 */
export function checkNow(platform: WatchedPlatform): WatcherStatus | null {
  const r = rt(platform);
  // Paused is a decision, not a gap. Restarting the watcher because someone
  // pressed "Check now" would override it silently; the caller says so instead.
  if (!settings(platform).enabled) return null;
  if (r.timer === null && r.state !== 'checking') return null;

  scheduleNext(r, 250);
  return watcherStatus(platform);
}

/**
 * Hand a platform's browser profile back, so a sign-in, session check or
 * scrape can have it.
 *
 * Only one process may hold a Chromium profile open, so a watcher sitting on
 * the tab makes "Sign in again" fail with a lock error. Callers are expected to
 * `resumeWatcher()` once they are done.
 */
export async function suspendWatcher(platform: string): Promise<boolean> {
  if (!isWatchedPlatform(platform)) return false;
  const r = rt(platform);
  const wasRunning = r.timer !== null || r.tab !== null;
  if (!wasRunning) return false;
  await stopWatcher(platform, 'paused for sign-in');
  return true;
}

export function resumeWatcher(platform: string, reason = 'resumed'): void {
  if (!isWatchedPlatform(platform) || !settings(platform).enabled) return;
  startWatcher(platform, reason);
}

/**
 * Apply a config change: start, stop, or leave alone as the new settings say.
 *
 * A changed feed URL counts as a change too. The tab was opened on the old
 * one, and it would otherwise keep reloading your previous search until the
 * next restart.
 */
export function syncWatchersWithConfig(): void {
  for (const platform of WATCHED_PLATFORMS) {
    const r = rt(platform);
    const s = settings(platform);
    const running = r.timer !== null || r.tab !== null;

    if (s.enabled && !running) startWatcher(platform, 'enabled in config');
    else if (!s.enabled && running) void stopWatcher(platform, 'switched off in config');
    else if (s.enabled && r.openedWith && r.openedWith !== s.feedUrl) {
      void stopWatcher(platform, 'feed URL changed').then(() =>
        startWatcher(platform, 'feed URL changed'),
      );
    }
  }
}
