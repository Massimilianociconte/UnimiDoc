-- Avoid evaluating auth.uid() once per candidate row in review/report RLS.
-- Semantics remain unchanged; the scalar subquery becomes an initplan.

drop policy if exists document_reviews_select on public.document_reviews;
create policy document_reviews_select on public.document_reviews
  for select to anon, authenticated using (
    reviewer_id = (select auth.uid())
    or exists (
      select 1 from public.documents d
      where d.id = document_reviews.document_id and d.visibility = 'published'
    )
  );

drop policy if exists document_reviews_insert on public.document_reviews;
create policy document_reviews_insert on public.document_reviews
  for insert to authenticated with check (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.documents d
      where d.id = document_reviews.document_id
        and d.visibility = 'published'
        and d.owner_id <> (select auth.uid())
    )
    and (
      exists (
        select 1 from public.document_purchases p
        where p.document_id = document_reviews.document_id
          and p.buyer_id = (select auth.uid())
          and p.status = 'active'
      )
      or exists (
        select 1 from public.documents d
        where d.id = document_reviews.document_id and coalesce(d.price_credits, 0) = 0
      )
    )
  );

drop policy if exists document_reviews_update on public.document_reviews;
create policy document_reviews_update on public.document_reviews
  for update to authenticated
  using (reviewer_id = (select auth.uid()))
  with check (reviewer_id = (select auth.uid()));

drop policy if exists document_reviews_delete on public.document_reviews;
create policy document_reviews_delete on public.document_reviews
  for delete to authenticated using (reviewer_id = (select auth.uid()));

drop policy if exists document_reports_select_own on public.document_reports;
create policy document_reports_select_own on public.document_reports
  for select to authenticated using (reporter_id = (select auth.uid()));

drop policy if exists document_reports_insert on public.document_reports;
create policy document_reports_insert on public.document_reports
  for insert to authenticated with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.documents d
      where d.id = document_reports.document_id
        and d.visibility = 'published'
        and d.owner_id <> (select auth.uid())
    )
  );
