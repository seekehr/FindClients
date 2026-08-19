-- ═══════════════════════════════════════════════════════════════════════════
-- FindClients — AI lead qualification + richer lead data.
--
-- Run this in the Supabase dashboard → SQL Editor → New query → Run, after
-- 0001_init.sql. It is idempotent, so re-running it is safe.
--
-- What it adds:
--   leads.metadata      the platform-specific facts a scraper collected
--                       (tweet engagement, Upwork client stats, …) as JSONB
--   user_leads.ai_*     one AI verdict per user per lead — the qualification
--                       is per-user because the prompt that produced it is
--   user_config.ai_*    the user's own qualification prompt and thresholds
--
-- The AI verdict lives on user_leads rather than leads for the same reason
-- bookmarks do: two users pointing different prompts at the same shared lead
-- must get their own answers.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── leads: platform-specific facts ─────────────────────────────────────────

alter table public.leads
  add column if not exists metadata jsonb not null default '{}'::jsonb;


-- ── user_leads: this user's AI verdict for this lead ───────────────────────

alter table public.user_leads
  add column if not exists ai_verdict    text,
  add column if not exists ai_score      integer,
  add column if not exists ai_reason     text        not null default '',
  add column if not exists ai_model      text        not null default '',
  add column if not exists ai_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_leads_ai_verdict_check'
  ) then
    alter table public.user_leads
      add constraint user_leads_ai_verdict_check
      check (ai_verdict is null or ai_verdict in ('qualified', 'rejected', 'error'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_leads_ai_score_check'
  ) then
    alter table public.user_leads
      add constraint user_leads_ai_score_check
      check (ai_score is null or ai_score between 0 and 100);
  end if;
end
$$;

-- The Leads page's "Qualified" filter, and the runner's "has this user's
-- prompt already judged this lead?" lookup.
create index if not exists idx_user_leads_ai_verdict
  on public.user_leads (user_id, ai_verdict);


-- ── user_config: the user's qualification prompt ───────────────────────────
-- ai_prompt is the whole point of the feature: the user describes, in their
-- own words, what a lead worth their time looks like. The model is told to
-- return a score and a reason; this text is what it scores against.

alter table public.user_config
  add column if not exists ai_enabled      boolean not null default false,
  add column if not exists ai_prompt       text    not null default
    'I am a freelance web developer. A lead is QUALIFIED when it is a real, '
    'current request to hire someone for paid software, web, or design work, '
    'and the poster is the one doing the hiring.' || chr(10) || chr(10) ||
    'Reject a lead when it is: someone advertising their own availability or '
    'services, a job board repost with no direct contact, an unpaid or '
    '"exposure" opportunity, crypto/NFT promotion, a recruiter spamming the '
    'same post, or a general discussion with no hiring intent.',
  add column if not exists ai_model        text    not null default 'claude-opus-5',
  add column if not exists ai_min_score    integer not null default 60,
  add column if not exists ai_auto_archive boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_config_ai_min_score_check'
  ) then
    alter table public.user_config
      add constraint user_config_ai_min_score_check
      check (ai_min_score between 0 and 100);
  end if;
end
$$;


-- ── list_leads / get_lead ──────────────────────────────────────────────────
-- Both grow the new columns, and list_leads grows an AI filter. The old
-- signatures are dropped first: adding a parameter creates an overload, and
-- PostgREST would not know which one an RPC call meant.

drop function if exists public.list_leads(uuid, text, text, text, boolean, integer, integer);
drop function if exists public.get_lead(uuid, uuid);

create or replace function public.list_leads(
  p_user_id    uuid,
  p_platform   text    default null,
  p_status     text    default null,
  p_q          text    default null,
  p_bookmarked boolean default false,
  p_ai         text    default null,
  p_limit      integer default 20,
  p_offset     integer default 0
)
returns table (
  id            uuid,
  title         text,
  platform      text,
  description   text,
  budget        text,
  timeline      text,
  url           text,
  author        text,
  tags          text[],
  metadata      jsonb,
  posted_at     timestamptz,
  created_at    timestamptz,
  status        text,
  bookmarked    boolean,
  ai_verdict    text,
  ai_score      integer,
  ai_reason     text,
  ai_checked_at timestamptz,
  total_count   bigint
)
language sql
stable
as $$
  with matched as (
    select
      l.*,
      coalesce(ul.status, 'new')     as ul_status,
      coalesce(ul.bookmarked, false) as ul_bookmarked,
      ul.ai_verdict                  as ul_ai_verdict,
      ul.ai_score                    as ul_ai_score,
      coalesce(ul.ai_reason, '')     as ul_ai_reason,
      ul.ai_checked_at               as ul_ai_checked_at
    from public.leads l
    left join public.user_leads ul
      on ul.lead_id = l.id and ul.user_id = p_user_id
    where (p_platform is null or l.platform = p_platform)
      and (p_status   is null or coalesce(ul.status, 'new') = p_status)
      and (not p_bookmarked or coalesce(ul.bookmarked, false))
      and (
        p_ai is null
        or (p_ai = 'qualified' and ul.ai_verdict = 'qualified')
        or (p_ai = 'rejected'  and ul.ai_verdict = 'rejected')
        or (p_ai = 'unchecked' and ul.ai_verdict is null)
      )
      and (
        p_q is null
        or l.title ilike '%' || p_q || '%'
        or l.description ilike '%' || p_q || '%'
      )
  )
  select
    m.id, m.title, m.platform, m.description, m.budget, m.timeline, m.url, m.author,
    m.tags, m.metadata, m.posted_at, m.created_at, m.ul_status, m.ul_bookmarked,
    m.ul_ai_verdict, m.ul_ai_score, m.ul_ai_reason, m.ul_ai_checked_at,
    count(*) over () as total_count
  from matched m
  order by m.posted_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

create or replace function public.get_lead(p_user_id uuid, p_lead_id uuid)
returns table (
  id            uuid,
  title         text,
  platform      text,
  description   text,
  budget        text,
  timeline      text,
  url           text,
  author        text,
  tags          text[],
  metadata      jsonb,
  posted_at     timestamptz,
  created_at    timestamptz,
  status        text,
  bookmarked    boolean,
  ai_verdict    text,
  ai_score      integer,
  ai_reason     text,
  ai_checked_at timestamptz
)
language sql
stable
as $$
  select
    l.id, l.title, l.platform, l.description, l.budget, l.timeline, l.url, l.author,
    l.tags, l.metadata, l.posted_at, l.created_at,
    coalesce(ul.status, 'new'), coalesce(ul.bookmarked, false),
    ul.ai_verdict, ul.ai_score, coalesce(ul.ai_reason, ''), ul.ai_checked_at
  from public.leads l
  left join public.user_leads ul
    on ul.lead_id = l.id and ul.user_id = p_user_id
  where l.id = p_lead_id;
$$;

grant execute on function
  public.list_leads(uuid, text, text, text, boolean, text, integer, integer),
  public.get_lead(uuid, uuid)
to authenticated, service_role;
