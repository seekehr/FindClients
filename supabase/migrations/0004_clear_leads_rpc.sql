-- Migration 4: RPC function for clearing leads
--
-- clearLeads needs to dismiss ALL visible leads for a user, including ones
-- that have no user_leads row yet. A simple UPDATE only hits existing rows,
-- so leads without a user_leads entry reappear on the next page load.

create or replace function public.clear_leads_for_user(p_user_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  total integer := 0;
  cnt   integer;
begin
  -- 1. Dismiss existing non-bookmarked, non-dismissed user_leads rows.
  update public.user_leads
  set status = 'dismissed', updated_at = now()
  where user_id = p_user_id
    and status != 'dismissed'
    and bookmarked != true;
  get diagnostics cnt = row_count;
  total := total + cnt;

  -- 2. Insert dismissed rows for pool leads that have no user_leads entry.
  insert into public.user_leads (user_id, lead_id, status, updated_at)
  select p_user_id, l.id, 'dismissed', now()
  from public.leads l
  where not exists (
    select 1 from public.user_leads ul
    where ul.user_id = p_user_id and ul.lead_id = l.id
  );
  get diagnostics cnt = row_count;
  total := total + cnt;

  return total;
end;
$$;
