-- ============================================================================
-- Production hardening batch (2026-07-19)
-- 1) Refund/chargeback revokes document purchases funded by reversed paid lots
-- 2) purchase_document only idempotent on ACTIVE purchases; re-buy after revoke
-- 3) Public search/rankings redact seller UUID unless opt-in public profile
-- 4) Storage GC also enqueues document_assets (+ processing-temp on hard delete)
-- 5) Buyers can list flashcards for documents they can access (RPC)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Active-only uniqueness for purchases (allow historical revoked rows)
-- ---------------------------------------------------------------------------
alter table public.document_purchases
  drop constraint if exists document_purchases_document_id_buyer_id_key;

create unique index if not exists document_purchases_active_buyer_doc_uidx
  on public.document_purchases (document_id, buyer_id)
  where status = 'active';

create index if not exists document_purchases_buyer_doc_status_idx
  on public.document_purchases (buyer_id, document_id, status);

-- ---------------------------------------------------------------------------
-- 2) purchase_document: active-only idempotency
-- ---------------------------------------------------------------------------
create or replace function public.purchase_document(p_document_id uuid)
returns public.document_purchases
language plpgsql
security definer
set search_path = public, billing, pg_temp
as $$
declare
  v_buyer uuid := auth.uid();
  v_document public.documents;
  v_purchase public.document_purchases;
  v_price integer;
  v_free integer;
  v_promotional integer;
  v_purchased integer;
  v_earned integer;
  v_earned_convertible integer;
  v_use_free integer;
  v_use_promotional integer;
  v_use_purchased integer;
  v_use_earned_nonconvertible integer;
  v_use_earned_convertible integer;
  v_remaining integer;
  v_purchased_result record;
  v_earned_convertible_result record;
  v_cash_backing bigint := 0;
  v_backed_units integer := 0;
  v_commission_bps integer;
  v_seller_convertible integer;
  v_seller_nonconvertible integer;
  v_seller_cash integer;
  v_hold_days integer;
  v_currency text;
  v_seller_subject uuid;
begin
  if v_buyer is null then raise exception 'auth_required' using errcode = '28000'; end if;

  select * into v_document from public.documents where id = p_document_id;
  if not found then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if v_document.owner_id = v_buyer then raise exception 'own_document' using errcode = 'P0001'; end if;
  if v_document.visibility <> 'published' then raise exception 'not_purchasable' using errcode = 'P0001'; end if;

  -- Idempotent only while access is active. Revoked/refunded rows do not block re-buy.
  select * into v_purchase
  from public.document_purchases
  where document_id = p_document_id
    and buyer_id = v_buyer
    and status = 'active';
  if found then return v_purchase; end if;

  v_price := coalesce(v_document.price_credits, 0);
  if v_price <= 0 then raise exception 'price_unavailable' using errcode = 'P0001'; end if;

  select free_credits, promotional_credits, purchased_credits, earned_credits, earned_convertible
  into v_free, v_promotional, v_purchased, v_earned, v_earned_convertible
  from public.user_credit_accounts
  where owner_id = v_buyer
  for update;
  if not found then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;

  select * into v_purchase
  from public.document_purchases
  where document_id = p_document_id
    and buyer_id = v_buyer
    and status = 'active';
  if found then return v_purchase; end if;

  if (case when v_price <= 30 then v_free else 0 end)
      + v_promotional + v_purchased + v_earned < v_price then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  v_remaining := v_price;
  v_use_free := least(case when v_price <= 30 then v_free else 0 end, v_remaining);
  v_remaining := v_remaining - v_use_free;
  v_use_promotional := least(v_promotional, v_remaining);
  v_remaining := v_remaining - v_use_promotional;
  v_use_purchased := least(v_purchased, v_remaining);
  v_remaining := v_remaining - v_use_purchased;
  v_use_earned_nonconvertible := least(v_earned - v_earned_convertible, v_remaining);
  v_remaining := v_remaining - v_use_earned_nonconvertible;
  v_use_earned_convertible := v_remaining;

  select commission_bps, seller_hold_days, currency
  into v_commission_bps, v_hold_days, v_currency
  from billing.settings where id = 1;
  if not found then raise exception 'billing_settings_missing' using errcode = 'P0001'; end if;

  insert into public.document_purchases (
    document_id, buyer_id, seller_id, credits_spent, price_credits_snapshot,
    free_credits_spent, promotional_credits_spent, purchased_credits_spent,
    earned_credits_spent, unattributed_credits_spent, currency, commission_bps,
    economy_version, accounting_metadata, status
  ) values (
    p_document_id, v_buyer, v_document.owner_id, v_price, v_price,
    v_use_free, v_use_promotional, v_use_purchased,
    v_use_earned_nonconvertible + v_use_earned_convertible, 0, v_currency, v_commission_bps,
    'credits_v2_lots',
    jsonb_build_object(
      'earned_nonconvertible', v_use_earned_nonconvertible,
      'earned_convertible', v_use_earned_convertible
    ),
    'active'
  ) returning * into v_purchase;

  perform * from billing.consume_credit_lots(v_buyer, v_purchase.id, 'free', v_use_free);
  perform * from billing.consume_credit_lots(v_buyer, v_purchase.id, 'promotional', v_use_promotional);
  select * into v_purchased_result
    from billing.consume_credit_lots(v_buyer, v_purchase.id, 'purchased', v_use_purchased);
  perform * from billing.consume_credit_lots(v_buyer, v_purchase.id, 'earned_nonconvertible', v_use_earned_nonconvertible);
  select * into v_earned_convertible_result
    from billing.consume_credit_lots(v_buyer, v_purchase.id, 'earned_convertible', v_use_earned_convertible);

  v_cash_backing := coalesce(v_purchased_result.cash_minor, 0)
    + coalesce(v_earned_convertible_result.cash_minor, 0);
  v_backed_units := coalesce(v_purchased_result.backed_units, 0)
    + coalesce(v_earned_convertible_result.backed_units, 0);
  v_seller_convertible := floor(v_backed_units::numeric * (10000 - v_commission_bps) / 10000)::integer;
  v_seller_nonconvertible := floor((v_price - v_backed_units)::numeric * (10000 - v_commission_bps) / 10000)::integer;
  v_seller_cash := least(
    floor(v_cash_backing::numeric * (10000 - v_commission_bps) / 10000)::integer,
    v_seller_convertible * 10
  );

  update public.user_credit_accounts
  set free_credits = free_credits - v_use_free,
      promotional_credits = promotional_credits - v_use_promotional,
      purchased_credits = purchased_credits - v_use_purchased,
      earned_credits = earned_credits - v_use_earned_nonconvertible - v_use_earned_convertible,
      earned_convertible = earned_convertible - v_use_earned_convertible,
      balance = balance - v_price,
      lifetime_spent = lifetime_spent + v_price,
      updated_at = now()
  where owner_id = v_buyer;

  insert into public.credit_transactions (
    owner_id, document_id, purchase_id, direction, amount, reason,
    idempotency_key, free_delta, promotional_delta, purchased_delta,
    earned_delta, earned_convertible_delta, balance_after, metadata
  ) values (
    v_buyer, p_document_id, v_purchase.id, 'spent', v_price, 'Acquisto documento',
    'purchase:' || v_purchase.id::text,
    -v_use_free, -v_use_promotional, -v_use_purchased,
    -(v_use_earned_nonconvertible + v_use_earned_convertible), -v_use_earned_convertible,
    (select balance from public.user_credit_accounts where owner_id = v_buyer),
    jsonb_build_object(
      'free_credits', v_use_free,
      'promotional_credits', v_use_promotional,
      'purchased_credits', v_use_purchased,
      'earned_nonconvertible', v_use_earned_nonconvertible,
      'earned_convertible', v_use_earned_convertible,
      'cash_backing_minor', v_cash_backing,
      'currency', v_currency
    )
  );

  if v_seller_convertible + v_seller_nonconvertible > 0 then
    insert into public.user_credit_accounts (
      owner_id, balance, free_credits, promotional_credits, purchased_credits, earned_credits
    ) values (v_document.owner_id, 0, 0, 0, 0, 0)
    on conflict (owner_id) do nothing;

    update public.user_credit_accounts
    set earned_credits = earned_credits + v_seller_convertible + v_seller_nonconvertible,
        earned_convertible = earned_convertible + v_seller_convertible,
        balance = balance + v_seller_convertible + v_seller_nonconvertible,
        lifetime_earned = lifetime_earned + v_seller_convertible + v_seller_nonconvertible,
        updated_at = now()
    where owner_id = v_document.owner_id;

    if v_seller_convertible > 0 then
      insert into public.credit_lots (
        owner_id, bucket, origin, source_key, units_granted, units_remaining,
        cash_backing_minor, cash_remaining_minor, currency, cash_convertible
      ) values (
        v_document.owner_id, 'earned_convertible', 'seller_convertible',
        'sale:' || v_purchase.id::text || ':convertible',
        v_seller_convertible, v_seller_convertible,
        v_seller_cash, v_seller_cash, v_currency, true
      );
    end if;
    if v_seller_nonconvertible > 0 then
      insert into public.credit_lots (
        owner_id, bucket, origin, source_key, units_granted, units_remaining
      ) values (
        v_document.owner_id, 'earned_nonconvertible', 'seller_nonconvertible',
        'sale:' || v_purchase.id::text || ':nonconvertible',
        v_seller_nonconvertible, v_seller_nonconvertible
      );
    end if;

    insert into public.credit_transactions (
      owner_id, document_id, purchase_id, direction, amount, reason,
      idempotency_key, earned_delta, earned_convertible_delta, balance_after, metadata
    ) values (
      v_document.owner_id, p_document_id, v_purchase.id, 'earned',
      v_seller_convertible + v_seller_nonconvertible, 'Vendita documento',
      'sale:' || v_purchase.id::text,
      v_seller_convertible + v_seller_nonconvertible, v_seller_convertible,
      (select balance from public.user_credit_accounts where owner_id = v_document.owner_id),
      jsonb_build_object(
        'convertible', v_seller_convertible,
        'non_convertible', v_seller_nonconvertible,
        'cash_backing_minor', v_seller_cash,
        'hold_days', v_hold_days,
        'commission_bps', v_commission_bps
      )
    );
  end if;

  v_seller_subject := v_document.owner_id;
  if v_seller_cash > 0 and v_seller_convertible > 0 then
    insert into billing.seller_earnings (
      seller_id, seller_subject_reference, purchase_id, document_id,
      gross_backing_minor, commission_bps, amount_minor,
      convertible_credits, currency, hold_until
    ) values (
      v_document.owner_id, v_seller_subject, v_purchase.id, p_document_id,
      v_cash_backing, v_commission_bps, v_seller_cash,
      v_seller_convertible, v_currency, now() + make_interval(days => v_hold_days)
    );
  end if;

  update public.document_purchases
  set cash_backing_minor = v_cash_backing,
      seller_convertible_credits = v_seller_convertible,
      seller_nonconvertible_credits = v_seller_nonconvertible,
      seller_cash_minor = v_seller_cash,
      accounting_metadata = accounting_metadata || jsonb_build_object(
        'cash_backed_units', v_backed_units,
        'seller_hold_days', v_hold_days
      )
  where id = v_purchase.id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

revoke all on function public.purchase_document(uuid) from public, anon;
grant execute on function public.purchase_document(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Refund / dispute: revoke purchases funded by the reversed paid lot
-- ---------------------------------------------------------------------------
create or replace function billing.apply_payment_reversal(
  p_payment uuid,
  p_source_type text,
  p_source_id uuid,
  p_amount_minor integer,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_payment billing.payments;
  v_checkout billing.checkout_requests;
  v_paid_lot public.credit_lots;
  v_promo_lot public.credit_lots;
  v_paid_target integer;
  v_promo_target integer;
  v_paid_revoke integer := 0;
  v_promo_revoke integer := 0;
  v_cash_revoke integer := 0;
  v_debt integer := 0;
  v_transaction uuid;
  v_earning record;
  v_reverse_minor integer;
  v_available_minor integer;
  v_revoked_count integer := 0;
  v_purchase_status text;
begin
  if p_source_type not in ('refund', 'dispute') or p_amount_minor <= 0 then
    raise exception 'billing_reversal_invalid' using errcode = '22023';
  end if;

  select * into v_payment from billing.payments where id = p_payment for update;
  if not found then raise exception 'billing_payment_not_found' using errcode = 'P0002'; end if;
  select * into v_checkout from billing.checkout_requests where id = v_payment.checkout_request_id for update;
  if not found or v_checkout.kind <> 'topup' then
    raise exception 'billing_reversal_not_topup' using errcode = 'P0001';
  end if;
  if v_checkout.owner_id is null then
    return jsonb_build_object('wallet_debit_credits', 0, 'unapplied_debt_minor', p_amount_minor);
  end if;

  v_paid_target := case
    when p_amount_minor >= v_payment.amount_minor then v_checkout.paid_credits
    else floor(v_checkout.paid_credits::numeric * p_amount_minor / v_payment.amount_minor)::integer
  end;
  v_promo_target := case
    when p_amount_minor >= v_payment.amount_minor then v_checkout.promotional_credits
    else floor(v_checkout.promotional_credits::numeric * p_amount_minor / v_payment.amount_minor)::integer
  end;

  select * into v_paid_lot
  from public.credit_lots
  where owner_id = v_checkout.owner_id
    and source_key = 'stripe:checkout:' || v_checkout.stripe_checkout_session_id || ':paid'
  for update;
  if found then
    v_paid_revoke := least(v_paid_target, v_paid_lot.units_remaining);
    v_cash_revoke := case
      when v_paid_revoke = v_paid_lot.units_remaining then v_paid_lot.cash_remaining_minor
      else least(v_paid_lot.cash_remaining_minor, v_paid_revoke * 10)
    end;
    update public.credit_lots
    set units_remaining = units_remaining - v_paid_revoke,
        cash_remaining_minor = cash_remaining_minor - v_cash_revoke,
        status = case when units_remaining - v_paid_revoke = 0 then 'reversed' else status end,
        updated_at = now()
    where id = v_paid_lot.id;
  end if;

  select * into v_promo_lot
  from public.credit_lots
  where owner_id = v_checkout.owner_id
    and source_key = 'stripe:checkout:' || v_checkout.stripe_checkout_session_id || ':promo'
  for update;
  if found then
    v_promo_revoke := least(v_promo_target, v_promo_lot.units_remaining);
    update public.credit_lots
    set units_remaining = units_remaining - v_promo_revoke,
        status = case when units_remaining - v_promo_revoke = 0 then 'reversed' else status end,
        updated_at = now()
    where id = v_promo_lot.id;
  end if;

  if v_paid_revoke + v_promo_revoke > 0 then
    update public.user_credit_accounts
    set purchased_credits = purchased_credits - v_paid_revoke,
        promotional_credits = promotional_credits - v_promo_revoke,
        balance = balance - v_paid_revoke - v_promo_revoke,
        updated_at = now()
    where owner_id = v_checkout.owner_id;

    insert into public.credit_transactions (
      owner_id, direction, amount, reason, idempotency_key, provider,
      provider_object_id, promotional_delta, purchased_delta, balance_after, metadata
    ) values (
      v_checkout.owner_id,
      case when p_source_type = 'refund' then 'refunded' else 'charged_back' end,
      v_paid_revoke + v_promo_revoke,
      case when p_source_type = 'refund' then 'Rimborso pagamento' else 'Contestazione pagamento' end,
      p_idempotency_key, 'stripe', p_source_id::text,
      -v_promo_revoke, -v_paid_revoke,
      (select balance from public.user_credit_accounts where owner_id = v_checkout.owner_id),
      jsonb_build_object('amount_minor', p_amount_minor, 'cash_removed_minor', v_cash_revoke)
    ) returning id into v_transaction;
  end if;

  v_debt := greatest(0, p_amount_minor - v_cash_revoke);
  if v_debt > 0 then
    insert into billing.credit_debts (
      owner_id, subject_reference, source_type, source_id, amount_minor, currency
    ) values (
      v_checkout.owner_id, v_checkout.subject_reference, p_source_type, p_source_id,
      v_debt, v_payment.currency
    ) on conflict (source_type, source_id, subject_reference) do update
      set amount_minor = greatest(billing.credit_debts.amount_minor, excluded.amount_minor);
  end if;

  if v_paid_lot.id is not null then
    for v_earning in
      select earning.id, earning.seller_id, earning.seller_subject_reference,
        earning.purchase_id, earning.amount_minor, earning.commission_bps,
        earning.reserved_minor, earning.transferred_minor, earning.reversed_minor,
        (
          select coalesce(sum(allocation.cash_backing_minor), 0)::integer
          from public.credit_lot_allocations allocation
          where allocation.purchase_id = earning.purchase_id
            and allocation.lot_id = v_paid_lot.id
        ) as source_cash
      from billing.seller_earnings earning
      where exists (
        select 1 from public.credit_lot_allocations allocation
        where allocation.purchase_id = earning.purchase_id
          and allocation.lot_id = v_paid_lot.id
      )
      for update of earning
    loop
      v_reverse_minor := floor(
        v_earning.source_cash::numeric
        * (10000 - v_earning.commission_bps) / 10000
        * least(p_amount_minor, v_payment.amount_minor) / v_payment.amount_minor
      )::integer;
      v_available_minor := greatest(
        0,
        v_earning.amount_minor - v_earning.reserved_minor
          - v_earning.transferred_minor - v_earning.reversed_minor
      );
      v_reverse_minor := least(v_reverse_minor, v_available_minor);
      if v_reverse_minor > 0 then
        update billing.seller_earnings
        set reversed_minor = reversed_minor + v_reverse_minor,
            reversed_credits = least(
              convertible_credits - reserved_credits - transferred_credits,
              reversed_credits + floor(v_reverse_minor::numeric / 10)::integer
            ),
            status = case
              when reversed_minor + v_reverse_minor >= amount_minor - reserved_minor - transferred_minor
                then 'reversed'
              else status
            end,
            reversed_at = now(),
            updated_at = now()
        where id = v_earning.id;

        update public.credit_lots
        set cash_remaining_minor = greatest(0, cash_remaining_minor - v_reverse_minor),
            updated_at = now()
        where owner_id = v_earning.seller_id
          and source_key = 'sale:' || v_earning.purchase_id::text || ':convertible';
      end if;
    end loop;

    -- Access control: any document purchase funded by this paid lot loses access.
    -- Full payment reverse ⇒ refunded/revoked; partial reverse still revokes when
    -- the paid lot participated (cash is no longer fully backed).
    v_purchase_status := case when p_source_type = 'refund' then 'refunded' else 'revoked' end;
    update public.document_purchases purchase
    set status = v_purchase_status,
        refunded_at = coalesce(purchase.refunded_at, now()),
        accounting_metadata = purchase.accounting_metadata || jsonb_build_object(
          'access_revoked_by', p_source_type,
          'access_revoked_at', now(),
          'reversal_payment_id', p_payment,
          'reversal_source_id', p_source_id
        )
    where purchase.status = 'active'
      and exists (
        select 1
        from public.credit_lot_allocations allocation
        where allocation.purchase_id = purchase.id
          and allocation.lot_id = v_paid_lot.id
      );
    get diagnostics v_revoked_count = row_count;
  end if;

  return jsonb_build_object(
    'wallet_debit_credits', v_paid_revoke + v_promo_revoke,
    'unapplied_debt_minor', v_debt,
    'transaction_id', v_transaction,
    'purchases_revoked', coalesce(v_revoked_count, 0)
  );
end;
$$;

revoke all on function billing.apply_payment_reversal(uuid, text, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function billing.apply_payment_reversal(uuid, text, uuid, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4) search_documents: redact seller_id unless public seller profile
-- ---------------------------------------------------------------------------
create or replace function public.search_documents(
  p_query text default null,
  p_course text default null,
  p_professor text default null,
  p_university text default null,
  p_degree_slug text default null,
  p_academic_year text default null,
  p_seller uuid default null,
  p_exam_type text default null,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  id uuid,
  seller_id uuid,
  title text,
  course_name text,
  professor text,
  academic_year text,
  page_count int,
  language text,
  preview_policy text,
  description text,
  exam_type text,
  semester text,
  degree_course text,
  degree_slug text,
  university text,
  tags text[],
  price_credits int,
  created_at timestamptz,
  updated_at timestamptz,
  rank real,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with query as (
    select case
      when p_query is null or length(trim(p_query)) < 2 then null
      else websearch_to_tsquery('italian', p_query)
    end as ts
  ),
  base as (
    select d.*,
      case when q.ts is null then 0
        else ts_rank(
          to_tsvector('italian',
            coalesce(d.title, '') || ' ' ||
            coalesce(d.course_name, '') || ' ' ||
            coalesce(d.professor, '') || ' ' ||
            coalesce(d.description, '') || ' ' ||
            coalesce(d.degree_course, '')), q.ts)
      end::real as rank
    from public.documents d cross join query q
    where d.visibility = 'published'
      and (q.ts is null or to_tsvector('italian',
            coalesce(d.title, '') || ' ' ||
            coalesce(d.course_name, '') || ' ' ||
            coalesce(d.professor, '') || ' ' ||
            coalesce(d.description, '') || ' ' ||
            coalesce(d.degree_course, '')) @@ q.ts)
      and (p_course is null or d.course_name ilike p_course)
      and (p_professor is null or d.professor ilike '%' || p_professor || '%')
      and (p_university is null or d.university ilike p_university)
      and (p_degree_slug is null or d.degree_slug = p_degree_slug)
      and (p_academic_year is null or d.academic_year = p_academic_year)
      and (p_seller is null or d.owner_id = p_seller)
      and (p_exam_type is null or d.exam_type ilike p_exam_type)
  )
  select
    b.id,
    case
      when profile.seller_profile_enabled is true
        and profile.public_display_name is not null
        and length(trim(profile.public_display_name)) > 0
      then b.owner_id
      else null
    end as seller_id,
    b.title, b.course_name, b.professor,
    b.academic_year, b.page_count, b.language, b.preview_policy, b.description,
    b.exam_type, b.semester, b.degree_course, b.degree_slug, b.university,
    b.tags, b.price_credits, b.created_at, b.updated_at, b.rank,
    count(*) over () as total_count
  from base b
  left join public.profiles profile on profile.id = b.owner_id
  order by
    case when p_sort = 'recent' then b.created_at end desc,
    case when p_sort = 'price_asc' then b.price_credits end asc,
    case when p_sort = 'price_desc' then b.price_credits end desc,
    b.rank desc,
    b.created_at desc,
    b.id
  limit greatest(1, least(coalesce(p_limit, 24), 60))
  offset greatest(0, coalesce(p_offset, 0))
$$;

revoke all on function public.search_documents(text, text, text, text, text, text, uuid, text, text, int, int) from public;
grant execute on function public.search_documents(text, text, text, text, text, text, uuid, text, text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Ranking public projection: redact owner_id unless opt-in seller
-- ---------------------------------------------------------------------------
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
  select
    cache.document_id,
    case
      when profile.seller_profile_enabled is true
        and profile.public_display_name is not null
        and length(trim(profile.public_display_name)) > 0
      then cache.owner_id
      else null
    end as owner_id,
    cache.title, cache.course_name, cache.professor, cache.university,
    cache.degree_slug, cache.degree_course, cache.academic_year,
    cache.created_at, cache.updated_at,
    cache.review_count, cache.review_avg, cache.overall_score, cache.recent_score,
    cache.didactic_score, cache.sample_size
  from public.document_rankings_cache cache
  left join public.profiles profile on profile.id = cache.owner_id;
$$;

revoke all on function app_private.document_rankings_public_fn() from public;
grant execute on function app_private.document_rankings_public_fn() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Storage GC: document_assets + processing-temp on hard delete
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_document_storage_cleanup()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
begin
  -- Durable original (non-temp). Temp objects are also enqueued on hard delete
  -- so cancelled/abandoned drafts cannot leak forever.
  if old.storage_path is not null then
    insert into public.storage_cleanup_queue (bucket, path, document_id, owner_id)
    values (coalesce(old.storage_bucket, 'private-documents'), old.storage_path, old.id, old.owner_id);
  end if;

  insert into public.storage_cleanup_queue (bucket, path, document_id, owner_id)
  select coalesce(p.storage_bucket, 'derived-previews'), p.storage_path, old.id, old.owner_id
  from public.document_previews p
  where p.document_id = old.id
    and p.storage_path is not null;

  insert into public.storage_cleanup_queue (bucket, path, document_id, owner_id)
  select coalesce(a.storage_bucket, 'derived-previews'), a.storage_path, old.id, old.owner_id
  from public.document_assets a
  where a.document_id = old.id
    and a.storage_path is not null;

  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Flashcards accessible to owners + active buyers
-- ---------------------------------------------------------------------------
create or replace function public.list_accessible_flashcards(p_limit integer default 500)
returns table (
  id uuid,
  document_id uuid,
  front text,
  back text,
  tags text[],
  difficulty text,
  source_page_start integer,
  source_quote text,
  subject text,
  chapter_title text,
  section_title text,
  topic text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    f.id, f.document_id, f.front, f.back, f.tags, f.difficulty,
    f.source_page_start, f.source_quote, f.subject, f.chapter_title,
    f.section_title, f.topic, f.created_at
  from public.flashcards f
  where f.status is distinct from 'deleted'
    and auth.uid() is not null
    and (
      f.owner_id = (select auth.uid())
      or exists (
        select 1 from public.documents d
        where d.id = f.document_id and d.owner_id = (select auth.uid())
      )
      or exists (
        select 1 from public.document_purchases p
        where p.document_id = f.document_id
          and p.buyer_id = (select auth.uid())
          and p.status = 'active'
      )
    )
  order by f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.list_accessible_flashcards(integer) from public, anon;
grant execute on function public.list_accessible_flashcards(integer) to authenticated;
