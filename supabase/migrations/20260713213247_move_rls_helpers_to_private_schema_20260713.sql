-- RLS policy-helper functions must be EXECUTEable by anon/authenticated so the
-- policies evaluate, but that also publishes them as PostgREST RPCs in `public`
-- (and the project's default privileges auto-grant anon EXECUTE). Move them to a
-- dedicated `app_private` schema that is NOT part of the exposed API: the RLS
-- policies still call them by qualified name, but they are no longer reachable
-- via /rest/v1/rpc, eliminating the extra surface. Same SECURITY DEFINER pattern
-- as public.user_can_access_flashcard.

create schema if not exists app_private;
grant usage on schema app_private to anon, authenticated;
-- Do NOT expose app_private via PostgREST (default exposed schemas are
-- public + graphql_public); no default privileges here, so grants are explicit.

create or replace function app_private.document_is_published(p_document uuid)
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $$ select exists (select 1 from public.documents d where d.id = p_document and d.visibility = 'published'); $$;

create or replace function app_private.document_owner_id(p_document uuid)
 returns uuid language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $$ select d.owner_id from public.documents d where d.id = p_document and d.visibility = 'published'; $$;

create or replace function app_private.document_is_free(p_document uuid)
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $$ select exists (select 1 from public.documents d where d.id = p_document and d.visibility = 'published' and coalesce(d.price_credits,0) = 0); $$;

create or replace function app_private.user_has_active_purchase(p_document uuid)
 returns boolean language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $$ select exists (select 1 from public.document_purchases p where p.document_id = p_document and p.buyer_id = (select auth.uid()) and p.status = 'active'); $$;

revoke all on function app_private.document_is_published(uuid) from public;
revoke all on function app_private.document_owner_id(uuid) from public;
revoke all on function app_private.document_is_free(uuid) from public;
revoke all on function app_private.user_has_active_purchase(uuid) from public;
grant execute on function app_private.document_is_published(uuid) to anon, authenticated;
grant execute on function app_private.document_owner_id(uuid) to authenticated;
grant execute on function app_private.document_is_free(uuid) to authenticated;
grant execute on function app_private.user_has_active_purchase(uuid) to authenticated;

-- Repoint policies to the hidden-schema helpers
drop policy if exists document_reviews_select on public.document_reviews;
create policy document_reviews_select on public.document_reviews
  for select to anon, authenticated
  using (
    reviewer_id = (select auth.uid())
    or app_private.document_is_published(document_id)
  );

drop policy if exists document_reviews_insert on public.document_reviews;
create policy document_reviews_insert on public.document_reviews
  for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and app_private.document_is_published(document_id)
    and app_private.document_owner_id(document_id) is distinct from (select auth.uid())
    and (
      app_private.user_has_active_purchase(document_id)
      or app_private.document_is_free(document_id)
    )
  );

drop policy if exists document_reports_insert on public.document_reports;
create policy document_reports_insert on public.document_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and app_private.document_is_published(document_id)
    and app_private.document_owner_id(document_id) is distinct from (select auth.uid())
  );

-- Remove the now-unused public (API-exposed) helper copies
drop function if exists public.document_is_published(uuid);
drop function if exists public.document_owner_id(uuid);
drop function if exists public.document_is_free(uuid);
drop function if exists public.user_has_active_purchase(uuid);
