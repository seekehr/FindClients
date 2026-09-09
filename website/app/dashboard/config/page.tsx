'use client'

import {
  Bell,
  Check,
  Cpu,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  Radar,
  Radio,
  RotateCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import DashboardLayout from '@/components/dashboard-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, LoadingRow } from '@/components/ui/feedback'
import {
  Field,
  Hint,
  Input,
  Label,
  NumberField,
  Select,
  Textarea,
} from '@/components/ui/field'
import { PageHeader, PageShell } from '@/components/ui/page'
import { SwitchRow } from '@/components/ui/switch'
import {
  ApiError,
  configApi,
  type AiInfo,
  type ConfigPatch,
  type UserConfig,
} from '@/lib/api'
import { isWatchedPlatform, platformLabel, SUPPORTED_PLATFORMS } from '@/lib/platforms'
import { cn } from '@/lib/utils'

/** Where to get the key the AI section asks for. */
const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey'

/** The models the server accepts, with what each one is actually for. */
const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-pro': 'Gemini 2.5 Pro — most accurate, slowest and priciest',
  'gemini-2.5-flash': 'Gemini 2.5 Flash — recommended balance',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite — cheapest, roughest',
}

// ── Small building blocks ────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="items-center">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised">
            <Icon className="size-4 text-muted-foreground" />
          </span>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  )
}

/** Free-form list of short strings, entered as chips. */
function ChipInput({
  label,
  hint,
  placeholder,
  values,
  onChange,
  tone = 'gold',
}: {
  label: string
  hint?: string
  placeholder: string
  values: string[]
  onChange: (values: string[]) => void
  tone?: 'gold' | 'danger'
}) {
  const [draft, setDraft] = useState('')
  const id = useId()

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

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} tone={tone} className="pr-1">
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="-mr-0.5 flex size-4 items-center justify-center rounded-xs opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Input
        id={id}
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
      />
      <Hint>
        {hint ? `${hint} ` : ''}Press Enter or comma to add. {values.length} of 50
        used.
      </Hint>
    </div>
  )
}

/** A labelled group inside a section, for per-platform knobs. */
function SubGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4 border-t border-border pt-5 first:border-0 first:pt-0">
      <p className="text-[0.6875rem] leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </p>
      {children}
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
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : 'Could not load your config',
        ),
      )
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
      setError(
        err instanceof ApiError ? err.message : 'Could not save your config',
      )
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
        <PageShell width="narrow">
          <LoadingRow label="Loading your configuration" />
        </PageShell>
      </DashboardLayout>
    )
  }

  if (!config) {
    return (
      <DashboardLayout>
        <PageShell width="narrow" className="space-y-6">
          <PageHeader
            title="Config"
            description="What counts as a lead, how hard the scrapers work, and who hears about a match."
          />
          <Alert
            tone="danger"
            title={error || 'Could not load your configuration.'}
          />
        </PageShell>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <PageShell width="narrow" className="space-y-6 pb-6">
        <PageHeader
          title="Config"
          description="What counts as a lead, how the Upwork watcher paces itself, and who hears about a match. Saved to data/config.json and applied immediately."
        />

        {error && <Alert tone="danger" title={error} />}

        <Section
          icon={Crosshair}
          title="Lead targeting"
          description="Which opportunities count as a lead for you."
        >
          <div className="space-y-2">
            <Label>Platforms to scrape</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {platforms.map((p) => {
                const on = config.platforms.includes(p)
                const supported = SUPPORTED_PLATFORMS.has(p)

                // A watched platform has no place in this list: the scrape
                // cycle cannot reach it, so a checkbox here would be a control
                // that quietly does nothing. Shown as a signpost instead.
                if (isWatchedPlatform(p)) {
                  return (
                    <div
                      key={p}
                      className="flex h-11 items-center gap-3 rounded-md border border-dashed border-border px-3"
                    >
                      <Radio
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="text-sm font-medium text-muted-foreground">
                        {platformLabel(p)}
                      </span>
                      <Badge tone="gold" className="ml-auto">
                        Job alerts, not scraped
                      </Badge>
                    </div>
                  )
                }

                return (
                  <label
                    key={p}
                    className={cn(
                      'flex h-11 cursor-pointer items-center gap-3 rounded-md border px-3 transition-colors duration-150 ease-out',
                      on
                        ? 'border-gold-500/30 bg-gold-500/8'
                        : 'border-border hover:bg-secondary/60',
                    )}
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
                      className="size-4 rounded-xs accent-[var(--gold-500)]"
                    />
                    <span className="text-sm font-medium">
                      {platformLabel(p)}
                    </span>
                    {!supported && (
                      <Badge tone="outline" className="ml-auto">
                        No scraper yet
                      </Badge>
                    )}
                  </label>
                )
              })}
            </div>
            <Hint>
              A platform still needs a signed-in account on the Connections page.
              Upwork is watched rather than scraped, so it is switched on and off
              under <strong>Upwork job alerts</strong> below.
            </Hint>
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
            tone="danger"
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

        <Section
          icon={Radar}
          title="Scraping"
          description="How hard the scrapers work on each cycle. Upwork is not one of them — it has its own section below."
        >
          <Alert tone="info" title="These settings do not touch Upwork.">
            Upwork is watched for job alerts rather than scraped, so nothing here
            applies to it. See <strong>Upwork job alerts</strong> below.
          </Alert>

          <SwitchRow
            label="Scraping enabled"
            hint="Turn off to pause every scraper without losing your settings."
            checked={config.scrapeEnabled}
            onChange={(scrapeEnabled) => patch({ scrapeEnabled })}
          />

          <div className="grid gap-4 sm:grid-cols-2">
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
              hint="Ignore anything posted longer ago than this."
              value={config.maxPostAgeHours}
              min={1}
              max={720}
              onChange={(maxPostAgeHours) => patch({ maxPostAgeHours })}
            />
          </div>
        </Section>

        <Section
          icon={SlidersHorizontal}
          title="Platform tuning"
          description="Per-platform knobs for the scraped platforms. The defaults are sensible — change them if results are too noisy or too sparse."
        >
          <SubGroup title="Twitter / X">
            <div className="grid gap-4 sm:grid-cols-3">
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
                hint="Tweets collected per search term."
                value={config.twitterLimitPerKeyword}
                min={1}
                max={100}
                onChange={(twitterLimitPerKeyword) =>
                  patch({ twitterLimitPerKeyword })
                }
              />
            </div>
          </SubGroup>

        </Section>

        <Section
          icon={Radio}
          title="Upwork job alerts"
          description="A tab left open on your Upwork feed, reloaded now and then, telling you about new jobs after a short pause."
        >
          <Alert
            tone="warning"
            icon={<ShieldAlert className="size-4" />}
            title="Upwork is never scraped, and there is no setting that changes that."
          >
            <p>
              Bulk-scraping Upwork &mdash; paging through the feed and pulling
              every listing &mdash; breaks its terms of service and is the
              quickest way to get your account suspended. FindClients does not
              do it.
            </p>
            <p className="mt-1.5">
              What it does instead is keep one tab open on the feed you already
              use and reload that single page on the schedule below. The
              settings here only make it slower or faster within safe bounds;
              none of them turn collection on.
            </p>
          </Alert>

          <SwitchRow
            label="Upwork job alerts"
            hint="Off closes the tab and stops all Upwork alerts. Your other platforms are unaffected."
            checked={config.upworkWatchEnabled}
            onChange={(upworkWatchEnabled) => patch({ upworkWatchEnabled })}
          />

          <Field
            label="Jobs feed URL"
            hint="Paste any Upwork search URL to watch that feed instead of your most-recent list. Narrower searches mean fewer, better alerts."
            htmlFor="upwork-jobs-url"
          >
            <Input
              id="upwork-jobs-url"
              type="url"
              value={config.upworkJobsUrl}
              onChange={(e) => patch({ upworkJobsUrl: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>

          <SubGroup title="How often the tab reloads">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="Shortest gap (minutes)"
                value={config.upworkReloadMinMinutes}
                min={2}
                max={120}
                onChange={(upworkReloadMinMinutes) => patch({ upworkReloadMinMinutes })}
              />
              <NumberField
                label="Longest gap (minutes)"
                value={config.upworkReloadMaxMinutes}
                min={2}
                max={240}
                onChange={(upworkReloadMaxMinutes) => patch({ upworkReloadMaxMinutes })}
              />
            </div>
            <Hint>
              A fresh interval is drawn between these two before every reload, and
              now and then it takes a longer break. Five to ten minutes is a
              person keeping half an eye on the feed; every two minutes, forever,
              is not, and that regularity is what gets noticed.
            </Hint>
          </SubGroup>

          <SubGroup title="How long a job is held before you hear about it">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="Shortest hold (seconds)"
                value={config.upworkAlertDelayMinSeconds}
                min={30}
                max={3600}
                onChange={(upworkAlertDelayMinSeconds) =>
                  patch({ upworkAlertDelayMinSeconds })
                }
              />
              <NumberField
                label="Longest hold (seconds)"
                value={config.upworkAlertDelayMaxSeconds}
                min={30}
                max={7200}
                onChange={(upworkAlertDelayMaxSeconds) =>
                  patch({ upworkAlertDelayMaxSeconds })
                }
              />
            </div>
            <Hint>
              Drawn fresh for every job, and several jobs spotted at once are
              spaced further apart still. Applying to a listing seconds after it
              goes up, every single time, is the clearest sign that something
              other than a person is reading the feed.
            </Hint>
          </SubGroup>

          <SubGroup title="What counts as new">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="Max job age (hours)"
                hint="Older jobs drifting back onto the feed are ignored."
                value={config.upworkMaxAgeHours}
                min={1}
                max={720}
                onChange={(upworkMaxAgeHours) => patch({ upworkMaxAgeHours })}
              />
              <div className="sm:pt-1">
                <SwitchRow
                  label="Open the job before alerting"
                  hint="Adds client rating and hire rate, by clicking through to that one job the way you would."
                  checked={config.upworkFetchDetails}
                  onChange={(upworkFetchDetails) => patch({ upworkFetchDetails })}
                />
              </div>
            </div>
          </SubGroup>
        </Section>

        <Section
          icon={Cpu}
          title="AI qualification"
          description="Have Gemini read every scraped lead and judge it against your own criteria before it reaches your inbox."
        >
          {/* The key comes first: nothing else in this section works without it. */}
          <div className="space-y-2">
            <Label htmlFor="gemini-api-key">Gemini API key</Label>

            {config.aiApiKeySet && !clearApiKey && !apiKeyDraft && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-success/25 bg-success/8 px-3 py-2">
                <span className="text-[0.8125rem] text-graphite-300">
                  A key is saved{' '}
                  <span className="font-mono text-muted-foreground">
                    {config.aiApiKeyHint}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setClearApiKey(true)
                    setSaved(false)
                  }}
                  className="rounded-sm text-[0.8125rem] font-medium text-destructive transition-opacity hover:opacity-70"
                >
                  Remove
                </button>
              </div>
            )}

            {clearApiKey && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                <span className="text-[0.8125rem] text-graphite-200">
                  Your key will be deleted when you save.
                </span>
                <button
                  type="button"
                  onClick={() => setClearApiKey(false)}
                  className="rounded-sm text-[0.8125rem] font-medium transition-opacity hover:opacity-70"
                >
                  Undo
                </button>
              </div>
            )}

            <div className="relative">
              <Input
                id="gemini-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyDraft}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  config.aiApiKeySet && !clearApiKey
                    ? 'Enter a new key to replace it'
                    : 'AIza…'
                }
                onChange={(e) => {
                  setApiKeyDraft(e.target.value)
                  setSaved(false)
                }}
                className="pr-10 font-mono text-xs"
              />
              <button
                type="button"
                aria-label={showApiKey ? 'Hide the key' : 'Show the key'}
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md text-graphite-500 transition-colors hover:text-foreground"
              >
                {showApiKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>

            <Hint>
              Your own key — reviews are billed to your Google account, not ours.
              Stored encrypted and never shown again after you save.{' '}
              <a
                href={GEMINI_KEY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm font-medium text-primary hover:underline"
              >
                Get a key
                <ExternalLink className="size-3" />
              </a>
            </Hint>
          </div>

          <SwitchRow
            label="Qualify leads with AI"
            hint="Off means every scraped lead reaches you unjudged."
            checked={config.aiEnabled}
            onChange={(aiEnabled) => patch({ aiEnabled })}
          />

          {config.aiEnabled && !ai.available && !apiKeyDraft && (
            <Alert
              tone="warning"
              title="Qualification is on, but no key is saved."
            >
              Every scrape will skip the review step until you add a Gemini key
              above.
            </Alert>
          )}

          <Field
            label="What counts as a qualified lead"
            hint={`Written in your own words — this is the only description of your ideal client the model gets. Be specific about the work you take and what you always reject. ${config.aiPrompt.length}/4000.`}
            htmlFor="ai-prompt"
          >
            <Textarea
              id="ai-prompt"
              rows={7}
              maxLength={4000}
              value={config.aiPrompt}
              placeholder="I build Shopify stores for small brands. Qualified: the poster is hiring, the work is Shopify or front-end, and the budget is at least $500. Reject: agencies recruiting, unpaid or revenue-share offers, and anyone advertising their own services."
              onChange={(e) => patch({ aiPrompt: e.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Model"
              hint="One call per lead, charged to your key."
              htmlFor="ai-model"
            >
              <Select
                id="ai-model"
                value={config.aiModel}
                onChange={(e) => patch({ aiModel: e.target.value })}
              >
                {ai.models.map((model) => (
                  <option key={model} value={model}>
                    {MODEL_LABELS[model] ?? model}
                  </option>
                ))}
              </Select>
            </Field>

            <NumberField
              label="Minimum score"
              hint="Leads scoring below this (0–100) are rejected."
              value={config.aiMinScore}
              min={0}
              max={100}
              onChange={(aiMinScore) => patch({ aiMinScore })}
            />
          </div>

          <SwitchRow
            label="Archive rejected leads"
            hint="Keeps your inbox to what passed. Rejected leads stay searchable under the Archived filter."
            checked={config.aiAutoArchive}
            onChange={(aiAutoArchive) => patch({ aiAutoArchive })}
          />
        </Section>

        <Section
          icon={Bell}
          title="Notifications"
          description="How you hear about a match."
        >
          <SwitchRow
            label="New leads"
            hint="Alert me when a lead matches the filters above."
            checked={config.newLeadsNotification}
            onChange={(newLeadsNotification) => patch({ newLeadsNotification })}
          />
          <Field
            label="Discord webhook"
            hint="Optional. Matching leads get posted to this channel as they are found."
            htmlFor="discord-webhook"
          >
            <Input
              id="discord-webhook"
              type="url"
              value={config.discordWebhookUrl}
              placeholder="https://discord.com/api/webhooks/…"
              onChange={(e) => patch({ discordWebhookUrl: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        </Section>

        <p className="text-xs text-muted-foreground">
          Last saved {new Date(config.updatedAt).toLocaleString()}.
        </p>
      </PageShell>

      {/* Sticky save bar — the page is long, so the action follows you down it. */}
      <div className="sticky bottom-0 z-10 border-t border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex-1 text-[0.8125rem]">
            {dirty ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <span
                  className="size-1.5 rounded-full bg-warning"
                  aria-hidden
                />
                Unsaved changes
              </span>
            ) : saved ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-success">
                <Check className="size-4" />
                Saved
              </span>
            ) : null}
          </div>

          {dirty && (
            <Button variant="ghost" onClick={reset} disabled={saving}>
              <RotateCcw className="size-4" />
              Reset
            </Button>
          )}
          <Button onClick={save} loading={saving} disabled={!dirty}>
            <Save className="size-4" />
            Save changes
          </Button>
        </div>
      </div>
    </DashboardLayout>
  )
}
