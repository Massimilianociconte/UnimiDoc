-- Advisor 0016 (materialized_view_in_api): le MV dei ranking non devono essere
-- leggibili direttamente da anon/authenticated via Data API. L'accesso passa da
-- funzioni SECURITY DEFINER in app_private (non esposte all'API) con output
-- limitato ai soli campi necessari alle classifiche; le view pubbliche restano
-- security_invoker (advisor 0010 quieto) e diventano passthrough delle funzioni.

-- 1) Funzioni cache-backed con proiezione limitata.
create or replace function app_private.document_rankings_public_fn()
returns table(
  document_id uuid, owner_id uuid, title text, course_name text, professor text,
  university text, degree_slug text, degree_course text, academic_year text,
  created_at timestamptz, updated_at timestamptz,
  review_count integer, review_avg numeric,
  overall_score numeric, recent_score numeric, didactic_score numeric,
  sample_size integer)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select document_id, owner_id, title, course_name, professor, university,
         degree_slug, degree_course, academic_year, created_at, updated_at,
         review_count, review_avg, overall_score, recent_score, didactic_score,
         sample_size
  from public.document_rankings_cache;
$$;

create or replace function app_private.author_rankings_public_fn()
returns table(
  author_id uuid, public_display_name text, avatar_url text, university text,
  degree_course text, docs_published integer, avg_doc_score numeric,
  total_reviews integer, repeat_rate numeric, reliability_score numeric,
  is_emerging boolean, emerging_score numeric)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select author_id, public_display_name, avatar_url, university, degree_course,
         docs_published, avg_doc_score, total_reviews, repeat_rate,
         reliability_score, is_emerging, emerging_score
  from public.author_rankings_cache;
$$;

revoke all on function app_private.document_rankings_public_fn() from public;
revoke all on function app_private.author_rankings_public_fn() from public;
grant execute on function app_private.document_rankings_public_fn() to anon, authenticated;
grant execute on function app_private.author_rankings_public_fn() to anon, authenticated;

-- 2) Le view esposte diventano passthrough invoker delle funzioni cache-backed
--    (stesso contratto per il frontend, colonne interne non più pubblicate:
--    fq_*, purchases_*, reports_negative, completeness, freshness, *_score
--    intermedi, total_purchases/refunds/reports, distinct/repeat_buyers).
drop view if exists public.public_document_rankings;
drop view if exists public.public_author_rankings;

create view public.public_document_rankings with (security_invoker = on) as
  select * from app_private.document_rankings_public_fn();
create view public.public_author_rankings with (security_invoker = on) as
  select * from app_private.author_rankings_public_fn();

grant select on public.public_document_rankings to anon, authenticated;
grant select on public.public_author_rankings to anon, authenticated;

-- 3) Revoca dell'accesso diretto alle MV per i ruoli API.
revoke all on public.document_rankings_cache from anon, authenticated;
revoke all on public.author_rankings_cache from anon, authenticated;

-- 4) Advisor 0003 (auth_rls_initplan): auth.uid() valutato una volta sola.
drop policy if exists usage_events_insert on public.usage_events;
create policy usage_events_insert on public.usage_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
