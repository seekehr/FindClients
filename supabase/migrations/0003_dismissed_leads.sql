-- Migration 3: Dismissed leads
--
-- When a user clears their leads, they are marked as 'dismissed' instead of
-- deleted. Dismissed leads are excluded from all queries and ignored on
-- future scrapes.

-- Allow 'dismissed' in the user_leads status check constraint.
alter table public.user_leads
  drop constraint if exists user_leads_status_check;
alter table public.user_leads
  add constraint user_leads_status_check
  check (status in ('new', 'viewed', 'contacted', 'won', 'archived', 'dismissed'));

-- Update list_leads to exclude dismissed leads.
drop function if exists public.list_leads(uuid, text, text, text, boolean, text, integer, integer);

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
    where coalesce(ul.status, 'new') != 'dismissed'
      and (p_platform is null or l.platform = p_platform)
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
