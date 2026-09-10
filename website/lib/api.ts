// API client for the FindClients backend.
//
// There is no authentication. The server runs on your machine, bound to
// localhost, and serves this page — so a request from here is already coming
// from the only person allowed to make it. When the app is started with
// `npm start` the site and the API share one origin and one port, which is why
// the default base URL is a bare `/api`.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Is the app running?`)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText)
  }
  return data as T
}

// ── Types ─────────────────────────────────────────────────
export type LeadStatus = 'new' | 'viewed' | 'contacted' | 'won' | 'archived'

/** Platform-specific extras a scraper collected (client hire rate, views, …). */
export type LeadMetadata = Record<string, string | number | boolean | null>

export interface LeadAiReview {
  verdict: 'qualified' | 'rejected' | 'error' | null
  score: number | null
  reason: string
  model: string
  checkedAt: string | null
}

export interface Lead {
  id: string
  title: string
  platform: string
  description: string
  budget: string | null
  timeline: string | null
  url: string | null
  author: string | null
  tags: string[]
  metadata: LeadMetadata
  postedAt: string
  postedTime: string
  status: LeadStatus
  bookmarked: boolean
  ai: LeadAiReview
  createdAt: string
}

export interface Paginated<T> {
  data: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export interface Connection {
  platform: string
  /** 'connected' | 'expired' | 'error' | 'disconnected' */
  status: string
  connectedAt: string | null
  lastUsedAt: string | null
  lastError: string | null
}

/** A sign-in window currently open on the machine running the server. */
export interface SignInState {
  platform: string
  status: 'waiting' | 'done' | 'failed'
  message: string
  startedAt: string
}

export interface SessionCheck {
  hasProfile: boolean
  signedIn: boolean
  detail?: string
}

/** Mirrors AppConfig on the server (data/config.json). */
export interface UserConfig {
  newLeadsNotification: boolean
  discordWebhookUrl: string

  platforms: string[]
  keywords: string[]
  excludedKeywords: string[]
  minBudget: number

  scrapeEnabled: boolean
  leadsPerRun: number
  maxPostAgeHours: number

  twitterMinLikes: number
  twitterMinViews: number
  twitterLimitPerKeyword: number

  /** Upwork is watched for job alerts, never scraped. See `watchApi`. */
  upworkWatchEnabled: boolean
  upworkJobsUrl: string
  upworkFetchDetails: boolean
  upworkMaxAgeHours: number
  upworkReloadMinMinutes: number
  upworkReloadMaxMinutes: number
  upworkAlertDelayMinSeconds: number
  upworkAlertDelayMaxSeconds: number

  aiEnabled: boolean
  aiPrompt: string
  aiModel: string
  aiMinScore: number
  aiAutoArchive: boolean
  /** Whether a Gemini key is saved. The key itself never leaves the server. */
  aiApiKeySet: boolean
  /** Masked tail of the saved key ("••••aB3d"), or '' when there is none. */
  aiApiKeyHint: string

  updatedAt: string
}

/**
 * What GET /api/config says about qualification beyond the saved settings:
 * `available` is false until a Gemini API key is saved.
 */
export interface AiInfo {
  available: boolean
  models: string[]
}

/**
 * A config save. `aiApiKey` is write-only — there is no matching field on
 * `UserConfig` because the server never sends a key back. Send '' to clear it.
 */
export type ConfigPatch = Partial<
  Omit<UserConfig, 'updatedAt' | 'aiApiKeySet' | 'aiApiKeyHint'>
> & { aiApiKey?: string }

export interface ScrapeRun {
  id: string
  platform: string
  status: string
  found: number
  inserted: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

/** Whether the browser the scrapers drive is actually available. */
export interface BrowserStatus {
  /** 'attached' = a Chrome you started; 'own' = one FindClients launches. */
  mode: 'attached' | 'own'
  url: string
  reachable: boolean
  hint: string
}

export interface ScrapeStatus {
  running: boolean
  runs: { id: string; platform: string; startedAt: string }[]
  lastFinishedAt: string | null
  browser?: BrowserStatus
}

export interface Notification {
  id: string
  type: string
  title: string
  message: string
  leadId: string | null
  read: boolean
  createdAt: string
}

/**
 * One Upwork job alert, as shown in the New Opportunities panel.
 *
 * A snapshot, not a pointer: the panel stays readable after the lead behind it
 * has been archived or cleared. `leadId` links back when there still is one.
 */
export interface Opportunity {
  id: string
  platform: string
  leadId: string | null
  title: string
  url: string | null
  budget: string | null
  /** "4.9★ · 92% hire rate · $40k spent · United States", when known. */
  client: string
  tags: string[]
  postedAt: string
  postedTime: string
  /** When the watcher first saw it on the feed. */
  spottedAt: string
  /** When it was released to you, after its human delay. */
  alertedAt: string
  alertedTime: string
  /** How long it was deliberately held back. */
  heldForSeconds: number
  /** 'skipped': went out unreviewed because Gemini's rate limit was reached. */
  verdict: 'qualified' | 'rejected' | 'error' | 'skipped' | null
  score: number | null
  seen: boolean
}

/** What the watcher is doing right now. */
export type WatchState =
  | 'off'
  | 'starting'
  | 'watching'
  | 'checking'
  | 'blocked'
  | 'signed-out'
  | 'browser-down'
  | 'error'

/** A job spotted on the feed and still waiting out its delay. */
export interface QueuedAlert {
  id: string
  title: string
  dueAt: string
  dueInSeconds: number
}

export interface WatcherStatus {
  platform: string
  name: string
  /** Job alerts are switched on in your config. */
  enabled: boolean
  /** The loop is alive right now. */
  running: boolean
  state: WatchState
  /** One sentence, in plain words, for the UI to show as-is. */
  detail: string
  feedUrl: string
  startedAt: string | null
  lastCheckedAt: string | null
  nextCheckAt: string | null
  jobsOnFeed: number
  checks: number
  alerts: number
  queued: QueuedAlert[]
  lastError: string | null
  /** [shortest, longest] gap between reloads, in minutes. */
  reloadMinutes: [number, number]
  /** [shortest, longest] hold before an alert reaches you, in seconds. */
  delaySeconds: [number, number]
}

// ── Endpoint helpers ──────────────────────────────────────
export const configApi = {
  get: () => api<{ config: UserConfig; platforms: string[]; ai: AiInfo }>('/config'),
  update: (patch: ConfigPatch) =>
    api<{ config: UserConfig }>('/config', { method: 'PUT', body: patch }),
  reset: () => api<{ config: UserConfig }>('/config/reset', { method: 'POST' }),
}

export const leadsApi = {
  list: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
    const qs = q.toString()
    return api<Paginated<Lead>>(`/leads${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => api<{ lead: Lead }>(`/leads/${id}`),
  setStatus: (id: string, status: LeadStatus) =>
    api<{ ok: boolean; status: LeadStatus }>(`/leads/${id}`, { method: 'PATCH', body: { status } }),
  bookmark: (id: string, on: boolean) =>
    api(`/leads/${id}/bookmark`, { method: on ? 'PUT' : 'DELETE' }),
  clear: () => api<{ ok: boolean; removed: number }>('/leads', { method: 'DELETE' }),
}

export const bookmarksApi = {
  list: (params: { page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v))
    const qs = q.toString()
    return api<Paginated<Lead>>(`/bookmarks${qs ? `?${qs}` : ''}`)
  },
}

export const connectionsApi = {
  list: () =>
    api<{
      platforms: string[]
      connections: Connection[]
      signIn: SignInState | null
      browser: BrowserStatus
      watcher: WatcherStatus
    }>('/connections'),
  /**
   * Opens a real browser window on the machine running the server and returns
   * straight away — signing in takes as long as it takes. Poll `list()` and
   * watch `signIn.status` to follow it.
   */
  signIn: (platform: string) =>
    api<{ ok: boolean; signIn: SignInState }>(`/connections/${platform}/sign-in`, {
      method: 'POST',
    }),
  check: (platform: string) =>
    api<{ session: SessionCheck; connections: Connection[] }>(`/connections/${platform}/check`, {
      method: 'POST',
    }),
  disconnect: (platform: string) =>
    api<{ ok: boolean; connections: Connection[] }>(`/connections/${platform}`, {
      method: 'DELETE',
    }),
}

export const analyticsApi = {
  overview: () =>
    api<{
      newLeads: number
      totalLeads: number
      bookmarked: number
      contacted: number
      won: number
      conversionRate: number
      last7d: number
    }>('/analytics/overview'),
  platforms: () =>
    api<{ data: { platform: string; count: number; percentage: number }[] }>('/analytics/platforms'),
  trend: (days = 14) =>
    api<{ data: { date: string; count: number }[] }>(`/analytics/trend?days=${days}`),
  scrapeRuns: () => api<{ data: ScrapeRun[] }>('/analytics/scrape-runs'),
}

export const notificationsApi = {
  list: (unreadOnly = false) =>
    api<{ data: Notification[]; unread: number }>(
      `/notifications${unreadOnly ? '?unread=true' : ''}`,
    ),
  markRead: (id: string) => api<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => api<{ ok: boolean }>('/notifications/read-all', { method: 'POST' }),
}

/**
 * The Upwork job watcher.
 *
 * There is no "collect" call here and there will not be one. `check()` reloads
 * the single tab the watcher already has open — the same thing pressing F5
 * does — and everything it finds still waits out its random delay before it
 * reaches the panel.
 */
export const watchApi = {
  status: () => api<{ watcher: WatcherStatus; browser: BrowserStatus }>('/watch'),
  start: () => api<{ watcher: WatcherStatus }>('/watch/start', { method: 'POST' }),
  stop: () => api<{ watcher: WatcherStatus }>('/watch/stop', { method: 'POST' }),
  check: () => api<{ watcher: WatcherStatus }>('/watch/check', { method: 'POST' }),
}

export const opportunitiesApi = {
  /**
   * The main feed, or with `rejected` the jobs the AI turned down. `total` and
   * `unseen` count the main feed only; `rejected` counts the other list.
   */
  list: (params: { unseen?: boolean; rejected?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.unseen) q.set('unseen', 'true')
    if (params.rejected) q.set('rejected', 'true')
    if (params.limit !== undefined) q.set('limit', String(params.limit))
    const qs = q.toString()
    return api<{ data: Opportunity[]; total: number; rejected: number; unseen: number }>(
      `/opportunities${qs ? `?${qs}` : ''}`,
    )
  },
  markSeen: (id: string) => api<{ ok: boolean }>(`/opportunities/${id}/seen`, { method: 'POST' }),
  markAllSeen: () => api<{ ok: boolean; marked: number }>('/opportunities/seen', { method: 'POST' }),
  /** Empties the panel. The leads behind the alerts are left alone. */
  clear: () => api<{ ok: boolean; removed: number }>('/opportunities', { method: 'DELETE' }),
}

export const scrapeApi = {
  run: () => api<{ ok: boolean; started: boolean }>('/scrape/run', { method: 'POST' }),
  status: () => api<ScrapeStatus>('/scrape/status'),
  runs: () => api<{ data: ScrapeRun[] }>('/scrape/runs'),
}
