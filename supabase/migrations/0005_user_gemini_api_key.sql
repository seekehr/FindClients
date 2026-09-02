-- ═══════════════════════════════════════════════════════════════════════════
-- FindClients — bring-your-own Gemini key for AI lead qualification.
--
-- Run this in the Supabase dashboard → SQL Editor → New query → Run, after
-- 0004_clear_leads_rpc.sql. It is idempotent, so re-running it is safe.
--
-- What changes:
--   user_config.ai_api_key   NEW — this user's own Google Gemini API key,
--                            stored as AES-256-GCM ciphertext produced by the
--                            API server (utils/crypto.ts), never plaintext.
--   user_config.ai_model     now a Gemini model id; Claude ids are migrated.
--
-- Why: qualification used to run on one server-wide ANTHROPIC_API_KEY, which
-- meant the operator paid for every user's reviews and a missing key silently
-- switched the feature off for everyone. The key is now per-user, entered on
-- the Config page, and Gemini is the only supported provider.
--
-- NOTE ON RLS: user_config's "own row" policy lets a user read their own
-- ai_api_key column, but what they can read is the ciphertext — the
-- ENCRYPTION_KEY that opens it lives only in the API server's environment.
-- The server never returns the decrypted key over any route; the Config page
-- gets a boolean and a masked hint.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.user_config
  add column if not exists ai_api_key text not null default '';

comment on column public.user_config.ai_api_key is
  'The user''s own Google Gemini API key, AES-256-GCM encrypted by the API '
  'server. Empty means AI qualification cannot run for this user.';


-- ── ai_model: Claude ids → Gemini ids ──────────────────────────────────────
-- The default moves to gemini-2.5-flash: screening is a short judgment call on
-- every scraped lead, so the cheap fast model is the right default and the
-- user can move up to Pro on the Config page.

alter table public.user_config
  alter column ai_model set default 'gemini-2.5-flash';

-- Map the old defaults onto their closest Gemini counterpart. Anything already
-- holding a gemini-* id is left alone, so this is safe to re-run.
update public.user_config
set ai_model = case
      when ai_model like 'claude-opus%'   then 'gemini-2.5-pro'
      when ai_model like 'claude-sonnet%' then 'gemini-2.5-flash'
      when ai_model like 'claude-haiku%'  then 'gemini-2.5-flash-lite'
      else 'gemini-2.5-flash'
    end
where ai_model not like 'gemini-%';

-- Keep the column honest from here on: a typo'd model id fails on every lead
-- of every cycle, and the failure reads as "the AI is broken".
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_config_ai_model_check'
  ) then
    alter table public.user_config
      add constraint user_config_ai_model_check
      check (ai_model in ('gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'));
  end if;
end
$$;
