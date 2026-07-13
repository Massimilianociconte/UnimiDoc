-- Dashboard/personal-area read model.
--
-- The UI previously assembled the same account snapshot through multiple
-- independent Data API calls and silently converted partial failures into
-- empty states. This owner-scoped RPC keeps the read model consistent, reduces
-- request fan-out, and reuses the existing RLS-protected source tables.

create or replace function public.get_user_dashboard_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'account', coalesce((
      select to_jsonb(a) - 'owner_id'
      from public.user_credit_accounts a
      where a.owner_id = v_user
    ), jsonb_build_object(
      'balance', 0,
      'free_credits', 0,
      'promotional_credits', 0,
      'purchased_credits', 0,
      'earned_credits', 0,
      'earned_convertible', 0,
      'lifetime_earned', 0,
      'lifetime_spent', 0,
      'reserved', 0
    )),
    'transactions', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at desc)
      from (
        select id, document_id, purchase_id, direction, amount, reason,
               metadata, free_delta, promotional_delta, purchased_delta,
               earned_delta, earned_convertible_delta, balance_after, created_at
        from public.credit_transactions
        where owner_id = v_user
        order by created_at desc
        limit 50
      ) t
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from (
        select id, title, body, notification_type, read_at, metadata, created_at
        from public.user_notifications
        where owner_id = v_user
        order by created_at desc
        limit 40
      ) n
    ), '[]'::jsonb),
    'purchases', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at desc)
      from (
        select dp.id, dp.document_id, dp.credits_spent, dp.status, dp.created_at,
               d.title, d.course_name, d.professor, d.academic_year,
               d.page_count, d.degree_course, d.degree_slug, d.university,
               d.owner_id as author_id
        from public.document_purchases dp
        join public.documents d on d.id = dp.document_id
        where dp.buyer_id = v_user and dp.status = 'active'
        order by dp.created_at desc
        limit 100
      ) p
    ), '[]'::jsonb),
    'library', coalesce((
      select jsonb_agg(to_jsonb(li) order by li.updated_at desc)
      from (
        select uli.id, uli.document_id, uli.relation, uli.note,
               uli.created_at, uli.updated_at, d.title, d.course_name,
               d.professor, d.academic_year, d.page_count, d.degree_course,
               d.degree_slug, d.university, d.owner_id as author_id
        from public.user_library_items uli
        join public.documents d on d.id = uli.document_id
        where uli.owner_id = v_user
        order by uli.updated_at desc
        limit 200
      ) li
    ), '[]'::jsonb),
    'study_sessions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.started_at desc)
      from (
        select ss.id, ss.document_id, ss.subject, ss.session_type,
               ss.duration_seconds, ss.cards_reviewed, ss.quiz_questions,
               ss.correct_answers, ss.started_at, ss.finished_at,
               d.title as document_title
        from public.study_sessions ss
        left join public.documents d on d.id = ss.document_id
        where ss.owner_id = v_user
        order by ss.started_at desc
        limit 30
      ) s
    ), '[]'::jsonb),
    'document_progress', coalesce((
      select jsonb_agg(to_jsonb(dp) order by dp.updated_at desc)
      from (
        select dsp.id, dsp.document_id, dsp.progress_percent, dsp.last_page,
               dsp.flashcards_total, dsp.flashcards_mastered,
               dsp.quiz_accuracy, dsp.last_studied_at, dsp.updated_at,
               d.title, d.course_name, d.professor, d.page_count
        from public.document_study_progress dsp
        join public.documents d on d.id = dsp.document_id
        where dsp.owner_id = v_user
        order by dsp.updated_at desc
        limit 100
      ) dp
    ), '[]'::jsonb),
    'subject_progress', coalesce((
      select jsonb_agg(to_jsonb(sp) order by sp.updated_at desc)
      from (
        select id, subject, progress_percent, documents_count, due_reviews,
               average_accuracy, updated_at
        from public.subject_study_progress
        where owner_id = v_user
        order by updated_at desc
        limit 100
      ) sp
    ), '[]'::jsonb),
    'review_tasks', coalesce((
      select jsonb_agg(to_jsonb(rt) order by rt.due_at asc)
      from (
        select id, document_id, flashcard_id, subject, title, due_at,
               priority, status, updated_at
        from public.review_tasks
        where owner_id = v_user and status in ('open', 'snoozed')
        order by due_at asc
        limit 100
      ) rt
    ), '[]'::jsonb),
    'owned_documents', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.updated_at desc)
      from (
        select id, title, course_name, degree_course, degree_slug, professor,
               page_count, visibility, compression_status, flashcard_status,
               rag_status, rag_chunk_count, analysis_status, analysis_progress,
               analysis_stage, analysis_error_code, analysis_updated_at,
               processing_version, created_at, updated_at
        from public.documents
        where owner_id = v_user
        order by updated_at desc
        limit 100
      ) d
    ), '[]'::jsonb),
    'seller', jsonb_build_object(
      'enabled', coalesce((
        select seller_profile_enabled from public.profiles where id = v_user
      ), false),
      'published_documents', (
        select count(*) from public.documents
        where owner_id = v_user and visibility = 'published'
      ),
      'active_sales', (
        select count(*) from public.document_purchases
        where seller_id = v_user and status = 'active'
      ),
      'credits_earned', coalesce((
        select sum(seller_convertible_credits + seller_nonconvertible_credits)
        from public.document_purchases
        where seller_id = v_user and status = 'active'
      ), 0),
      'cash_backing_minor', coalesce((
        select sum(seller_cash_minor)
        from public.document_purchases
        where seller_id = v_user and status = 'active'
      ), 0)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_user_dashboard_snapshot() from public, anon;
grant execute on function public.get_user_dashboard_snapshot() to authenticated, service_role;

comment on function public.get_user_dashboard_snapshot() is
  'Owner-scoped read model for the authenticated personal dashboard.';

do $$
declare
  v_function_security_definer boolean;
begin
  select p.prosecdef
    into v_function_security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_user_dashboard_snapshot'
    and pg_get_function_identity_arguments(p.oid) = '';

  if coalesce(v_function_security_definer, true) then
    raise exception 'dashboard_snapshot_must_be_security_invoker' using errcode = '42501';
  end if;
end;
$$;
