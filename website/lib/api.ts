// Lightweight API client for the FindClients backend.
//
// Authentication is Supabase Auth, brokered by the API server: /auth/login and
// /auth/register return a Supabase access token (short-lived) plus a refresh
// token. `api()` transparently refreshes an expired access token once and
// replays the request, so callers never have to think about token lifetime.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

const TOKEN_KEY = 'fc_token'
const REFRESH_KEY = 'fc_refresh'
const USER_KEY = 'fc_user'

export interface SessionUser {
  id: string
  email: string
  fullName: string
  plan: string
}

export interface AuthResponse {
  user: SessionUser
  token?: string
  refreshToken?: string
  expiresAt?: number | null
  needsEmailConfirmation?: boolean
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY)
}

export function getStoredUser(): SessionUser | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionUser
  } catch {
    return null
  }
}

export function setSession(auth: AuthResponse) {
  if (auth.token) localStorage.setItem(TOKEN_KEY, auth.token)
  if (auth.refreshToken) localStorage.setItem(REFRESH_KEY, auth.refreshToken)
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user))
}

export function setStoredUser(user: SessionUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
}

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
  /** Internal: set when replaying a request after a token refresh. */
  _retried?: boolean
}

/** In-flight refresh, shared so concurrent 401s trigger only one round trip. */
let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshToken = getRefreshToken()
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        })
        if (!res.ok) return false
        const data = (await res.json()) as AuthResponse
        setSession(data)
        return true
      } catch {
        return false
      } finally {
        setTimeout(() => (refreshInFlight = null), 0)
      }
    })()
  }
  return refreshInFlight
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Is the server running?`)
  }

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    if (res.status === 401 && !opts._retried) {
      if (await refreshAccessToken()) {
        return api<T>(path, { ...opts, _retried: true })
      }
    }
    if (res.status === 401) clearSession()
    throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText)
  }

  return data as T
}

// ── Types ─────────────────────────────────────────────────
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
  postedAt: string
  postedTime: string
  status: string
  bookmarked: boolean
}

export interface Paginated<T> {
  data: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export interface Connection {
  platform: string
  status: string
  cookieCount: number
  connectedAt: string
  updatedAt: string
  lastUsedAt: string | null
  lastError: string | null
}

/** Mirrors UserConfig on the server (public.user_config). */
export interface UserConfig {
  emailNotifications: boolean
  pushNotifications: boolean
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

  upworkJobsUrl: string
  upworkFetchDetails: boolean
  upworkMaxAgeHours: number

  aiEnabled: boolean
  aiPrompt: string
  aiModel: string
  aiMinScore: number
  aiAutoArchive: boolean
  /** Whether a Gemini key is stored. The key itself never leaves the server. */
  aiApiKeySet: boolean
  /** Masked tail of the stored key ("••••aB3d"), or '' when there is none. */
  aiApiKeyHint: string

  updatedAt: string
}

/**
 * What GET /api/config says about qualification beyond the saved settings:
 * `available` is false until the user saves their own Gemini API key.
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

// ── Endpoint helpers ──────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } }),

  register: (email: string, password: string, fullName: string) =>
    api<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { email, password, fullName },
    }),

  me: () => api<{ user: SessionUser }>('/auth/me'),

  updateProfile: (patch: { fullName?: string; email?: string }) =>
    api<{ user: SessionUser }>('/auth/me', { method: 'PATCH', body: patch }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: boolean }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  logout: () => api<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  deleteAccount: () => api<{ ok: boolean }>('/auth/me', { method: 'DELETE' }),
}

export const configApi = {
  get: () => api<{ config: UserConfig; platforms: string[]; ai: AiInfo }>('/config'),
  update: (patch: ConfigPatch) =>
    api<{ config: UserConfig }>('/config', { method: 'PUT', body: patch }),
}

export type LeadStatus = 'new' | 'viewed' | 'contacted' | 'won' | 'archived'

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

export const credentialsApi = {
  list: () => api<{ platforms: string[]; connections: Connection[] }>('/credentials'),
  connect: (platform: string, cookies: string) =>
    api<{ connection: Connection }>(`/credentials/${platform}`, { method: 'PUT', body: { cookies } }),
  disconnect: (platform: string) => api(`/credentials/${platform}`, { method: 'DELETE' }),
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
  trend: (days = 14) => api<{ data: { date: string; count: number }[] }>(`/analytics/trend?days=${days}`),
  scrapeRuns: () => api<{ data: ScrapeRun[] }>('/analytics/scrape-runs'),
}

export interface ScrapeStatus {
  running: boolean
  runs: { id: string; platform: string; startedAt: string }[]
  lastFinishedAt: string | null
}

export interface CaptchaChallenge {
  sessionId: string
  platform: string
  screenshot: string
  width: number
  height: number
  createdAt: number
}

export const scrapeApi = {
  run: () => api<{ ok: boolean; summary: unknown }>('/scrape/run', { method: 'POST' }),
  status: () => api<ScrapeStatus>('/scrape/status'),
  captcha: () => api<{ challenge: CaptchaChallenge | null }>('/scrape/captcha'),
  captchaClick: (sessionId: string, x: number, y: number) =>
    api<{ screenshot: string; solved: boolean }>('/scrape/captcha/click', {
      method: 'POST',
      body: { sessionId, x, y },
    }),
  captchaDismiss: (sessionId: string) =>
    api<{ ok: boolean }>('/scrape/captcha/dismiss', { method: 'POST', body: { sessionId } }),
}
