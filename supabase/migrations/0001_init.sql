-- ═══════════════════════════════════════════════════════════════════════════
-- FindClients — initial Supabase schema.
--
-- Run this once in the Supabase dashboard → SQL Editor → New query → Run.
-- It is idempotent: re-running it is safe and will not drop data.
--
-- Identity lives in Supabase Auth (auth.users). Everything below hangs off it:
--   profiles      1:1 public mirror of auth.users (name, plan)
--   user_config   1:1 per-user configuration — drives the app's Config page
--   subscriptions 1:1 plan + usage counters
--   leads         shared pool of discovered leads, de-duplicated by source_hash
--   user_leads    per-user state on a lead (bookmark, pipeline status, notes)
--   credentials   per-user, per-platform encrypted session cookies
--   notifications per-user notification feed
--   scrape_runs   audit log of scraper runs
--
-- Row Level Security is on for every table. The API server uses the service
-- key (which bypasses RLS) and scopes each query by user id itself; the
-- policies are the second line of defence if a client ever talks to PostgREST
-- directly with a user's access token.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helpers ────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ── profiles ───────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text        not null,
  full_name  text        not null default '',
  plan       text        not null default 'free' check (plan in ('free', 'pro', 'agency')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- ── user_config ────────────────────────────────────────────────────────────
-- Everything the user can change on the Config page.
--
-- Scraper search settings live here, NOT in the environment: keywords, like and
-- view thresholds, per-keyword limits, post age windows, the Upwork feed URL and
-- the Discord webhook are all per-user. The defaults below are what a brand-new
-- account starts with, so this table is the single source of truth for them.

create table if not exists public.user_config (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Notifications
  email_notifications boolean not null default true,
  push_notifications  boolean not null default true,
  new_leads_notify    boolean not null default true,
  discord_webhook_url text    not null default '',

  -- Lead targeting
  platforms         text[]  not null default '{upwork,twitter}',
  keywords          text[]  not null default '{
    "looking for a developer",
    "need a web designer",
    "hiring freelancer",
    "anyone know a good developer",
    "looking to hire"
  }',
  excluded_keywords text[]  not null default '{}',
  min_budget        integer not null default 0 check (min_budget >= 0),

  -- Scraping behaviour
  scrape_enabled     boolean not null default true,
  leads_per_run      integer not null default 25 check (leads_per_run between 1 and 100),
  max_post_age_hours integer not null default 48 check (max_post_age_hours between 1 and 720),

  -- X / Twitter tuning
  twitter_min_likes         integer not null default 0  check (twitter_min_likes >= 0),
  twitter_min_views         integer not null default 0  check (twitter_min_views >= 0),
  twitter_limit_per_keyword integer not null default 15 check (twitter_limit_per_keyword between 1 and 100),

  -- Upwork tuning
  upwork_jobs_url      text    not null default 'https://www.upwork.com/nx/find-work/most-recent?nav_dir=pop',
  upwork_fetch_details boolean not null default true,
  upwork_max_age_hours integer not null default 5 check (upwork_max_age_hours between 1 and 720),

  updated_at timestamptz not null default now()
);

drop trigger if exists user_config_set_updated_at on public.user_config;
create trigger user_config_set_updated_at
  before update on public.user_config
  for each row execute function public.set_updated_at();


-- ── subscriptions ──────────────────────────────────────────────────────────

create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  plan               text        not null default 'free' check (plan in ('free', 'pro', 'agency')),
  status             text        not null default 'active',
  current_period_end timestamptz,
  leads_used         integer     not null default 0,
  leads_limit        integer     not null default 50,
  updated_at         timestamptz not null default now()
);

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();


-- ── leads ──────────────────────────────────────────────────────────────────
-- Shared pool: one row per discovered opportunity, regardless of which user's
-- session found it. source_hash collapses the same post seen on repeat runs.

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  platform    text        not null,
  description text        not null default '',
  budget      text,
  timeline    text,
  url         text,
  author      text,
  tags        text[]      not null default '{}',
  source_hash text        not null unique,
  posted_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_leads_platform  on public.leads (platform);
create index if not exists idx_leads_posted_at on public.leads (posted_at desc);


-- ── user_leads ─────────────────────────────────────────────────────────────

create table if not exists public.user_leads (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  lead_id    uuid        not null references public.leads (id) on delete cascade,
  bookmarked boolean     not null default false,
  status     text        not null default 'new'
               check (status in ('new', 'viewed', 'contacted', 'won', 'archived')),
  notes      text        not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, lead_id)
);

create index if not exists idx_user_leads_bookmarked
  on public.user_leads (user_id) where bookmarked;


-- ── credentials ────────────────────────────────────────────────────────────
-- `secret` is an AES-256-GCM ciphertext produced by the API server. It is
-- never returned to a client — only decrypted server-side to drive scraping.

create table if not exists public.credentials (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  platform     text        not null,
  secret       text        not null,
  status       text        not null default 'connected',
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_used_at timestamptz,
  primary key (user_id, platform)
);

drop trigger if exists credentials_set_updated_at on public.credentials;
create trigger credentials_set_updated_at
  before update on public.credentials
  for each row execute function public.set_updated_at();


-- ── notifications ──────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  type       text        not null default 'lead',
  title      text        not null,
  message    text        not null default '',
  lead_id    uuid        references public.leads (id) on delete set null,
  read       boolean     not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user
  on public.notifications (user_id, read, created_at desc);


-- ── scrape_runs ────────────────────────────────────────────────────────────

create table if not exists public.scrape_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        references auth.users (id) on delete cascade,
  platform    text        not null,
  status      text        not null default 'running' check (status in ('running', 'success', 'error')),
  found       integer     not null default 0,
  inserted    integer     not null default 0,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_scrape_runs_started on public.scrape_runs (started_at desc);
create index if not exists idx_scrape_runs_user    on public.scrape_runs (user_id, started_at desc);


-- ── Provision a new user ───────────────────────────────────────────────────
-- Fires on sign-up so every account has a profile, config and subscription
-- before the first request touches them. SECURITY DEFINER because the trigger
-- runs in the auth schema's context.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, plan)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'plan', 'free')
  )
  on conflict (id) do nothing;

  insert into public.user_config (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, plan, leads_limit)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'plan', 'free'), 50)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step with a changed auth email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();


-- ── Row Level Security ─────────────────────────────────────────────────────
-- The service key used by the API server bypasses all of this. These policies
-- only bite when a request arrives with an end user's access token.

alter table public.profiles      enable row level security;
alter table public.user_config   enable row level security;
alter table public.subscriptions enable row level security;
alter table public.leads         enable row level security;
alter table public.user_leads    enable row level security;
alter table public.credentials   enable row level security;
alter table public.notifications enable row level security;
alter table public.scrape_runs   enable row level security;

-- profiles: own row, read + update (never insert/delete directly).
drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: read own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- user_config: full control over your own row.
drop policy if exists "user_config: own row" on public.user_config;
create policy "user_config: own row" on public.user_config for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- subscriptions: readable by the owner; plan changes go through the API.
drop policy if exists "subscriptions: read own" on public.subscriptions;
create policy "subscriptions: read own" on public.subscriptions for select
  using (auth.uid() = user_id);

-- leads: shared pool, readable by any signed-in user. Writes are server-only.
drop policy if exists "leads: read when signed in" on public.leads;
create policy "leads: read when signed in" on public.leads for select
  to authenticated using (true);

-- user_leads / credentials / notifications: strictly your own rows.
drop policy if exists "user_leads: own rows" on public.user_leads;
create policy "user_leads: own rows" on public.user_leads for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "credentials: own rows" on public.credentials;
create policy "credentials: own rows" on public.credentials for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notifications: own rows" on public.notifications;
create policy "notifications: own rows" on public.notifications for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- scrape_runs: read your own history.
drop policy if exists "scrape_runs: read own" on public.scrape_runs;
create policy "scrape_runs: read own" on public.scrape_runs for select
  using (auth.uid() = user_id);


-- ── Query functions ────────────────────────────────────────────────────────
-- Listing a lead means joining the shared pool to the caller's own per-lead
-- state, and analytics are pure aggregation. Both are far cheaper expressed
-- once in SQL than assembled from several PostgREST round trips.
--
-- These are SECURITY INVOKER (the default) on purpose: called with the service
-- key they see everything, and called with an end user's token RLS still
-- applies, so nobody can read another user's rows by passing a different id.

create or replace function public.list_leads(
  p_user_id    uuid,
  p_platform   text    default null,
  p_status     text    default null,
  p_q          text    default null,
  p_bookmarked boolean default false,
  p_limit      integer default 20,
  p_offset     integer default 0
)
returns table (
  id          uuid,
  title       text,
  platform    text,
  description text,
  budget      text,
  timeline    text,
  url         text,
  author      text,
  tags        text[],
  posted_at   timestamptz,
  created_at  timestamptz,
  status      text,
  bookmarked  boolean,
  total_count bigint
)
language sql
stable
as $$
  with matched as (
    select
      l.*,
      coalesce(ul.status, 'new')     as ul_status,
      coalesce(ul.bookmarked, false) as ul_bookmarked
    from public.leads l
    left join public.user_leads ul
      on ul.lead_id = l.id and ul.user_id = p_user_id
    where (p_platform is null or l.platform = p_platform)
      and (p_status   is null or coalesce(ul.status, 'new') = p_status)
      and (not p_bookmarked or coalesce(ul.bookmarked, false))
      and (
        p_q is null
        or l.title ilike '%' || p_q || '%'
        or l.description ilike '%' || p_q || '%'
      )
  )
  select
    m.id, m.title, m.platform, m.description, m.budget, m.timeline, m.url, m.author,
    m.tags, m.posted_at, m.created_at, m.ul_status, m.ul_bookmarked,
    count(*) over () as total_count
  from matched m
  order by m.posted_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

create or replace function public.get_lead(p_user_id uuid, p_lead_id uuid)
returns table (
  id          uuid,
  title       text,
  platform    text,
  description text,
  budget      text,
  timeline    text,
  url         text,
  author      text,
  tags        text[],
  posted_at   timestamptz,
  created_at  timestamptz,
  status      text,
  bookmarked  boolean
)
language sql
stable
as $$
  select
    l.id, l.title, l.platform, l.description, l.budget, l.timeline, l.url, l.author,
    l.tags, l.posted_at, l.created_at,
    coalesce(ul.status, 'new'), coalesce(ul.bookmarked, false)
  from public.leads l
  left join public.user_leads ul
    on ul.lead_id = l.id and ul.user_id = p_user_id
  where l.id = p_lead_id;
$$;

create or replace function public.analytics_overview(p_user_id uuid)
returns table (
  new_leads   bigint,
  total_leads bigint,
  bookmarked  bigint,
  contacted   bigint,
  won         bigint,
  last_7d     bigint
)
language sql
stable
as $$
  select
    (select count(*) from public.leads where posted_at >= now() - interval '24 hours'),
    (select count(*) from public.leads),
    (select count(*) from public.user_leads where user_id = p_user_id and bookmarked),
    (select count(*) from public.user_leads where user_id = p_user_id and status = 'contacted'),
    (select count(*) from public.user_leads where user_id = p_user_id and status = 'won'),
    (select count(*) from public.leads where posted_at >= now() - interval '7 days');
$$;

create or replace function public.leads_by_platform()
returns table (platform text, count bigint)
language sql
stable
as $$
  select l.platform, count(*) as count
  from public.leads l
  group by l.platform
  order by count desc;
$$;

create or replace function public.leads_trend(p_days integer default 14)
returns table (day date, count bigint)
language sql
stable
as $$
  select posted_at::date, count(*)
  from public.leads
  where posted_at >= now() - (greatest(p_days, 1) || ' days')::interval
  group by 1
  order by 1 asc;
$$;

grant execute on function
  public.list_leads(uuid, text, text, text, boolean, integer, integer),
  public.get_lead(uuid, uuid),
  public.analytics_overview(uuid),
  public.leads_by_platform(),
  public.leads_trend(integer)
to authenticated, service_role;


-- ── Backfill ───────────────────────────────────────────────────────────────
-- Provision rows for any accounts that already existed before this migration.

insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do nothing;

insert into public.user_config (user_id) select id from auth.users
on conflict (user_id) do nothing;

insert into public.subscriptions (user_id) select id from auth.users
on conflict (user_id) do nothing;
