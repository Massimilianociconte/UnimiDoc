-- ============================================================================
-- Audit fixes batch (2026-07-25)
-- 1) SRS: record_flashcard_study_event_internal must not wipe next_due_at when
--    the caller passes p_next_due_at = null (quiz/occlusion paths do exactly
--    that and were resetting the SM-2 due date on every answer).
-- 2) document_reviews UPDATE policy: WITH CHECK must replicate the INSERT
--    conditions, otherwise an existing review can be re-pointed/kept valid on
--    documents the reviewer never purchased or that are no longer published.
-- 3) Seller clawback: when a published document is withdrawn or rejected by
--    moderation, active purchases are revoked, buyers are refunded with
--    spend-only promotional credits and the still-unspent seller earnings for
--    those sales are clawed back.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) SRS upsert: preserve next_due_at when the event carries none
-- ---------------------------------------------------------------------------
create or replace function public.record_flashcard_study_event_internal(
  p_flashcard_id uuid,
  p_answer_status text,
  p_next_due_at timestamptz default null,
  p_last_reviewed_at timestamptz default now()
) returns public.user_flashcard_progress
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_card record;
  v_row public.user_flashcard_progress;
  v_status text := coalesce(p_answer_status, 'skipped');
  v_needs_review boolean;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if v_status not in ('correct', 'incorrect', 'partial', 'unknown', 'skipped', 'unanswered') then
    raise exception 'invalid_answer_status' using errcode = '22023';
  end if;

  select
    f.id,
    f.document_id,
    f.owner_id,
    f.front,
    f.back,
    f.difficulty,
    f.source_page_start,
    f.source_page_end,
    f.tags,
    f.subject,
    f.chapter_title,
    f.section_title,
    f.topic,
    d.title as document_title,
    d.owner_id as document_author_id,
    coalesce(p.full_name, d.owner_id::text) as document_author_name,
    d.course_name as document_subject
  into v_card
  from public.flashcards f
  join public.documents d on d.id = f.document_id
  left join public.profiles p on p.id = d.owner_id
  where f.id = p_flashcard_id
    and f.status <> 'deleted';

  if not found or not public.user_can_access_flashcard(p_flashcard_id) then
    raise exception 'flashcard_not_accessible' using errcode = 'P0001';
  end if;

  v_status := case when v_status = 'unknown' then 'incorrect' else v_status end;
  v_needs_review := v_status in ('incorrect', 'partial', 'skipped') or (p_next_due_at is not null and p_next_due_at <= now());

  insert into public.user_flashcard_progress (
    owner_id,
    flashcard_id,
    document_id,
    document_title,
    document_author_id,
    document_author_name,
    subject,
    chapter_title,
    section_title,
    topic,
    question,
    answer,
    latest_status,
    attempts_count,
    correct_count,
    incorrect_count,
    partial_count,
    skipped_count,
    last_reviewed_at,
    next_due_at,
    difficulty,
    needs_review,
    source_page_start,
    source_page_end,
    tags
  ) values (
    v_user,
    v_card.id,
    v_card.document_id,
    v_card.document_title,
    v_card.document_author_id,
    v_card.document_author_name,
    coalesce(v_card.subject, v_card.document_subject),
    v_card.chapter_title,
    v_card.section_title,
    v_card.topic,
    v_card.front,
    v_card.back,
    v_status,
    case when v_status = 'unanswered' then 0 else 1 end,
    case when v_status = 'correct' then 1 else 0 end,
    case when v_status = 'incorrect' then 1 else 0 end,
    case when v_status = 'partial' then 1 else 0 end,
    case when v_status = 'skipped' then 1 else 0 end,
    case when v_status = 'unanswered' then null else p_last_reviewed_at end,
    p_next_due_at,
    coalesce(v_card.difficulty, 'medium'),
    v_needs_review,
    v_card.source_page_start,
    v_card.source_page_end,
    coalesce(v_card.tags, '{}')
  )
  on conflict (owner_id, flashcard_id) do update set
    document_id = excluded.document_id,
    document_title = excluded.document_title,
    document_author_id = excluded.document_author_id,
    document_author_name = excluded.document_author_name,
    subject = excluded.subject,
    chapter_title = excluded.chapter_title,
    section_title = excluded.section_title,
    topic = excluded.topic,
    question = excluded.question,
    answer = excluded.answer,
    latest_status = excluded.latest_status,
    attempts_count = user_flashcard_progress.attempts_count + excluded.attempts_count,
    correct_count = user_flashcard_progress.correct_count + excluded.correct_count,
    incorrect_count = user_flashcard_progress.incorrect_count + excluded.incorrect_count,
    partial_count = user_flashcard_progress.partial_count + excluded.partial_count,
    skipped_count = user_flashcard_progress.skipped_count + excluded.skipped_count,
    last_reviewed_at = coalesce(excluded.last_reviewed_at, user_flashcard_progress.last_reviewed_at),
    -- FIX: an event without an SRS payload (quiz/occlusion answers pass null)
    -- must not erase the scheduled due date computed by the SRS engine.
    next_due_at = coalesce(excluded.next_due_at, user_flashcard_progress.next_due_at),
    difficulty = excluded.difficulty,
    -- FIX: recompute against the effective (possibly preserved) due date.
    needs_review = (excluded.latest_status in ('incorrect', 'partial', 'skipped'))
      or coalesce(coalesce(excluded.next_due_at, user_flashcard_progress.next_due_at) <= now(), false),
    source_page_start = excluded.source_page_start,
    source_page_end = excluded.source_page_end,
    tags = excluded.tags
  returning * into v_row;

  insert into public.document_study_progress (
    owner_id,
    document_id,
    flashcards_total,
    flashcards_mastered,
    quiz_accuracy,
    last_studied_at
  )
  select
    v_user,
    v_card.document_id,
    count(*),
    count(*) filter (where latest_status = 'correct'),
    case when count(*) filter (where latest_status in ('correct','incorrect','partial')) = 0 then null
      else round((count(*) filter (where latest_status = 'correct'))::numeric * 100 / (count(*) filter (where latest_status in ('correct','incorrect','partial'))), 2)
    end,
    now()
  from public.user_flashcard_progress
  where owner_id = v_user and document_id = v_card.document_id
  on conflict (owner_id, document_id) do update set
    flashcards_total = excluded.flashcards_total,
    flashcards_mastered = excluded.flashcards_mastered,
    quiz_accuracy = excluded.quiz_accuracy,
    last_studied_at = excluded.last_studied_at;

  insert into public.subject_study_progress (
    owner_id,
    subject,
    documents_count,
    due_reviews,
    average_accuracy
  )
  select
    v_user,
    coalesce(v_row.subject, 'Senza materia'),
    count(distinct document_id),
    count(*) filter (where needs_review),
    case when count(*) filter (where latest_status in ('correct','incorrect','partial')) = 0 then null
      else round((count(*) filter (where latest_status = 'correct'))::numeric * 100 / (count(*) filter (where latest_status in ('correct','incorrect','partial'))), 2)
    end
  from public.user_flashcard_progress
  where owner_id = v_user and subject = coalesce(v_row.subject, 'Senza materia')
  on conflict (owner_id, subject) do update set
    documents_count = excluded.documents_count,
    due_reviews = excluded.due_reviews,
    average_accuracy = excluded.average_accuracy;

  return v_row;
end;
$$;

revoke all on function public.record_flashcard_study_event_internal(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_flashcard_study_event_internal(uuid, text, timestamptz, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2) document_reviews UPDATE policy mirrors the INSERT conditions
-- ---------------------------------------------------------------------------
drop policy if exists document_reviews_update on public.document_reviews;
create policy document_reviews_update on public.document_reviews
  for update to authenticated
  using (reviewer_id = auth.uid())
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.documents d
      where d.id = document_reviews.document_id
        and d.visibility = 'published'
        and d.owner_id <> auth.uid()
    )
    and (
      exists (
        select 1 from public.document_purchases p
        where p.document_id = document_reviews.document_id
          and p.buyer_id = auth.uid()
          and p.status = 'active'
      )
      or exists (
        select 1 from public.documents d
        where d.id = document_reviews.document_id and coalesce(d.price_credits, 0) = 0
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Clawback on withdrawn/rejected documents
-- ---------------------------------------------------------------------------
create or replace function public.claw_back_document_sales(
  p_document_id uuid,
  p_reason text default 'moderazione'
) returns jsonb
language plpgsql
security definer
set search_path = public, billing, pg_temp
as $$
declare
  v_purchase public.document_purchases;
  v_lot public.credit_lots;
  v_claw_convertible integer;
  v_claw_nonconvertible integer;
  v_claw_total integer;
  v_cash_claw integer;
  v_revoked integer := 0;
  v_refunded_credits bigint := 0;
  v_clawed_credits bigint := 0;
begin
  for v_purchase in
    select * from public.document_purchases
    where document_id = p_document_id and status = 'active'
    for update
  loop
    update public.document_purchases
    set status = 'revoked',
        refunded_at = coalesce(refunded_at, now()),
        accounting_metadata = accounting_metadata || jsonb_build_object(
          'access_revoked_by', 'document_clawback',
          'access_revoked_at', now(),
          'clawback_reason', p_reason
        )
    where id = v_purchase.id;
    v_revoked := v_revoked + 1;

    -- Buyer refund: full price back as spend-only promotional credits (never
    -- cash-backed, so a moderated document can't be used to mint payouts).
    if v_purchase.credits_spent > 0 then
      insert into public.user_credit_accounts (
        owner_id, balance, free_credits, promotional_credits, purchased_credits, earned_credits
      ) values (v_purchase.buyer_id, 0, 0, 0, 0, 0)
      on conflict (owner_id) do nothing;

      insert into public.credit_lots (
        owner_id, bucket, origin, source_key, units_granted, units_remaining
      ) values (
        v_purchase.buyer_id, 'promotional', 'reward',
        'clawback:refund:' || v_purchase.id::text,
        v_purchase.credits_spent, v_purchase.credits_spent
      ) on conflict (owner_id, source_key) do nothing;

      if found then
        update public.user_credit_accounts
        set promotional_credits = promotional_credits + v_purchase.credits_spent,
            balance = balance + v_purchase.credits_spent,
            updated_at = now()
        where owner_id = v_purchase.buyer_id;

        insert into public.credit_transactions (
          owner_id, document_id, purchase_id, direction, amount, reason,
          idempotency_key, promotional_delta, balance_after, metadata
        ) values (
          v_purchase.buyer_id, p_document_id, v_purchase.id, 'refunded',
          v_purchase.credits_spent, 'Rimborso documento ritirato',
          'clawback:refund:' || v_purchase.id::text,
          v_purchase.credits_spent,
          (select balance from public.user_credit_accounts where owner_id = v_purchase.buyer_id),
          jsonb_build_object('clawback_reason', p_reason)
        ) on conflict (owner_id, idempotency_key) where idempotency_key is not null do nothing;

        v_refunded_credits := v_refunded_credits + v_purchase.credits_spent;
      end if;
    end if;

    -- Seller clawback: only what is still unspent in the sale lots; credits
    -- already consumed elsewhere are left alone (no negative balances).
    v_claw_convertible := 0;
    v_claw_nonconvertible := 0;
    v_cash_claw := 0;

    if v_purchase.seller_id is not null then
      select * into v_lot from public.credit_lots
      where owner_id = v_purchase.seller_id
        and source_key = 'sale:' || v_purchase.id::text || ':convertible'
      for update;
      if found and v_lot.units_remaining > 0 then
        v_claw_convertible := v_lot.units_remaining;
        v_cash_claw := v_lot.cash_remaining_minor;
        update public.credit_lots
        set units_remaining = 0,
            cash_remaining_minor = 0,
            status = 'reversed',
            updated_at = now()
        where id = v_lot.id;
      end if;

      select * into v_lot from public.credit_lots
      where owner_id = v_purchase.seller_id
        and source_key = 'sale:' || v_purchase.id::text || ':nonconvertible'
      for update;
      if found and v_lot.units_remaining > 0 then
        v_claw_nonconvertible := v_lot.units_remaining;
        update public.credit_lots
        set units_remaining = 0,
            status = 'reversed',
            updated_at = now()
        where id = v_lot.id;
      end if;

      v_claw_total := v_claw_convertible + v_claw_nonconvertible;
      if v_claw_total > 0 then
        update public.user_credit_accounts
        set earned_credits = earned_credits - v_claw_total,
            earned_convertible = earned_convertible - v_claw_convertible,
            balance = balance - v_claw_total,
            updated_at = now()
        where owner_id = v_purchase.seller_id;

        insert into public.credit_transactions (
          owner_id, document_id, purchase_id, direction, amount, reason,
          idempotency_key, earned_delta, earned_convertible_delta, balance_after, metadata
        ) values (
          v_purchase.seller_id, p_document_id, v_purchase.id, 'adjusted',
          v_claw_total, 'Storno vendita documento ritirato',
          'clawback:seller:' || v_purchase.id::text,
          -v_claw_total, -v_claw_convertible,
          (select balance from public.user_credit_accounts where owner_id = v_purchase.seller_id),
          jsonb_build_object('clawback_reason', p_reason, 'cash_clawed_minor', v_cash_claw)
        ) on conflict (owner_id, idempotency_key) where idempotency_key is not null do nothing;

        v_clawed_credits := v_clawed_credits + v_claw_total;
      end if;

      -- Reverse the still-unpaid cash earning tied to this sale.
      if v_claw_convertible > 0 or v_cash_claw > 0 then
        update billing.seller_earnings
        set reversed_minor = least(amount_minor - reserved_minor - transferred_minor, reversed_minor + v_cash_claw),
            reversed_credits = least(
              convertible_credits - reserved_credits - transferred_credits,
              reversed_credits + v_claw_convertible
            ),
            status = case
              when least(amount_minor - reserved_minor - transferred_minor, reversed_minor + v_cash_claw)
                >= amount_minor - reserved_minor - transferred_minor then 'reversed'
              else status
            end,
            reversed_at = now(),
            updated_at = now()
        where purchase_id = v_purchase.id
          and status in ('pending', 'available');
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'purchases_revoked', v_revoked,
    'buyer_credits_refunded', v_refunded_credits,
    'seller_credits_clawed', v_clawed_credits
  );
end;
$$;

revoke all on function public.claw_back_document_sales(uuid, text) from public, anon, authenticated;
grant execute on function public.claw_back_document_sales(uuid, text) to service_role;

-- Fire automatically whenever moderation rejects or withdraws a published doc.
create or replace function public.claw_back_on_document_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, billing, pg_temp
as $$
begin
  perform public.claw_back_document_sales(
    new.id,
    case when new.visibility = 'rejected' then 'moderazione' else 'ritiro' end
  );
  return new;
end;
$$;

drop trigger if exists documents_clawback_on_withdrawal on public.documents;
create trigger documents_clawback_on_withdrawal
  after update of visibility on public.documents
  for each row
  when (old.visibility = 'published' and new.visibility in ('rejected', 'private'))
  execute function public.claw_back_on_document_withdrawal();
