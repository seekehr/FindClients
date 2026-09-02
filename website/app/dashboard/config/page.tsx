'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Loader2,
  Save,
  Target,
  Radar,
  Zap,
  X,
  Check,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Eye,
  EyeOff,
  ExternalLink,
} from 'lucide-react'
import { ApiError, configApi, type AiInfo, type ConfigPatch, type UserConfig } from '@/lib/api'

/** Where to get the key the AI section asks for. */
const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey'

/** The models the server accepts, with what each one is actually for. */
const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-pro': 'Gemini 2.5 Pro — most accurate, slowest and priciest',
  'gemini-2.5-flash': 'Gemini 2.5 Flash — recommended balance',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite — cheapest, roughest',
}

/** Platforms that have a working scraper today. */
const PLATFORM_LABELS: Record<string, string> = {
  upwork: 'Upwork',
  twitter: 'Twitter / X',
  discord: 'Discord',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
}

const SUPPORTED = new Set(['upwork', 'twitter'])

// ── Small building blocks ────────────────────────────────

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-card rounded-xl border border-border/40 p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-primary">{icon}</div>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-sm text-foreground/60">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg hover:bg-secondary/60 transition">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        {hint && <p className="text-sm text-foreground/60">{hint}</p>}
      </div>
      <label className="relative inline-flex items-center cursor-pointer shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
      </label>
    </div>
  )
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          // Clamp so the field can never submit a value the API would reject.
          const n = Number(e.target.value)
          if (Number.isNaN(n)) return
          onChange(Math.min(max, Math.max(min, Math.round(n))))
        }}
        className="w-full px-3 py-2 rounded-lg border border-border bg-secondary text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      {hint && <p className="text-xs text-foreground/50 mt-1">{hint}</p>}
    </div>
  )
}

function TextArea({
  label,
  hint,
  placeholder,
  value,
  rows = 6,
  maxLength,
  onChange,
}: {
  label: string
  hint?: string
  placeholder?: string
  value: string
  rows?: number
  maxLength?: number
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-secondary text-foreground placeholder:text-foreground/40 leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      {hint && (
        <p className="text-xs text-foreground/50 mt-1">
          {hint}
          {maxLength ? ` ${value.length}/${maxLength}.` : ''}
        </p>
      )}
    </div>
  )
}

/** Free-form list of short strings, entered as chips. */
function ChipInput({
  label,
  hint,
  placeholder,
  values,
  onChange,
  tone = 'primary',
}: {
  label: string
  hint?: string
  placeholder: string
  values: string[]
  onChange: (v: string[]) => void
  tone?: 'primary' | 'destructive'
}) {
  const [draft, setDraft] = useState('')

  function commit(raw: string) {
    // Accept comma-separated pastes as well as one-at-a-time entry.
    const added = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s.length <= 80)
    if (!added.length) return
    const next = [...values]
    for (const item of added) {
      if (!next.some((v) => v.toLowerCase() === item.toLowerCase())) next.push(item)
    }
    onChange(next.slice(0, 50))
    setDraft('')
  }

  const chipClass =
    tone === 'destructive'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-primary/10 text-primary'

  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {values.map((v) => (
            <span
              key={v}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${chipClass}`}
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="hover:opacity-60"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1))
          }
        }}
        onBlur={() => commit(draft)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-secondary text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      <p className="text-xs text-foreground/50 mt-1">
        {hint ? `${hint} ` : ''}Press Enter or comma to add. {values.length}/50.
      </p>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────

export default function ConfigPage() {
  const [config, setConfig] = useState<UserConfig | null>(null)
  const [platforms, setPlatforms] = useState<string[]>([])
  const [ai, setAi] = useState<AiInfo>({ available: false, models: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // The API key is held apart from `config` because it only ever travels one
  // way: the server sends back a masked hint, never the key, so it cannot be
  // an editable field on the config object like everything else here.
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  /** The user asked to forget the stored key — applied on the next save. */
  const [clearApiKey, setClearApiKey] = useState(false)

  // The last version persisted on the server, so we can diff and reset.
  const baseline = useRef<UserConfig | null>(null)

  useEffect(() => {
    configApi
      .get()
      .then(({ config, platforms, ai }) => {
        setConfig(config)
        baseline.current = config
        setPlatforms(platforms)
        setAi(ai)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your config'))
      .finally(() => setLoading(false))
  }, [])

  function patch(changes: Partial<UserConfig>) {
    setSaved(false)
    setConfig((prev) => (prev ? { ...prev, ...changes } : prev))
  }

  const keyDirty = apiKeyDraft.trim() !== '' || clearApiKey
  const dirty =
    !!config &&
    !!baseline.current &&
    (JSON.stringify(config) !== JSON.stringify(baseline.current) || keyDirty)

  async function save() {
    if (!config) return
    setSaving(true)
    setError('')
    try {
      // aiApiKeySet / aiApiKeyHint are server-derived views of the stored key,
      // so they are dropped rather than sent back.
      const { updatedAt, aiApiKeySet, aiApiKeyHint, ...body } = config
      const patch: ConfigPatch = { ...body }
      if (apiKeyDraft.trim()) patch.aiApiKey = apiKeyDraft.trim()
      else if (clearApiKey) patch.aiApiKey = ''

      const { config: fresh } = await configApi.update(patch)
      setConfig(fresh)
      baseline.current = fresh
      setApiKeyDraft('')
      setClearApiKey(false)
      setShowApiKey(false)
      setAi((prev) => ({ ...prev, available: fresh.aiApiKeySet }))
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your config')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    if (baseline.current) setConfig(baseline.current)
    setApiKeyDraft('')
    setClearApiKey(false)
    setShowApiKey(false)
    setSaved(false)
    setError('')
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-24 text-foreground/50">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading your configuration…
        </div>
      </DashboardLayout>
    )
  }

  if (!config) {
    return (
      <DashboardLayout>
        <div className="p-6 max-w-2xl">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error || 'Could not load your configuration.'}
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="p-6 pb-28 space-y-6 max-w-3xl">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Config</h1>
          <p className="text-foreground/60">
            Everything here is stored on your account and drives the next scrape cycle.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Lead targeting */}
        <Section
          icon={<Target className="w-5 h-5" />}
          title="Lead targeting"
          description="Which opportunities count as a lead for you."
        >
          <div>
            <label className="block text-sm font-medium mb-2">Platforms to monitor</label>
            <div className="grid sm:grid-cols-2 gap-2">
              {platforms.map((p) => {
                const on = config.platforms.includes(p)
                const supported = SUPPORTED.has(p)
                return (
                  <label
                    key={p}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition cursor-pointer ${
                      on ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:bg-secondary/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        patch({
                          platforms: e.target.checked
                            ? [...config.platforms, p]
                            : config.platforms.filter((x) => x !== p),
                        })
                      }
                      className="w-4 h-4 rounded border-border"
                    />
                    <span className="font-medium">{PLATFORM_LABELS[p] ?? p}</span>
                    {!supported && (
                      <span className="ml-auto text-xs text-foreground/40">no scraper yet</span>
                    )}
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-foreground/50 mt-1">
              A platform still needs a connected account on the Connections page.
            </p>
          </div>

          <ChipInput
            label="Keywords"
            hint="A lead must match at least one. Leave empty to match everything."
            placeholder="looking for a developer"
            values={config.keywords}
            onChange={(keywords) => patch({ keywords })}
          />

          <ChipInput
            label="Excluded keywords"
            hint="A lead containing any of these is dropped."
            placeholder="unpaid, internship"
            values={config.excludedKeywords}
            onChange={(excludedKeywords) => patch({ excludedKeywords })}
            tone="destructive"
          />

          <NumberField
            label="Minimum budget"
            hint="0 disables the filter. Leads with no stated budget are always kept."
            value={config.minBudget}
            min={0}
            max={1_000_000}
            onChange={(minBudget) => patch({ minBudget })}
          />
        </Section>

        {/* Scraping */}
        <Section
          icon={<Radar className="w-5 h-5" />}
          title="Scraping"
          description="How hard the scrapers work on your behalf."
        >
          <Toggle
            label="Scraping enabled"
            hint="Turn off to pause all scraping for your account."
            checked={config.scrapeEnabled}
            onChange={(scrapeEnabled) => patch({ scrapeEnabled })}
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <NumberField
              label="Leads per run"
              hint="Soft cap per platform, per cycle (1–100)."
              value={config.leadsPerRun}
              min={1}
              max={100}
              onChange={(leadsPerRun) => patch({ leadsPerRun })}
            />
            <NumberField
              label="Max post age (hours)"
              hint="Ignore posts older than this."
              value={config.maxPostAgeHours}
              min={1}
              max={720}
              onChange={(maxPostAgeHours) => patch({ maxPostAgeHours })}
            />
          </div>
        </Section>

        {/* Platform tuning */}
        <Section
          icon={<Zap className="w-5 h-5" />}
          title="Platform tuning"
          description="Per-platform knobs. The defaults are sensible — change them if results are too noisy or too sparse."
        >
          <div className="space-y-4">
            <p className="text-sm font-semibold text-foreground/80">Twitter / X</p>
            <div className="grid sm:grid-cols-3 gap-4">
              <NumberField
                label="Min likes"
                value={config.twitterMinLikes}
                min={0}
                max={1_000_000}
                onChange={(twitterMinLikes) => patch({ twitterMinLikes })}
              />
              <NumberField
                label="Min views"
                value={config.twitterMinViews}
                min={0}
                max={100_000_000}
                onChange={(twitterMinViews) => patch({ twitterMinViews })}
              />
              <NumberField
                label="Per keyword"
                hint="Tweets to collect per search term."
                value={config.twitterLimitPerKeyword}
                min={1}
                max={100}
                onChange={(twitterLimitPerKeyword) => patch({ twitterLimitPerKeyword })}
              />
            </div>
          </div>

          <div className="space-y-4 pt-2">
            <p className="text-sm font-semibold text-foreground/80">Upwork</p>
            <div>
              <label className="block text-sm font-medium mb-1">Jobs feed URL</label>
              <input
                type="url"
                value={config.upworkJobsUrl}
                onChange={(e) => patch({ upworkJobsUrl: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-secondary text-foreground font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-foreground/50 mt-1">
                Paste any Upwork search URL to scrape that feed instead of "most recent".
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <NumberField
                label="Max job age (hours)"
                value={config.upworkMaxAgeHours}
                min={1}
                max={720}
                onChange={(upworkMaxAgeHours) => patch({ upworkMaxAgeHours })}
              />
              <div className="flex items-end">
                <div className="w-full">
                  <Toggle
                    label="Fetch job details"
                    hint="Slower, but adds client rating and hire rate."
                    checked={config.upworkFetchDetails}
                    onChange={(upworkFetchDetails) => patch({ upworkFetchDetails })}
                  />
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* AI qualification */}
        <Section
          icon={<Sparkles className="w-5 h-5" />}
          title="AI qualification"
          description="Have Gemini read every scraped lead and judge it against your own criteria, before it reaches your inbox."
        >
          {/* The key comes first: nothing else in this section works without it. */}
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="gemini-api-key">
              Gemini API key
            </label>

            {config.aiApiKeySet && !clearApiKey && !apiKeyDraft && (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <span className="text-sm text-foreground/70">
                  A key is saved{' '}
                  <span className="font-mono text-foreground/50">{config.aiApiKeyHint}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setClearApiKey(true)
                    setSaved(false)
                  }}
                  className="text-sm font-medium text-destructive hover:opacity-70"
                >
                  Remove
                </button>
              </div>
            )}

            {clearApiKey && (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
                <span className="text-sm text-destructive">
                  Your key will be deleted when you save.
                </span>
                <button
                  type="button"
                  onClick={() => setClearApiKey(false)}
                  className="text-sm font-medium hover:opacity-70"
                >
                  Undo
                </button>
              </div>
            )}

            <div className="relative">
              <input
                id="gemini-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyDraft}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  config.aiApiKeySet && !clearApiKey ? 'Enter a new key to replace it' : 'AIza…'
                }
                onChange={(e) => {
                  setApiKeyDraft(e.target.value)
                  setSaved(false)
                }}
                className="w-full pl-3 pr-11 py-2 rounded-lg border border-border bg-secondary text-foreground placeholder:text-foreground/40 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="button"
                aria-label={showApiKey ? 'Hide the key' : 'Show the key'}
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-foreground/40 hover:text-foreground/70"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <p className="text-xs text-foreground/50 mt-1">
              Your own key — reviews are billed to your Google account, not ours. Stored encrypted
              and never shown again after you save.{' '}
              <a
                href={GEMINI_KEY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                Get a key <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          <Toggle
            label="Qualify leads with AI"
            hint="Off means every scraped lead reaches you unjudged."
            checked={config.aiEnabled}
            onChange={(aiEnabled) => patch({ aiEnabled })}
          />

          {config.aiEnabled && !ai.available && !apiKeyDraft && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
              Qualification is on but no Gemini key is saved, so it will be skipped on every
              scrape. Add your key above.
            </div>
          )}

          <TextArea
            label="What counts as a qualified lead"
            hint="Written in your own words — this is the only description of your ideal client the model gets. Be specific about the work you take and what you always reject."
            placeholder="I build Shopify stores for small brands. Qualified: the poster is hiring, the work is Shopify or front-end, and the budget is at least $500. Reject: agencies recruiting, unpaid or revenue-share offers, and anyone advertising their own services."
            value={config.aiPrompt}
            rows={7}
            maxLength={4000}
            onChange={(aiPrompt) => patch({ aiPrompt })}
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <select
                value={config.aiModel}
                onChange={(e) => patch({ aiModel: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-secondary text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {ai.models.map((m) => (
                  <option key={m} value={m}>
                    {MODEL_LABELS[m] ?? m}
                  </option>
                ))}
              </select>
              <p className="text-xs text-foreground/50 mt-1">
                One call per lead, charged to your key.
              </p>
            </div>

            <NumberField
              label="Minimum score"
              hint="Leads scoring below this (0–100) are rejected."
              value={config.aiMinScore}
              min={0}
              max={100}
              onChange={(aiMinScore) => patch({ aiMinScore })}
            />
          </div>

          <Toggle
            label="Archive rejected leads"
            hint="Keeps your inbox to what passed. Rejected leads stay searchable under the Archived filter."
            checked={config.aiAutoArchive}
            onChange={(aiAutoArchive) => patch({ aiAutoArchive })}
          />
        </Section>

        {/* Notifications */}
        <Section
          icon={<Bell className="w-5 h-5" />}
          title="Notifications"
          description="How you hear about a match."
        >
          <Toggle
            label="New leads"
            hint="Notify me when a lead matches the filters above."
            checked={config.newLeadsNotification}
            onChange={(newLeadsNotification) => patch({ newLeadsNotification })}
          />
          <Toggle
            label="Email notifications"
            checked={config.emailNotifications}
            onChange={(emailNotifications) => patch({ emailNotifications })}
          />
          <Toggle
            label="Push notifications"
            checked={config.pushNotifications}
            onChange={(pushNotifications) => patch({ pushNotifications })}
          />

          <div>
            <label className="block text-sm font-medium mb-1">Discord webhook</label>
            <input
              type="url"
              value={config.discordWebhookUrl}
              placeholder="https://discord.com/api/webhooks/…"
              onChange={(e) => patch({ discordWebhookUrl: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-secondary text-foreground placeholder:text-foreground/40 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-foreground/50 mt-1">
              Optional. Matching leads get posted here as they are found.
            </p>
          </div>
        </Section>

        <p className="text-xs text-foreground/40">
          Last saved {new Date(config.updatedAt).toLocaleString()}.
        </p>
      </div>

      {/* Sticky save bar — the page is long, so the action follows you down it. */}
      <div className="sticky bottom-0 border-t border-border/40 bg-card/95 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
        <div className="flex-1 text-sm">
          {dirty && (
            <span className="inline-flex items-center gap-1.5 text-foreground/60">
              <AlertTriangle className="w-4 h-4" /> Unsaved changes
            </span>
          )}
          {!dirty && saved && (
            <span className="inline-flex items-center gap-1.5 text-emerald-500 font-medium">
              <Check className="w-4 h-4" /> Saved
            </span>
          )}
        </div>

        {dirty && (
          <Button variant="ghost" onClick={reset} disabled={saving} className="gap-2">
            <RotateCcw className="w-4 h-4" /> Reset
          </Button>
        )}
        <Button onClick={save} disabled={saving || !dirty} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </DashboardLayout>
  )
}
