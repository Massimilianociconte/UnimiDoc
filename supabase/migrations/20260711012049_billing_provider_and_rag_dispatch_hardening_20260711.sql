-- Provider-outcome safety and durable post-processing.
--
-- 1. A timeout/5xx after a Stripe transfer is not evidence of failure: keep
--    funds reserved and record a reconciliation-required provider attempt.
-- 2. A Stripe subscription grants Premium only when its Price/Product comes
--    from the authorized Checkout offer, or when it is an update for the exact
--    SKU of an already-authorized subscription.
-- 3. Completing document quality review materializes a durable rag_index job;
--    the run is complete only after that job succeeds.

create table if not exists billing.payout_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  payout_request_id uuid not null references billing.payout_requests(id) on delete restrict,
  attempt_no integer not null check (attempt_no > 0),
  idempotency_key text not null,
  outcome text not null default 'initiated'
    check (outcome in ('initiated', 'succeeded', 'definitive_failed', 'indeterminate')),
  stripe_transfer_id text,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (payout_request_id, attempt_no)
);

create index if not exists billing_payout_provider_attempts_outcome_idx
  on billing.payout_provider_attempts (outcome, started_at)
  where outcome in ('initiated', 'indeterminate');

alter table billing.payout_provider_attempts enable row level security;
revoke all on billing.payout_provider_attempts from public, anon, authenticated;
grant select, insert, update, delete on billing.payout_provider_attempts to service_role;

create or replace function public.billing_begin_payout_provider_attempt(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_payout billing.payout_requests;
  v_attempt billing.payout_provider_attempts;
  v_attempt_no integer;
begin
  select * into v_payout
  from billing.payout_requests
  where id = p_request
  for update;
  if not found then raise exception 'billing_payout_not_found' using errcode = 'P0002'; end if;
  if v_payout.status not in ('reserved', 'processing') then
    raise exception 'billing_payout_not_dispatchable' using errcode = 'P0001';
  end if;

  select coalesce(max(attempt.attempt_no), 0) + 1 into v_attempt_no
  from billing.payout_provider_attempts attempt
  where attempt.payout_request_id = p_request;

  insert into billing.payout_provider_attempts (
    payout_request_id, attempt_no, idempotency_key
  ) values (
    p_request, v_attempt_no, 'unimidoc-payout-' || p_request::text
  ) returning * into v_attempt;

  update billing.payout_requests
  set status = 'processing', updated_at = now()
  where id = p_request;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'attempt_no', v_attempt.attempt_no,
    'idempotency_key', v_attempt.idempotency_key
  );
end;
$$;

create or replace function public.billing_finish_payout_provider_attempt(
  p_attempt uuid,
  p_outcome text,
  p_stripe_transfer_id text default null,
  p_error_code text default null
) returns void
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_attempt billing.payout_provider_attempts;
begin
  if p_outcome not in ('succeeded', 'definitive_failed', 'indeterminate') then
    raise exception 'billing_payout_provider_outcome_invalid' using errcode = '22023';
  end if;
  if p_outcome = 'succeeded' and nullif(trim(p_stripe_transfer_id), '') is null then
    raise exception 'billing_payout_transfer_id_required' using errcode = '22023';
  end if;

  select * into v_attempt
  from billing.payout_provider_attempts
  where id = p_attempt
  for update;
  if not found then raise exception 'billing_payout_attempt_not_found' using errcode = 'P0002'; end if;

  update billing.payout_provider_attempts
  set outcome = p_outcome,
      stripe_transfer_id = nullif(trim(p_stripe_transfer_id), ''),
      error_code = left(nullif(trim(p_error_code), ''), 120),
      finished_at = now()
  where id = p_attempt;

  if p_outcome = 'indeterminate' then
    update billing.payout_requests
    set status = 'processing',
        failure_code = 'reconciliation_required',
        failure_message = 'Esito provider non determinabile: fondi ancora riservati.',
        updated_at = now()
    where id = v_attempt.payout_request_id
      and status in ('reserved', 'processing');
  elsif p_outcome = 'succeeded' then
    update billing.payout_requests
    set failure_code = null, failure_message = null, updated_at = now()
    where id = v_attempt.payout_request_id
      and status in ('reserved', 'processing');
  end if;
end;
$$;

revoke all on function public.billing_begin_payout_provider_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.billing_begin_payout_provider_attempt(uuid) to service_role;
revoke all on function public.billing_finish_payout_provider_attempt(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_finish_payout_provider_attempt(uuid, text, text, text)
  to service_role;

create or replace function public.billing_sync_subscription(
  p_stripe_subscription_id text,
  p_livemode boolean,
  p_stripe_customer_id text,
  p_stripe_product_id text,
  p_stripe_price_id text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_trial_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_event_created_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_subscription billing.subscriptions;
  v_checkout billing.checkout_requests;
  v_offer billing.offers;
  v_owner uuid;
  v_subject uuid;
  v_grant_status text;
begin
  if p_status not in (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due',
    'canceled', 'unpaid', 'paused'
  ) then
    raise exception 'billing_subscription_status_invalid' using errcode = '22023';
  end if;
  if nullif(trim(p_stripe_subscription_id), '') is null
    or nullif(trim(p_stripe_customer_id), '') is null
    or nullif(trim(p_stripe_price_id), '') is null then
    raise exception 'billing_subscription_identity_invalid' using errcode = '22023';
  end if;

  select * into v_subscription
  from billing.subscriptions
  where livemode = p_livemode and stripe_subscription_id = p_stripe_subscription_id
  for update;
  if found and v_subscription.last_event_created_at > p_event_created_at then
    return jsonb_build_object('status', v_subscription.status, 'ignored_out_of_order', true);
  end if;

  select * into v_checkout
  from billing.checkout_requests
  where livemode = p_livemode
    and kind = 'subscription'
    and (
      stripe_subscription_id = p_stripe_subscription_id
      or (stripe_customer_id = p_stripe_customer_id and status in ('open', 'processing', 'paid'))
    )
  order by created_at desc limit 1;

  if v_subscription.id is not null then
    if v_subscription.stripe_customer_id is distinct from p_stripe_customer_id
      or v_subscription.stripe_price_id is distinct from p_stripe_price_id
      or (
        nullif(p_stripe_product_id, '') is not null
        and v_subscription.stripe_product_id is distinct from p_stripe_product_id
      ) then
      raise exception 'billing_subscription_sku_change_not_authorized' using errcode = '23514';
    end if;
  else
    if v_checkout.id is null then
      raise exception 'billing_subscription_checkout_required' using errcode = 'P0001';
    end if;
    select offer.* into v_offer
    from billing.offers offer
    where offer.id = v_checkout.offer_id
      and offer.kind = 'subscription'
      and offer.livemode = p_livemode
      and offer.active
      and offer.retired_at is null
      and offer.stripe_price_id = p_stripe_price_id
      and (
        offer.stripe_product_id is null
        or offer.stripe_product_id = nullif(p_stripe_product_id, '')
      );
    if not found then
      raise exception 'billing_subscription_sku_not_authorized' using errcode = '23514';
    end if;
    if v_checkout.stripe_customer_id is distinct from p_stripe_customer_id then
      raise exception 'billing_subscription_customer_mismatch' using errcode = '23514';
    end if;
  end if;

  v_owner := coalesce(v_subscription.owner_id, v_checkout.owner_id, (
    select customer.owner_id from billing.customers customer
    where customer.livemode = p_livemode and customer.stripe_customer_id = p_stripe_customer_id
  ));
  v_subject := coalesce(v_subscription.subject_reference, v_checkout.subject_reference, v_owner);
  if v_owner is null then raise exception 'billing_subscription_owner_not_found' using errcode = 'P0002'; end if;

  insert into billing.subscriptions (
    owner_id, subject_reference, checkout_request_id, stripe_subscription_id,
    stripe_customer_id, stripe_product_id, stripe_price_id, livemode, status,
    current_period_start, current_period_end, trial_end, cancel_at_period_end,
    canceled_at, last_event_created_at
  ) values (
    v_owner, v_subject, v_checkout.id, p_stripe_subscription_id,
    p_stripe_customer_id, nullif(p_stripe_product_id, ''), p_stripe_price_id,
    p_livemode, p_status, p_period_start, p_period_end, p_trial_end,
    coalesce(p_cancel_at_period_end, false), p_canceled_at, p_event_created_at
  )
  on conflict (livemode, stripe_subscription_id) do update
  set owner_id = coalesce(billing.subscriptions.owner_id, excluded.owner_id),
      checkout_request_id = coalesce(billing.subscriptions.checkout_request_id, excluded.checkout_request_id),
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_product_id = coalesce(excluded.stripe_product_id, billing.subscriptions.stripe_product_id),
      stripe_price_id = excluded.stripe_price_id,
      status = excluded.status,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      trial_end = excluded.trial_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      canceled_at = excluded.canceled_at,
      last_event_created_at = excluded.last_event_created_at,
      updated_at = now()
  returning * into v_subscription;

  v_grant_status := case
    when p_status in ('active', 'trialing', 'past_due')
      and (p_period_end is null or p_period_end > now()) then 'active'
    when p_status in ('canceled', 'incomplete_expired', 'unpaid') then 'revoked'
    else 'expired'
  end;

  insert into billing.entitlement_grants (
    owner_id, subject_reference, entitlement, source, external_reference,
    status, starts_at, ends_at, metadata
  ) values (
    v_owner, v_subject, 'premium', 'stripe_subscription',
    'stripe:' || p_stripe_subscription_id, v_grant_status,
    coalesce(p_period_start, now()), p_period_end,
    jsonb_build_object('stripe_product_id', p_stripe_product_id, 'stripe_price_id', p_stripe_price_id)
  )
  on conflict (source, external_reference) do update
  set status = excluded.status,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      metadata = excluded.metadata,
      updated_at = now();

  perform billing.recompute_entitlement(v_owner);

  if v_checkout.id is not null then
    update billing.checkout_requests
    set stripe_subscription_id = p_stripe_subscription_id,
        stripe_customer_id = p_stripe_customer_id,
        status = case when v_grant_status = 'active' then 'paid' else status end,
        fulfilled_at = case when v_grant_status = 'active' then coalesce(fulfilled_at, now()) else fulfilled_at end,
        updated_at = now()
    where id = v_checkout.id;
  end if;

  return jsonb_build_object(
    'subscription_id', v_subscription.id,
    'status', v_subscription.status,
    'entitlement_status', v_grant_status,
    'ignored_out_of_order', false
  );
end;
$$;

revoke all on function public.billing_sync_subscription(
  text, boolean, text, text, text, text, timestamptz, timestamptz,
  timestamptz, boolean, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.billing_sync_subscription(
  text, boolean, text, text, text, text, timestamptz, timestamptz,
  timestamptz, boolean, timestamptz, timestamptz
) to service_role;

create or replace function public.enqueue_rag_index_after_quality()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.pdf_processing_runs;
  v_quality_job uuid;
  v_rag_job uuid;
begin
  if new.rag_status <> 'queued'
    or new.analysis_status not in ('ready', 'partial')
    or new.active_processing_run_id is null then
    return new;
  end if;

  select * into v_run
  from public.pdf_processing_runs
  where id = new.active_processing_run_id
  for update;
  if not found or v_run.document_id <> new.id then return new; end if;

  select job.id into v_quality_job
  from public.pdf_processing_jobs job
  where job.run_id = v_run.id
    and job.job_type = 'quality_review'
    and job.status in ('succeeded', 'skipped')
  order by job.created_at desc
  limit 1;
  if v_quality_job is null then return new; end if;

  insert into public.pdf_processing_jobs (
    run_id, document_id, owner_id, job_type, requested_tier, status,
    attempts, input_hash, generation_mode, pipeline_version,
    idempotency_key, priority, available_at, max_attempts, progress,
    progress_stage
  ) values (
    v_run.id, new.id, new.owner_id, 'rag_index', v_run.requested_tier, 'queued',
    0, v_run.input_hash, v_run.requested_tier, v_run.pipeline_version,
    v_run.id::text || ':rag_index', 80, now(), 5, 0,
    'waiting_for_dependency'
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_rag_job;

  if v_rag_job is null then
    select job.id into v_rag_job
    from public.pdf_processing_jobs job
    where job.idempotency_key = v_run.id::text || ':rag_index';
  end if;
  if v_rag_job is null then return new; end if;

  insert into public.pdf_processing_job_dependencies (job_id, prerequisite_job_id)
  values (v_rag_job, v_quality_job)
  on conflict do nothing;

  if exists (
    select 1 from public.pdf_processing_jobs job
    where job.id = v_rag_job and job.status not in ('succeeded', 'skipped')
  ) then
    update public.pdf_processing_runs
    set status = 'processing', progress = least(progress, 99),
        current_stage = 'rag_index', finished_at = null,
        jobs_total = (select count(*) from public.pdf_processing_jobs job where job.run_id = v_run.id)
    where id = v_run.id;

    update public.documents
    set analysis_status = 'processing', analysis_progress = least(analysis_progress, 99),
        analysis_stage = 'rag_index', analysis_updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.finalize_run_after_rag_index()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_partial boolean;
  v_status text;
begin
  if new.job_type <> 'rag_index'
    or new.status not in ('succeeded', 'skipped')
    or old.status is not distinct from new.status then
    return new;
  end if;

  select coalesce((quality.result->>'partial')::boolean, false)
  into v_partial
  from public.pdf_processing_jobs quality
  where quality.run_id = new.run_id and quality.job_type = 'quality_review'
  order by quality.created_at desc limit 1;
  v_status := case when coalesce(v_partial, false) then 'partial' else 'ready' end;

  update public.pdf_processing_runs
  set status = v_status, progress = 100, current_stage = 'completed',
      jobs_total = (select count(*) from public.pdf_processing_jobs job where job.run_id = new.run_id),
      jobs_succeeded = (select count(*) from public.pdf_processing_jobs job where job.run_id = new.run_id and job.status in ('succeeded', 'skipped')),
      jobs_failed = 0, finished_at = now()
  where id = new.run_id;

  update public.documents
  set analysis_status = v_status, analysis_progress = 100,
      analysis_stage = 'completed', analysis_error_code = null,
      analysis_updated_at = now()
  where id = new.document_id;
  return new;
end;
$$;

revoke all on function public.enqueue_rag_index_after_quality() from public, anon, authenticated;
revoke all on function public.finalize_run_after_rag_index() from public, anon, authenticated;

drop trigger if exists documents_enqueue_rag_after_quality on public.documents;
create trigger documents_enqueue_rag_after_quality
after update of rag_status, analysis_status on public.documents
for each row
when (new.rag_status = 'queued' and new.analysis_status in ('ready', 'partial'))
execute function public.enqueue_rag_index_after_quality();

drop trigger if exists pdf_jobs_finalize_run_after_rag on public.pdf_processing_jobs;
create trigger pdf_jobs_finalize_run_after_rag
after update of status on public.pdf_processing_jobs
for each row
when (new.job_type = 'rag_index' and new.status in ('succeeded', 'skipped'))
execute function public.finalize_run_after_rag_index();

-- Reconcile a run that completed quality review between the worker migration
-- and this forward migration. Updating a timestamp safely fires the enqueue
-- trigger without rewriting document content.
update public.documents
set analysis_updated_at = now()
where rag_status = 'queued'
  and analysis_status in ('ready', 'partial')
  and active_processing_run_id is not null;

do $$
begin
  if has_function_privilege('anon', 'public.billing_begin_payout_provider_attempt(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.billing_begin_payout_provider_attempt(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.billing_sync_subscription(text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'provider_hardening_acl_invariant_failed' using errcode = '42501';
  end if;
end;
$$;
