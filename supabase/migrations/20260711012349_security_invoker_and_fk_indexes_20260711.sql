-- Public projections must evaluate underlying RLS/permissions as the caller.
-- PostgreSQL views default to owner privileges unless security_invoker is set.

alter view public.public_document_catalog set (security_invoker = true);
alter view public.public_seller_profiles set (security_invoker = true);
alter view public.public_document_flashcard_quality set (security_invoker = true);

-- Cover every remaining foreign-key lookup reported by the hosted advisor.
-- These indexes matter for parent updates/deletes and reconciliation joins;
-- they are intentionally kept even before production traffic registers usage.
create index if not exists billing_checkout_requests_offer_fk_idx
  on billing.checkout_requests (offer_id);
create index if not exists billing_credit_debts_owner_fk_idx
  on billing.credit_debts (owner_id);
create index if not exists billing_disputes_payment_fk_idx
  on billing.disputes (payment_id);
create index if not exists billing_legal_acceptances_checkout_fk_idx
  on billing.legal_acceptances (checkout_request_id);
create index if not exists billing_legal_acceptances_owner_fk_idx
  on billing.legal_acceptances (owner_id);
create index if not exists billing_payments_checkout_fk_idx
  on billing.payments (checkout_request_id);
create index if not exists billing_payments_owner_fk_idx
  on billing.payments (owner_id);
create index if not exists billing_payout_items_earning_fk_idx
  on billing.payout_items (earning_id);
create index if not exists billing_payout_lot_allocations_lot_fk_idx
  on billing.payout_lot_allocations (lot_id);
create index if not exists billing_payout_requests_connected_account_fk_idx
  on billing.payout_requests (connected_account_id);
create index if not exists billing_refunds_payment_fk_idx
  on billing.refunds (payment_id);
create index if not exists billing_subscriptions_checkout_fk_idx
  on billing.subscriptions (checkout_request_id);
create index if not exists credit_lot_allocations_lot_fk_idx
  on public.credit_lot_allocations (lot_id);
create index if not exists credit_transactions_reversal_fk_idx
  on public.credit_transactions (reverses_transaction_id);
create index if not exists document_assets_processing_run_fk_idx
  on public.document_assets (processing_run_id);
create index if not exists document_blocks_processing_run_fk_idx
  on public.document_blocks (processing_run_id);
create index if not exists document_quality_reports_processing_run_fk_idx
  on public.document_quality_reports (processing_run_id);
create index if not exists documents_active_processing_run_fk_idx
  on public.documents (active_processing_run_id);
create index if not exists ocr_runs_processing_run_fk_idx
  on public.ocr_runs (processing_run_id);
create index if not exists reviewed_flashcard_reservations_document_fk_idx
  on public.reviewed_flashcard_write_reservations (document_id);

do $$
begin
  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'public_document_catalog',
        'public_seller_profiles',
        'public_document_flashcard_quality'
      )
      and coalesce(relation.reloptions, '{}') @> array['security_invoker=true'] is not true
  ) then
    raise exception 'public_view_security_invoker_invariant_failed' using errcode = '42501';
  end if;
end;
$$;
