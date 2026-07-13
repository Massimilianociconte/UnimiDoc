-- The document_reviews / document_reports policies checked document eligibility
-- via `EXISTS (SELECT FROM documents WHERE visibility='published' ...)`, but
-- public.documents has an owner-only SELECT policy. Inside a policy the subquery
-- is evaluated with the caller's RLS, so for a buyer/anon the documents row is
-- invisible and the check fails closed: buyers could not post reviews or reports,
-- and anon/non-owner users could not read reviews (public social proof + the
-- ranking signal were both broken). Fix with SECURITY DEFINER boolean helpers
-- that bypass documents' RLS (same pattern as public.user_can_access_flashcard),
-- and fold in the active-purchase requirement.
-- NOTE: these helpers are moved to the app_private schema by the next migration.

create or replace function public.document_is_published(p_document uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document and d.visibility = 'published'
  );
$$;

create or replace function public.document_owner_id(p_document uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
  -- Only reveals the owner of a PUBLISHED document (already public marketplace
  -- data); returns null otherwise, so it cannot probe private-document owners.
  select d.owner_id from public.documents d
  where d.id = p_document and d.visibility = 'published';
$$;

create or replace function public.document_is_free(p_document uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document
      and d.visibility = 'published'
      and coalesce(d.price_credits, 0) = 0
  );
$$;

create or replace function public.user_has_active_purchase(p_document uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.document_purchases p
    where p.document_id = p_document
      and p.buyer_id = (select auth.uid())
      and p.status = 'active'
  );
$$;

revoke all on function public.document_is_published(uuid) from public;
revoke all on function public.document_owner_id(uuid) from public;
revoke all on function public.document_is_free(uuid) from public;
revoke all on function public.user_has_active_purchase(uuid) from public;
grant execute on function public.document_is_published(uuid) to anon, authenticated;
grant execute on function public.document_owner_id(uuid) to authenticated;
grant execute on function public.document_is_free(uuid) to authenticated;
grant execute on function public.user_has_active_purchase(uuid) to authenticated;

-- Reviews: readable for own review or any published document (public social proof)
drop policy if exists document_reviews_select on public.document_reviews;
create policy document_reviews_select on public.document_reviews
  for select to anon, authenticated
  using (
    reviewer_id = (select auth.uid())
    or public.document_is_published(document_id)
  );

-- Reviews: only the buyer of an active purchase (or any user on a free published
-- doc), never the author, on a published document.
drop policy if exists document_reviews_insert on public.document_reviews;
create policy document_reviews_insert on public.document_reviews
  for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and public.document_is_published(document_id)
    and public.document_owner_id(document_id) is distinct from (select auth.uid())
    and (
      public.user_has_active_purchase(document_id)
      or public.document_is_free(document_id)
    )
  );

-- Reports: any authenticated user may report a published document they do not own.
drop policy if exists document_reports_insert on public.document_reports;
create policy document_reports_insert on public.document_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and public.document_is_published(document_id)
    and public.document_owner_id(document_id) is distinct from (select auth.uid())
  );
