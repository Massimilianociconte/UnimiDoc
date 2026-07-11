-- Production billing, credit provenance and seller payout foundation.
--
-- The existing wallet and purchase_document(uuid) API remain stable. This
-- migration adds a private, append-oriented accounting layer underneath them.
-- Every external mutation is idempotent and service-role-only; clients continue
-- to spend through purchase_document and use Edge Functions for Stripe calls.
--
-- Activation is intentionally NOT automatic. After creating Stripe Products /
-- Prices and approving the matching legal versions, an operator must, in one
-- reviewed release: set each billing.offers.stripe_price_id + active=true, then
-- set billing.settings.mode/features/required_*_version. Enabling settings
-- without an active matching Price leaves checkout closed; enabling an offer
-- without a Price is rejected by constraints and the invariant block below.

select pg_advisory_xact_lock(hashtextextended('unimidoc:billing-payments-and-payouts', 0));

create schema if not exists billing;
revoke all on schema billing from public, anon, authenticated;
grant usage on schema billing to service_role;

create table billing.settings (
  id smallint primary key default 1 check (id = 1),
  mode text not null default 'disabled' check (mode in ('disabled', 'test', 'live')),
  topups_enabled boolean not null default false,
  subscriptions_enabled boolean not null default false,
  connect_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  required_terms_version text,
  required_privacy_version text,
  required_sales_terms_version text,
  required_connect_terms_version text,
  commission_bps integer not null default 3000 check (commission_bps between 0 and 9000),
  seller_hold_days integer not null default 14 check (seller_hold_days between 0 and 90),
  minimum_payout_minor integer not null default 2500 check (minimum_payout_minor >= 100),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  updated_at timestamptz not null default now()
);

insert into billing.settings (id) values (1) on conflict (id) do nothing;

create table billing.offers (
  id uuid primary key default gen_random_uuid(),
  offer_key text not null check (offer_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  version integer not null default 1 check (version > 0),
  kind text not null check (kind in ('topup', 'subscription')),
  name text not null check (char_length(name) between 2 and 100),
  stripe_product_id text,
  stripe_price_id text,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  paid_credits integer not null default 0 check (paid_credits >= 0),
  promotional_credits integer not null default 0 check (promotional_credits >= 0),
  recurring_interval text check (recurring_interval is null or recurring_interval in ('month', 'year')),
  livemode boolean not null default false,
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (offer_key, version, livemode),
  check (
    (kind = 'topup' and paid_credits > 0 and recurring_interval is null)
    or
    (kind = 'subscription' and paid_credits = 0 and promotional_credits = 0 and recurring_interval is not null)
  ),
  check (not active or (stripe_price_id is not null and retired_at is null))
);

create unique index billing_offers_one_active_version_idx
  on billing.offers (offer_key, livemode) where active;

-- Inactive placeholders intentionally contain no Stripe Price IDs. Activation
-- is an explicit operator step after legal approval and Stripe configuration.
insert into billing.offers
  (offer_key, version, kind, name, amount_minor, paid_credits, promotional_credits, recurring_interval)
values
  ('credits_starter', 1, 'topup', '50 crediti', 500, 50, 0, null),
  ('credits_standard', 1, 'topup', '105 crediti', 1000, 100, 5, null),
  ('credits_plus', 1, 'topup', '220 crediti', 2000, 200, 20, null),
  ('credits_max', 1, 'topup', '460 crediti', 4000, 400, 60, null),
  ('premium_monthly', 1, 'subscription', 'UnimiDoc Premium', 499, 0, 0, 'month')
on conflict (offer_key, version, livemode) do nothing;

create table billing.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  subject_reference uuid not null,
  document_kind text not null check (document_kind in ('terms', 'privacy', 'sales', 'connect')),
  version text not null check (char_length(version) between 1 and 80),
  checkout_request_id uuid,
  accepted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (subject_reference, document_kind, version)
);

create table billing.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  subject_reference uuid not null default gen_random_uuid(),
  stripe_customer_id text not null,
  livemode boolean not null,
  email_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (livemode, stripe_customer_id)
);

create unique index billing_customers_owner_mode_idx
  on billing.customers (owner_id, livemode) where owner_id is not null;

create table billing.checkout_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  subject_reference uuid not null,
  offer_id uuid not null references billing.offers(id) on delete restrict,
  request_key text not null check (char_length(request_key) between 16 and 160),
  kind text not null check (kind in ('topup', 'subscription')),
  status text not null default 'reserved'
    check (status in ('reserved', 'open', 'processing', 'paid', 'expired', 'failed', 'refunded')),
  livemode boolean not null,
  expected_amount_minor integer not null check (expected_amount_minor > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  paid_credits integer not null default 0 check (paid_credits >= 0),
  promotional_credits integer not null default 0 check (promotional_credits >= 0),
  terms_version text not null,
  privacy_version text not null,
  sales_terms_version text not null,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_checkout_url text,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  expires_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index billing_checkout_owner_request_idx
  on billing.checkout_requests (owner_id, request_key, livemode) where owner_id is not null;
create unique index billing_checkout_session_idx
  on billing.checkout_requests (livemode, stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index billing_checkout_owner_created_idx
  on billing.checkout_requests (owner_id, created_at desc);

alter table billing.legal_acceptances
  add constraint billing_legal_acceptances_checkout_fk
  foreign key (checkout_request_id) references billing.checkout_requests(id) on delete set null;

create table billing.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  subject_reference uuid not null,
  checkout_request_id uuid not null references billing.checkout_requests(id) on delete restrict,
  stripe_checkout_session_id text not null,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_customer_id text,
  livemode boolean not null,
  status text not null check (status in ('processing', 'succeeded', 'failed', 'refunded', 'disputed')),
  amount_minor integer not null check (amount_minor >= 0),
  amount_refunded_minor integer not null default 0 check (amount_refunded_minor >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (livemode, stripe_checkout_session_id),
  check (amount_refunded_minor <= amount_minor)
);

create unique index billing_payments_intent_idx
  on billing.payments (livemode, stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create unique index billing_payments_charge_idx
  on billing.payments (livemode, stripe_charge_id) where stripe_charge_id is not null;
create unique index billing_payments_invoice_idx
  on billing.payments (livemode, stripe_invoice_id) where stripe_invoice_id is not null;

create table billing.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null,
  livemode boolean not null,
  event_type text not null,
  api_version text,
  object_id text,
  payload_sha256 text not null check (char_length(payload_sha256) = 64),
  payload jsonb not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (livemode, provider_event_id)
);

create index billing_webhook_status_idx
  on billing.webhook_events (status, received_at) where status in ('processing', 'failed');

create table billing.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  subject_reference uuid not null,
  checkout_request_id uuid references billing.checkout_requests(id) on delete set null,
  stripe_subscription_id text not null,
  stripe_customer_id text not null,
  stripe_product_id text,
  stripe_price_id text,
  livemode boolean not null,
  status text not null check (status in (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due',
    'canceled', 'unpaid', 'paused'
  )),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  last_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (livemode, stripe_subscription_id)
);

create index billing_subscriptions_owner_status_idx
  on billing.subscriptions (owner_id, status, current_period_end desc);

create table billing.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  subject_reference uuid not null,
  entitlement text not null check (entitlement in ('premium')),
  source text not null check (source in ('stripe_subscription', 'legacy', 'admin', 'promotion')),
  external_reference text not null,
  status text not null check (status in ('active', 'expired', 'revoked')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_reference)
);

create index billing_entitlement_owner_active_idx
  on billing.entitlement_grants (owner_id, entitlement, ends_at desc) where status = 'active';

create table billing.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references billing.payments(id) on delete restrict,
  stripe_refund_id text not null,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  livemode boolean not null,
  status text not null check (status in ('pending', 'succeeded', 'failed', 'canceled')),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  reason text,
  wallet_debit_credits integer not null default 0 check (wallet_debit_credits >= 0),
  unapplied_debt_minor integer not null default 0 check (unapplied_debt_minor >= 0),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (livemode, stripe_refund_id)
);

create table billing.disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references billing.payments(id) on delete restrict,
  stripe_dispute_id text not null,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  livemode boolean not null,
  status text not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  reason text,
  wallet_debit_credits integer not null default 0 check (wallet_debit_credits >= 0),
  unapplied_debt_minor integer not null default 0 check (unapplied_debt_minor >= 0),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (livemode, stripe_dispute_id)
);

create table billing.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  subject_reference uuid not null,
  stripe_account_id text,
  livemode boolean not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'onboarding', 'pending', 'active', 'restricted', 'closed')),
  transfers_status text not null default 'pending'
    check (transfers_status in ('pending', 'active', 'restricted', 'unsupported')),
  payouts_status text not null default 'pending'
    check (payouts_status in ('pending', 'active', 'restricted', 'unsupported')),
  details_submitted boolean not null default false,
  connect_terms_version text not null,
  requirements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index billing_connected_owner_mode_idx
  on billing.connected_accounts (owner_id, livemode) where owner_id is not null;
create unique index billing_connected_stripe_idx
  on billing.connected_accounts (livemode, stripe_account_id) where stripe_account_id is not null;

create table billing.seller_earnings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references auth.users(id) on delete set null,
  seller_subject_reference uuid not null,
  purchase_id uuid not null references public.document_purchases(id) on delete restrict,
  document_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'available', 'reserved', 'transferred', 'paid', 'reversed')),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  gross_backing_minor integer not null check (gross_backing_minor >= 0),
  commission_bps integer not null check (commission_bps between 0 and 9000),
  amount_minor integer not null check (amount_minor >= 0),
  convertible_credits integer not null default 0 check (convertible_credits >= 0),
  reserved_minor integer not null default 0 check (reserved_minor >= 0),
  transferred_minor integer not null default 0 check (transferred_minor >= 0),
  reversed_minor integer not null default 0 check (reversed_minor >= 0),
  reserved_credits integer not null default 0 check (reserved_credits >= 0),
  transferred_credits integer not null default 0 check (transferred_credits >= 0),
  reversed_credits integer not null default 0 check (reversed_credits >= 0),
  hold_until timestamptz not null,
  available_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_id),
  check (amount_minor <= gross_backing_minor),
  check (reserved_minor + transferred_minor + reversed_minor <= amount_minor),
  check (reserved_credits + transferred_credits + reversed_credits <= convertible_credits)
);

create index billing_seller_earnings_available_idx
  on billing.seller_earnings (seller_id, status, hold_until, created_at);

create table billing.payout_requests (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references auth.users(id) on delete set null,
  seller_subject_reference uuid not null,
  connected_account_id uuid not null references billing.connected_accounts(id) on delete restrict,
  request_key text not null check (char_length(request_key) between 16 and 160),
  requested_credits integer not null check (requested_credits > 0),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  status text not null default 'reserved'
    check (status in ('reserved', 'processing', 'transferred', 'paid', 'failed', 'reversed')),
  stripe_transfer_id text,
  stripe_payout_id text,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index billing_payout_owner_request_idx
  on billing.payout_requests (seller_id, request_key) where seller_id is not null;
create unique index billing_payout_transfer_idx
  on billing.payout_requests (stripe_transfer_id) where stripe_transfer_id is not null;

create table billing.payout_items (
  payout_request_id uuid not null references billing.payout_requests(id) on delete restrict,
  earning_id uuid not null references billing.seller_earnings(id) on delete restrict,
  credits integer not null check (credits > 0),
  amount_minor integer not null check (amount_minor > 0),
  created_at timestamptz not null default now(),
  primary key (payout_request_id, earning_id)
);

create table billing.credit_debts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  subject_reference uuid not null,
  source_type text not null check (source_type in ('refund', 'dispute')),
  source_id uuid not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  status text not null default 'open' check (status in ('open', 'settled', 'waived')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (source_type, source_id, subject_reference)
);

-- Keep private accounting tables closed even if billing is ever added to the
-- Data API schema allow-list. Only service_role reaches them or their RPCs.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'settings', 'offers', 'legal_acceptances', 'customers', 'checkout_requests',
    'payments', 'webhook_events', 'subscriptions', 'entitlement_grants',
    'refunds', 'disputes', 'connected_accounts', 'seller_earnings',
    'payout_requests', 'payout_items', 'credit_debts'
  ] loop
    execute format('alter table billing.%I enable row level security', table_name);
    execute format('revoke all on billing.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on billing.%I to service_role', table_name);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------
-- Wallet provenance. Aggregate columns remain the fast read/cache contract.
-- -------------------------------------------------------------------------

alter table public.user_credit_accounts
  add column if not exists promotional_credits integer not null default 0
    check (promotional_credits >= 0);

alter table public.user_credit_accounts
  drop constraint if exists user_credit_accounts_balance_origin_check;
alter table public.user_credit_accounts
  add constraint user_credit_accounts_balance_origin_check
  check (balance = free_credits + promotional_credits + purchased_credits + earned_credits) not valid;
alter table public.user_credit_accounts
  validate constraint user_credit_accounts_balance_origin_check;

alter table public.credit_transactions
  add column if not exists idempotency_key text,
  add column if not exists provider text,
  add column if not exists provider_object_id text,
  add column if not exists reverses_transaction_id uuid references public.credit_transactions(id) on delete restrict,
  add column if not exists free_delta integer,
  add column if not exists promotional_delta integer,
  add column if not exists purchased_delta integer,
  add column if not exists earned_delta integer,
  add column if not exists earned_convertible_delta integer,
  add column if not exists balance_after integer;

alter table public.credit_transactions
  drop constraint if exists credit_transactions_direction_check;
alter table public.credit_transactions
  add constraint credit_transactions_direction_check
  check (direction in (
    'welcome', 'purchased', 'earned', 'spent', 'reserved', 'released', 'adjusted',
    'refunded', 'charged_back'
  ));

create unique index credit_transactions_idempotency_idx
  on public.credit_transactions (owner_id, idempotency_key)
  where idempotency_key is not null;

create table public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('free', 'promotional', 'purchased', 'earned_nonconvertible', 'earned_convertible')),
  origin text not null check (origin in (
    'welcome', 'topup_paid', 'topup_bonus', 'seller_convertible',
    'seller_nonconvertible', 'reward', 'legacy_unverified'
  )),
  source_key text not null,
  units_granted integer not null check (units_granted > 0),
  units_remaining integer not null check (units_remaining >= 0),
  cash_backing_minor integer not null default 0 check (cash_backing_minor >= 0),
  cash_remaining_minor integer not null default 0 check (cash_remaining_minor >= 0),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  cash_convertible boolean not null default false,
  status text not null default 'active' check (status in ('active', 'consumed', 'reversed', 'frozen')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key),
  check (units_remaining <= units_granted),
  check (cash_remaining_minor <= cash_backing_minor),
  check (cash_convertible or (cash_backing_minor = 0 and cash_remaining_minor = 0))
);

create index credit_lots_spend_idx
  on public.credit_lots (owner_id, bucket, status, created_at, id)
  where status = 'active' and units_remaining > 0;

create table public.credit_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  purchase_id uuid not null references public.document_purchases(id) on delete restrict,
  lot_id uuid not null references public.credit_lots(id) on delete restrict,
  bucket text not null,
  units integer not null check (units > 0),
  cash_backing_minor integer not null default 0 check (cash_backing_minor >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_id, lot_id)
);

create table billing.payout_lot_allocations (
  payout_request_id uuid not null references billing.payout_requests(id) on delete restrict,
  lot_id uuid not null references public.credit_lots(id) on delete restrict,
  units integer not null check (units > 0),
  cash_backing_minor integer not null check (cash_backing_minor >= 0),
  created_at timestamptz not null default now(),
  primary key (payout_request_id, lot_id)
);

alter table billing.payout_lot_allocations enable row level security;
revoke all on billing.payout_lot_allocations from public, anon, authenticated;
grant select, insert, update, delete on billing.payout_lot_allocations to service_role;

create index credit_lot_allocations_owner_idx
  on public.credit_lot_allocations (owner_id, created_at desc);

alter table public.credit_lots enable row level security;
alter table public.credit_lot_allocations enable row level security;
revoke all on public.credit_lots, public.credit_lot_allocations from public, anon;
grant select on public.credit_lots, public.credit_lot_allocations to authenticated;
grant select, insert, update, delete on public.credit_lots, public.credit_lot_allocations to service_role;

create policy "Users read own credit lots"
on public.credit_lots for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users read own credit allocations"
on public.credit_lot_allocations for select to authenticated
using ((select auth.uid()) = owner_id);

-- Legacy balances stay spendable but are deliberately not treated as Stripe
-- backed: no external payment provenance existed before this migration.
insert into public.credit_lots
  (owner_id, bucket, origin, source_key, units_granted, units_remaining)
select owner_id, 'free', 'legacy_unverified', 'legacy:free', free_credits, free_credits
from public.user_credit_accounts where free_credits > 0
on conflict (owner_id, source_key) do nothing;

insert into public.credit_lots
  (owner_id, bucket, origin, source_key, units_granted, units_remaining)
select owner_id, 'promotional', 'legacy_unverified', 'legacy:promotional', promotional_credits, promotional_credits
from public.user_credit_accounts where promotional_credits > 0
on conflict (owner_id, source_key) do nothing;

insert into public.credit_lots
  (owner_id, bucket, origin, source_key, units_granted, units_remaining)
select owner_id, 'purchased', 'legacy_unverified', 'legacy:purchased', purchased_credits, purchased_credits
from public.user_credit_accounts where purchased_credits > 0
on conflict (owner_id, source_key) do nothing;

insert into public.credit_lots
  (owner_id, bucket, origin, source_key, units_granted, units_remaining)
select owner_id, 'earned_nonconvertible', 'legacy_unverified', 'legacy:earned-nonconvertible',
  earned_credits - earned_convertible, earned_credits - earned_convertible
from public.user_credit_accounts where earned_credits > earned_convertible
on conflict (owner_id, source_key) do nothing;

insert into public.credit_lots
  (owner_id, bucket, origin, source_key, units_granted, units_remaining)
select owner_id, 'earned_convertible', 'legacy_unverified', 'legacy:earned-convertible',
  earned_convertible, earned_convertible
from public.user_credit_accounts where earned_convertible > 0
on conflict (owner_id, source_key) do nothing;

alter table public.document_purchases
  add column if not exists seller_id uuid references auth.users(id) on delete set null,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'refunded', 'revoked')),
  add column if not exists price_credits_snapshot integer,
  add column if not exists free_credits_spent integer not null default 0 check (free_credits_spent >= 0),
  add column if not exists promotional_credits_spent integer not null default 0 check (promotional_credits_spent >= 0),
  add column if not exists purchased_credits_spent integer not null default 0 check (purchased_credits_spent >= 0),
  add column if not exists earned_credits_spent integer not null default 0 check (earned_credits_spent >= 0),
  add column if not exists unattributed_credits_spent integer not null default 0 check (unattributed_credits_spent >= 0),
  add column if not exists cash_backing_minor integer not null default 0 check (cash_backing_minor >= 0),
  add column if not exists currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  add column if not exists commission_bps integer not null default 3000 check (commission_bps between 0 and 9000),
  add column if not exists seller_convertible_credits integer not null default 0 check (seller_convertible_credits >= 0),
  add column if not exists seller_nonconvertible_credits integer not null default 0 check (seller_nonconvertible_credits >= 0),
  add column if not exists seller_cash_minor integer not null default 0 check (seller_cash_minor >= 0),
  add column if not exists economy_version text not null default 'credits_v1',
  add column if not exists accounting_metadata jsonb not null default '{}'::jsonb,
  add column if not exists refunded_at timestamptz;

update public.document_purchases purchase
set seller_id = document.owner_id,
    price_credits_snapshot = purchase.credits_spent,
    unattributed_credits_spent = purchase.credits_spent
from public.documents document
where document.id = purchase.document_id
  and purchase.price_credits_snapshot is null;

alter table public.document_purchases
  alter column price_credits_snapshot set not null;

alter table public.document_purchases
  add constraint document_purchases_credit_breakdown_check
  check (
    credits_spent = free_credits_spent + promotional_credits_spent
      + purchased_credits_spent + earned_credits_spent + unattributed_credits_spent
  ) not valid;
alter table public.document_purchases validate constraint document_purchases_credit_breakdown_check;

create index document_purchases_seller_created_idx
  on public.document_purchases (seller_id, created_at desc);

-- Preserve pre-existing Premium grants before Stripe becomes authoritative.
insert into billing.entitlement_grants
  (owner_id, subject_reference, entitlement, source, external_reference, status, ends_at)
select entitlement.owner_id, entitlement.owner_id, 'premium', 'legacy',
  'legacy:' || entitlement.owner_id::text,
  case
    when entitlement.premium_until is null or entitlement.premium_until > now() then 'active'
    else 'expired'
  end,
  entitlement.premium_until
from public.user_entitlements entitlement
where entitlement.plan = 'premium'
on conflict (source, external_reference) do nothing;

-- -------------------------------------------------------------------------
-- Internal accounting helpers (never exposed through PostgREST).
-- -------------------------------------------------------------------------

create or replace function billing.consume_credit_lots(
  p_owner uuid,
  p_purchase uuid,
  p_bucket text,
  p_units integer
) returns table (consumed_units integer, cash_minor bigint, backed_units integer)
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_remaining integer := greatest(coalesce(p_units, 0), 0);
  v_lot public.credit_lots;
  v_take integer;
  v_cash integer;
begin
  consumed_units := 0;
  cash_minor := 0;
  backed_units := 0;

  if v_remaining = 0 then
    return next;
    return;
  end if;
  if p_bucket not in ('free', 'promotional', 'purchased', 'earned_nonconvertible', 'earned_convertible') then
    raise exception 'invalid_credit_bucket' using errcode = '22023';
  end if;

  for v_lot in
    select *
    from public.credit_lots lot
    where lot.owner_id = p_owner
      and lot.bucket = p_bucket
      and lot.status = 'active'
      and lot.units_remaining > 0
      and (lot.expires_at is null or lot.expires_at > now())
    order by lot.created_at, lot.id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, v_lot.units_remaining);
    v_cash := case
      when not v_lot.cash_convertible then 0
      when v_take = v_lot.units_remaining then v_lot.cash_remaining_minor
      else floor(v_lot.cash_remaining_minor::numeric * v_take / v_lot.units_remaining)::integer
    end;

    update public.credit_lots
    set units_remaining = units_remaining - v_take,
        cash_remaining_minor = cash_remaining_minor - v_cash,
        status = case when units_remaining - v_take = 0 then 'consumed' else status end,
        updated_at = now()
    where id = v_lot.id;

    insert into public.credit_lot_allocations
      (owner_id, purchase_id, lot_id, bucket, units, cash_backing_minor)
    values (p_owner, p_purchase, v_lot.id, p_bucket, v_take, v_cash)
    on conflict (purchase_id, lot_id) do update
      set units = public.credit_lot_allocations.units + excluded.units,
          cash_backing_minor = public.credit_lot_allocations.cash_backing_minor + excluded.cash_backing_minor;

    consumed_units := consumed_units + v_take;
    cash_minor := cash_minor + v_cash;
    -- One withdrawable credit is backed by ten euro-cents. Bonus or legacy lots
    -- with no backing never propagate a cash liability to the next seller.
    backed_units := backed_units + case
      when v_lot.cash_convertible then least(v_take, floor(v_cash::numeric / 10)::integer)
      else 0
    end;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then
    raise exception 'credit_lot_invariant_violation' using
      errcode = '23514',
      detail = format('Missing %s units in bucket %s for owner %s', v_remaining, p_bucket, p_owner);
  end if;

  return next;
end;
$$;

revoke all on function billing.consume_credit_lots(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function billing.consume_credit_lots(uuid, uuid, text, integer) to service_role;

create or replace function billing.recompute_entitlement(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_has_premium boolean;
  v_indefinite boolean;
  v_until timestamptz;
begin
  select
    count(*) > 0,
    coalesce(bool_or(grant_row.ends_at is null), false),
    max(grant_row.ends_at)
  into v_has_premium, v_indefinite, v_until
  from billing.entitlement_grants grant_row
  where grant_row.owner_id = p_owner
    and grant_row.entitlement = 'premium'
    and grant_row.status = 'active'
    and grant_row.starts_at <= now()
    and (grant_row.ends_at is null or grant_row.ends_at > now());

  insert into public.user_entitlements (owner_id, plan)
  values (p_owner, case when v_has_premium then 'premium' else 'free' end)
  on conflict (owner_id) do update
  set plan = case
        when v_has_premium then 'premium'
        when public.user_entitlements.plan = 'premium' then 'free'
        else public.user_entitlements.plan
      end,
      premium_until = case
        when not v_has_premium then null
        when v_indefinite then null
        else v_until
      end,
      updated_at = now();
end;
$$;

revoke all on function billing.recompute_entitlement(uuid) from public, anon, authenticated;
grant execute on function billing.recompute_entitlement(uuid) to service_role;

-- Welcome credits now also create provenance. The transaction marker remains
-- first, preserving exactly-once behavior under concurrent auth trigger events.
create or replace function public.grant_welcome_credits(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, billing, pg_temp
as $$
declare
  v_marker uuid;
  v_welcome constant integer := 30;
begin
  if p_user is null or not exists (
    select 1 from auth.users where id = p_user and email_confirmed_at is not null
  ) then
    return;
  end if;

  insert into public.user_credit_accounts (
    owner_id, balance, free_credits, promotional_credits,
    purchased_credits, earned_credits, lifetime_earned
  ) values (p_user, 0, 0, 0, 0, 0, 0)
  on conflict (owner_id) do nothing;

  insert into public.credit_transactions
    (owner_id, direction, amount, reason, idempotency_key, free_delta)
  values (p_user, 'welcome', v_welcome, 'Bonus di benvenuto UnimiDoc', 'welcome:v1', v_welcome)
  on conflict do nothing
  returning id into v_marker;

  if v_marker is null then return; end if;

  insert into public.credit_lots
    (owner_id, bucket, origin, source_key, units_granted, units_remaining)
  values (p_user, 'free', 'welcome', 'welcome:' || v_marker::text, v_welcome, v_welcome);

  update public.user_credit_accounts
  set free_credits = free_credits + v_welcome,
      balance = balance + v_welcome,
      lifetime_earned = lifetime_earned + v_welcome,
      updated_at = now()
  where owner_id = p_user;

  update public.credit_transactions
  set balance_after = (
    select balance from public.user_credit_accounts where owner_id = p_user
  )
  where id = v_marker;
end;
$$;

revoke all on function public.grant_welcome_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_welcome_credits(uuid) to service_role;

-- The public contract is unchanged: authenticated callers pass only a document
-- UUID. The accounting layer consumes typed lots and creates a held seller
-- earning from the cash-backed portion of the spend.
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

  select * into v_purchase
  from public.document_purchases
  where document_id = p_document_id and buyer_id = v_buyer;
  if found then return v_purchase; end if;

  v_price := coalesce(v_document.price_credits, 0);
  if v_price <= 0 then raise exception 'price_unavailable' using errcode = 'P0001'; end if;

  select free_credits, promotional_credits, purchased_credits, earned_credits, earned_convertible
  into v_free, v_promotional, v_purchased, v_earned, v_earned_convertible
  from public.user_credit_accounts
  where owner_id = v_buyer
  for update;
  if not found then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;

  -- Serialize duplicate clicks on the wallet row, then re-check idempotency.
  select * into v_purchase
  from public.document_purchases
  where document_id = p_document_id and buyer_id = v_buyer;
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
    economy_version, accounting_metadata
  ) values (
    p_document_id, v_buyer, v_document.owner_id, v_price, v_price,
    v_use_free, v_use_promotional, v_use_purchased,
    v_use_earned_nonconvertible + v_use_earned_convertible, 0, v_currency, v_commission_bps,
    'credits_v2_lots',
    jsonb_build_object(
      'earned_nonconvertible', v_use_earned_nonconvertible,
      'earned_convertible', v_use_earned_convertible
    )
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

-- -------------------------------------------------------------------------
-- Service-only RPC facade consumed by Edge Functions.
-- -------------------------------------------------------------------------

create or replace function public.billing_get_config()
returns jsonb
language sql
stable
security definer
set search_path = billing, public, pg_temp
as $$
  select jsonb_build_object(
    'mode', settings.mode,
    'enabled', settings.mode <> 'disabled'
      and (settings.topups_enabled or settings.subscriptions_enabled),
    'legal_ready', settings.required_terms_version is not null
      and settings.required_privacy_version is not null
      and settings.required_sales_terms_version is not null,
    'connect_enabled', settings.mode <> 'disabled' and settings.connect_enabled,
    'payouts_enabled', settings.mode <> 'disabled' and settings.payouts_enabled,
    'terms_version', settings.required_terms_version,
    'privacy_version', settings.required_privacy_version,
    'sales_terms_version', settings.required_sales_terms_version,
    'connect_terms_version', settings.required_connect_terms_version,
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', offer.offer_key,
        'kind', offer.kind,
        'name', offer.name,
        'amount_minor', offer.amount_minor,
        'currency', offer.currency,
        'paid_credits', offer.paid_credits,
        'promotional_credits', offer.promotional_credits,
        'total_credits', offer.paid_credits + offer.promotional_credits,
        'interval', offer.recurring_interval
      ) order by offer.amount_minor, offer.offer_key)
      from billing.offers offer
      where offer.active
        and offer.livemode = (settings.mode = 'live')
        and (
          (offer.kind = 'topup' and settings.topups_enabled)
          or (offer.kind = 'subscription' and settings.subscriptions_enabled)
        )
    ), '[]'::jsonb)
  )
  from billing.settings settings
  where settings.id = 1
$$;

revoke all on function public.billing_get_config() from public, anon, authenticated;
grant execute on function public.billing_get_config() to service_role;

create or replace function public.billing_prepare_checkout(
  p_owner uuid,
  p_offer_key text,
  p_request_key text,
  p_livemode boolean,
  p_terms_version text,
  p_privacy_version text,
  p_sales_version text
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_settings billing.settings;
  v_offer billing.offers;
  v_checkout billing.checkout_requests;
  v_customer text;
begin
  if p_owner is null or not exists (select 1 from auth.users where id = p_owner) then
    raise exception 'billing_user_not_found' using errcode = 'P0002';
  end if;
  if p_request_key is null or char_length(p_request_key) not between 16 and 160 then
    raise exception 'billing_request_key_invalid' using errcode = '22023';
  end if;

  select * into v_settings from billing.settings where id = 1;
  if not found or v_settings.mode = 'disabled' then
    raise exception 'billing_disabled' using errcode = 'P0001';
  end if;
  if (v_settings.mode = 'live') <> p_livemode then
    raise exception 'billing_mode_mismatch' using errcode = 'P0001';
  end if;
  if v_settings.required_terms_version is null
    or v_settings.required_privacy_version is null
    or v_settings.required_sales_terms_version is null
    or p_terms_version is distinct from v_settings.required_terms_version
    or p_privacy_version is distinct from v_settings.required_privacy_version
    or p_sales_version is distinct from v_settings.required_sales_terms_version then
    raise exception 'billing_legal_version_mismatch' using errcode = 'P0001';
  end if;

  select * into v_checkout
  from billing.checkout_requests
  where owner_id = p_owner and request_key = p_request_key and livemode = p_livemode
  for update;
  if found then
    if not exists (
      select 1 from billing.offers offer
      where offer.id = v_checkout.offer_id and offer.offer_key = p_offer_key
    ) then
      raise exception 'billing_idempotency_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'checkout_request_id', v_checkout.id,
      'status', v_checkout.status,
      'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
      'stripe_checkout_url', v_checkout.stripe_checkout_url,
      'stripe_customer_id', v_checkout.stripe_customer_id,
      'expires_at', v_checkout.expires_at,
      'idempotent', true
    );
  end if;

  if (
    select count(*) from billing.checkout_requests request
    where request.owner_id = p_owner and request.created_at >= now() - interval '1 hour'
  ) >= 20 then
    raise exception 'billing_checkout_rate_limited' using errcode = 'P0001';
  end if;

  select * into v_offer
  from billing.offers
  where offer_key = p_offer_key and active and livemode = p_livemode;
  if not found or v_offer.stripe_price_id is null then
    raise exception 'billing_offer_unavailable' using errcode = 'P0002';
  end if;
  if (v_offer.kind = 'topup' and not v_settings.topups_enabled)
    or (v_offer.kind = 'subscription' and not v_settings.subscriptions_enabled) then
    raise exception 'billing_offer_disabled' using errcode = 'P0001';
  end if;

  insert into billing.checkout_requests (
    owner_id, subject_reference, offer_id, request_key, kind, livemode,
    expected_amount_minor, currency, paid_credits, promotional_credits,
    terms_version, privacy_version, sales_terms_version
  ) values (
    p_owner, p_owner, v_offer.id, p_request_key, v_offer.kind, p_livemode,
    v_offer.amount_minor, v_offer.currency, v_offer.paid_credits, v_offer.promotional_credits,
    p_terms_version, p_privacy_version, p_sales_version
  ) returning * into v_checkout;

  insert into billing.legal_acceptances
    (owner_id, subject_reference, document_kind, version, checkout_request_id)
  values
    (p_owner, p_owner, 'terms', p_terms_version, v_checkout.id),
    (p_owner, p_owner, 'sales', p_sales_version, v_checkout.id)
  on conflict (subject_reference, document_kind, version) do update
    set checkout_request_id = coalesce(billing.legal_acceptances.checkout_request_id, excluded.checkout_request_id);

  select stripe_customer_id into v_customer
  from billing.customers
  where owner_id = p_owner and livemode = p_livemode;

  return jsonb_build_object(
    'checkout_request_id', v_checkout.id,
    'status', v_checkout.status,
    'kind', v_offer.kind,
    'offer_key', v_offer.offer_key,
    'stripe_price_id', v_offer.stripe_price_id,
    'stripe_product_id', v_offer.stripe_product_id,
    'amount_minor', v_offer.amount_minor,
    'currency', v_offer.currency,
    'paid_credits', v_offer.paid_credits,
    'promotional_credits', v_offer.promotional_credits,
    'stripe_customer_id', v_customer,
    'idempotent', false
  );
end;
$$;

revoke all on function public.billing_prepare_checkout(uuid, text, text, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_prepare_checkout(uuid, text, text, boolean, text, text, text)
  to service_role;

create or replace function public.billing_attach_checkout(
  p_owner uuid,
  p_checkout_request uuid,
  p_stripe_customer_id text,
  p_email_snapshot text,
  p_stripe_session_id text,
  p_stripe_session_url text,
  p_expires_at timestamptz,
  p_livemode boolean
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_checkout billing.checkout_requests;
begin
  if nullif(p_stripe_customer_id, '') is null
    or nullif(p_stripe_session_id, '') is null
    or nullif(p_stripe_session_url, '') is null then
    raise exception 'billing_checkout_provider_fields_missing' using errcode = '22023';
  end if;

  insert into billing.customers
    (owner_id, subject_reference, stripe_customer_id, livemode, email_snapshot)
  values (p_owner, p_owner, p_stripe_customer_id, p_livemode, p_email_snapshot)
  on conflict (owner_id, livemode) where owner_id is not null do update
    set stripe_customer_id = excluded.stripe_customer_id,
        email_snapshot = excluded.email_snapshot,
        updated_at = now();

  update billing.checkout_requests
  set stripe_customer_id = p_stripe_customer_id,
      stripe_checkout_session_id = p_stripe_session_id,
      stripe_checkout_url = p_stripe_session_url,
      expires_at = p_expires_at,
      status = 'open',
      updated_at = now()
  where id = p_checkout_request
    and owner_id = p_owner
    and livemode = p_livemode
    and status in ('reserved', 'open')
  returning * into v_checkout;
  if not found then raise exception 'billing_checkout_not_attachable' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'checkout_request_id', v_checkout.id,
    'status', v_checkout.status,
    'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
    'stripe_checkout_url', v_checkout.stripe_checkout_url
  );
end;
$$;

revoke all on function public.billing_attach_checkout(uuid, uuid, text, text, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.billing_attach_checkout(uuid, uuid, text, text, text, text, timestamptz, boolean)
  to service_role;

create or replace function public.billing_portal_context(p_owner uuid, p_livemode boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_settings billing.settings;
  v_customer text;
begin
  select * into v_settings from billing.settings where id = 1;
  if not found or v_settings.mode = 'disabled' or (v_settings.mode = 'live') <> p_livemode then
    raise exception 'billing_disabled' using errcode = 'P0001';
  end if;
  select stripe_customer_id into v_customer
  from billing.customers where owner_id = p_owner and livemode = p_livemode;
  if v_customer is null then raise exception 'billing_customer_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('stripe_customer_id', v_customer);
end;
$$;

revoke all on function public.billing_portal_context(uuid, boolean) from public, anon, authenticated;
grant execute on function public.billing_portal_context(uuid, boolean) to service_role;

create or replace function public.billing_get_status(p_owner uuid, p_checkout_request uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_checkout jsonb;
  v_subscription jsonb;
  v_wallet jsonb;
  v_connected jsonb;
  v_payout jsonb;
begin
  update billing.seller_earnings
  set status = 'available', available_at = coalesce(available_at, now()), updated_at = now()
  where seller_id = p_owner
    and status = 'pending'
    and hold_until <= now()
    and amount_minor > reversed_minor + transferred_minor;

  select to_jsonb(row_data) into v_checkout
  from (
    select request.id, request.status, request.kind, request.expected_amount_minor,
      request.currency, request.paid_credits, request.promotional_credits,
      request.stripe_checkout_session_id, request.expires_at, request.fulfilled_at,
      request.created_at
    from billing.checkout_requests request
    where request.owner_id = p_owner
      and (p_checkout_request is null or request.id = p_checkout_request)
    order by request.created_at desc
    limit 1
  ) row_data;

  select to_jsonb(row_data) into v_subscription
  from (
    select subscription.status, subscription.current_period_start,
      subscription.current_period_end, subscription.trial_end,
      subscription.cancel_at_period_end, subscription.canceled_at,
      subscription.stripe_product_id, subscription.stripe_price_id
    from billing.subscriptions subscription
    where subscription.owner_id = p_owner
    order by subscription.updated_at desc
    limit 1
  ) row_data;

  select jsonb_build_object(
    'balance', account.balance,
    'freeCredits', account.free_credits,
    'promotionalCredits', account.promotional_credits,
    'purchasedCredits', account.purchased_credits,
    'earnedCredits', account.earned_credits,
    'earnedConvertible', account.earned_convertible,
    'reserved', account.reserved
  ) into v_wallet
  from public.user_credit_accounts account where account.owner_id = p_owner;

  select jsonb_build_object(
    'status', account.status,
    'transfersStatus', account.transfers_status,
    'payoutsStatus', account.payouts_status,
    'detailsSubmitted', account.details_submitted,
    'termsCurrent', account.connect_terms_version = (
      select settings.required_connect_terms_version from billing.settings settings where settings.id = 1
    )
  ) into v_connected
  from billing.connected_accounts account
  where account.owner_id = p_owner
  order by account.updated_at desc limit 1;

  select jsonb_build_object(
    'requestId', payout.id,
    'status', payout.status,
    'requestedCredits', payout.requested_credits,
    'amountMinor', payout.amount_minor,
    'currency', payout.currency,
    'createdAt', payout.created_at,
    'completedAt', payout.completed_at
  ) into v_payout
  from billing.payout_requests payout
  where payout.seller_id = p_owner
  order by payout.created_at desc limit 1;

  return jsonb_build_object(
    'checkout', v_checkout,
    'subscription', v_subscription,
    'wallet', v_wallet,
    'connectedAccount', v_connected,
    'payout', v_payout
  );
end;
$$;

revoke all on function public.billing_get_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_get_status(uuid, uuid) to service_role;

-- Data-subject export projection. Raw webhook payloads, idempotency keys and
-- hosted Checkout URLs are deliberately excluded; the remaining accounting,
-- consent and provider identifiers are portable personal data.
create or replace function public.billing_privacy_export(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = billing, public, pg_temp
as $$
  select jsonb_build_object(
    'legalAcceptances', coalesce((
      select jsonb_agg(to_jsonb(acceptance) - 'owner_id' order by acceptance.accepted_at)
      from billing.legal_acceptances acceptance
      where acceptance.subject_reference = p_owner
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(to_jsonb(customer) - 'owner_id' order by customer.created_at)
      from billing.customers customer
      where customer.subject_reference = p_owner
    ), '[]'::jsonb),
    'checkoutRequests', coalesce((
      select jsonb_agg(
        to_jsonb(checkout_request) - 'owner_id' - 'request_key' - 'stripe_checkout_url'
        order by checkout_request.created_at
      )
      from billing.checkout_requests checkout_request
      where checkout_request.subject_reference = p_owner
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(payment) - 'owner_id' order by payment.created_at)
      from billing.payments payment
      where payment.subject_reference = p_owner
    ), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(to_jsonb(subscription) - 'owner_id' order by subscription.created_at)
      from billing.subscriptions subscription
      where subscription.subject_reference = p_owner
    ), '[]'::jsonb),
    'entitlementGrants', coalesce((
      select jsonb_agg(to_jsonb(grant_row) - 'owner_id' order by grant_row.created_at)
      from billing.entitlement_grants grant_row
      where grant_row.subject_reference = p_owner
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(to_jsonb(refund) order by refund.created_at)
      from billing.refunds refund
      join billing.payments payment on payment.id = refund.payment_id
      where payment.subject_reference = p_owner
    ), '[]'::jsonb),
    'disputes', coalesce((
      select jsonb_agg(to_jsonb(dispute) order by dispute.created_at)
      from billing.disputes dispute
      join billing.payments payment on payment.id = dispute.payment_id
      where payment.subject_reference = p_owner
    ), '[]'::jsonb),
    'connectedAccounts', coalesce((
      select jsonb_agg(to_jsonb(account) - 'owner_id' order by account.created_at)
      from billing.connected_accounts account
      where account.subject_reference = p_owner
    ), '[]'::jsonb),
    'sellerEarnings', coalesce((
      select jsonb_agg(to_jsonb(earning) - 'seller_id' order by earning.created_at)
      from billing.seller_earnings earning
      where earning.seller_subject_reference = p_owner
    ), '[]'::jsonb),
    'payoutRequests', coalesce((
      select jsonb_agg(to_jsonb(payout) - 'seller_id' - 'request_key' order by payout.created_at)
      from billing.payout_requests payout
      where payout.seller_subject_reference = p_owner
    ), '[]'::jsonb),
    'payoutItems', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at)
      from billing.payout_items item
      join billing.payout_requests payout on payout.id = item.payout_request_id
      where payout.seller_subject_reference = p_owner
    ), '[]'::jsonb),
    'creditDebts', coalesce((
      select jsonb_agg(to_jsonb(debt) - 'owner_id' order by debt.created_at)
      from billing.credit_debts debt
      where debt.subject_reference = p_owner
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.billing_privacy_export(uuid) from public, anon, authenticated;
grant execute on function public.billing_privacy_export(uuid) to service_role;

create or replace function public.billing_store_webhook(
  p_provider_event_id text,
  p_livemode boolean,
  p_event_type text,
  p_api_version text,
  p_object_id text,
  p_payload_sha256 text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_event billing.webhook_events;
begin
  if nullif(p_provider_event_id, '') is null
    or nullif(p_event_type, '') is null
    or char_length(coalesce(p_payload_sha256, '')) <> 64 then
    raise exception 'billing_webhook_invalid' using errcode = '22023';
  end if;

  select * into v_event
  from billing.webhook_events
  where livemode = p_livemode and provider_event_id = p_provider_event_id
  for update;

  if found then
    if v_event.payload_sha256 <> p_payload_sha256 then
      raise exception 'billing_webhook_payload_conflict' using errcode = '23505';
    end if;
    if v_event.status in ('processed', 'ignored') then
      return jsonb_build_object('id', v_event.id, 'status', v_event.status, 'duplicate', true);
    end if;
    update billing.webhook_events
    set status = 'processing',
        attempt_count = attempt_count + 1,
        last_error = null
    where id = v_event.id
    returning * into v_event;
    return jsonb_build_object('id', v_event.id, 'status', v_event.status, 'duplicate', true);
  end if;

  insert into billing.webhook_events (
    provider_event_id, livemode, event_type, api_version, object_id,
    payload_sha256, payload
  ) values (
    p_provider_event_id, p_livemode, p_event_type, nullif(p_api_version, ''),
    nullif(p_object_id, ''), p_payload_sha256, p_payload
  ) returning * into v_event;

  return jsonb_build_object('id', v_event.id, 'status', v_event.status, 'duplicate', false);
end;
$$;

revoke all on function public.billing_store_webhook(text, boolean, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.billing_store_webhook(text, boolean, text, text, text, text, jsonb)
  to service_role;

create or replace function public.billing_finish_webhook(
  p_event uuid,
  p_status text,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
begin
  if p_status not in ('processed', 'failed', 'ignored') then
    raise exception 'billing_webhook_status_invalid' using errcode = '22023';
  end if;
  update billing.webhook_events
  set status = p_status,
      last_error = case when p_status = 'failed' then left(coalesce(p_error, 'processing_failed'), 1000) else null end,
      processed_at = case when p_status in ('processed', 'ignored') then now() else null end
  where id = p_event;
  if not found then raise exception 'billing_webhook_not_found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.billing_finish_webhook(uuid, text, text) from public, anon, authenticated;
grant execute on function public.billing_finish_webhook(uuid, text, text) to service_role;

create or replace function public.billing_mark_checkout_event(
  p_stripe_session_id text,
  p_livemode boolean,
  p_status text,
  p_stripe_customer_id text default null,
  p_stripe_payment_intent_id text default null,
  p_stripe_subscription_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_checkout billing.checkout_requests;
begin
  if p_status not in ('processing', 'paid', 'expired', 'failed', 'refunded') then
    raise exception 'billing_checkout_status_invalid' using errcode = '22023';
  end if;
  update billing.checkout_requests
  set status = p_status,
      stripe_customer_id = coalesce(nullif(p_stripe_customer_id, ''), stripe_customer_id),
      stripe_payment_intent_id = coalesce(nullif(p_stripe_payment_intent_id, ''), stripe_payment_intent_id),
      stripe_subscription_id = coalesce(nullif(p_stripe_subscription_id, ''), stripe_subscription_id),
      fulfilled_at = case when p_status = 'paid' then coalesce(fulfilled_at, now()) else fulfilled_at end,
      updated_at = now()
  where stripe_checkout_session_id = p_stripe_session_id and livemode = p_livemode
  returning * into v_checkout;
  if not found then raise exception 'billing_checkout_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('checkout_request_id', v_checkout.id, 'kind', v_checkout.kind, 'status', v_checkout.status);
end;
$$;

revoke all on function public.billing_mark_checkout_event(text, boolean, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_mark_checkout_event(text, boolean, text, text, text, text)
  to service_role;

create or replace function public.billing_apply_paid_checkout(
  p_stripe_session_id text,
  p_livemode boolean,
  p_stripe_customer_id text,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_amount_minor integer,
  p_currency text,
  p_paid_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_checkout billing.checkout_requests;
  v_payment billing.payments;
  v_transaction uuid;
  v_total integer;
begin
  select * into v_checkout
  from billing.checkout_requests
  where stripe_checkout_session_id = p_stripe_session_id and livemode = p_livemode
  for update;
  if not found then raise exception 'billing_checkout_not_found' using errcode = 'P0002'; end if;
  if v_checkout.kind <> 'topup' then raise exception 'billing_checkout_not_topup' using errcode = '22023'; end if;
  if v_checkout.owner_id is null then raise exception 'billing_checkout_owner_deleted' using errcode = 'P0001'; end if;
  if p_amount_minor is distinct from v_checkout.expected_amount_minor
    or lower(p_currency) is distinct from v_checkout.currency then
    raise exception 'billing_amount_mismatch' using errcode = '23514';
  end if;

  if v_checkout.fulfilled_at is not null and v_checkout.status = 'paid' then
    return jsonb_build_object(
      'checkout_request_id', v_checkout.id,
      'status', 'paid',
      'idempotent', true
    );
  end if;

  insert into billing.payments (
    owner_id, subject_reference, checkout_request_id, stripe_checkout_session_id,
    stripe_payment_intent_id, stripe_charge_id, stripe_customer_id, livemode,
    status, amount_minor, currency, paid_at
  ) values (
    v_checkout.owner_id, v_checkout.subject_reference, v_checkout.id, p_stripe_session_id,
    nullif(p_stripe_payment_intent_id, ''), nullif(p_stripe_charge_id, ''),
    nullif(p_stripe_customer_id, ''), p_livemode,
    'succeeded', p_amount_minor, lower(p_currency), coalesce(p_paid_at, now())
  )
  on conflict (livemode, stripe_checkout_session_id) do update
  set stripe_payment_intent_id = coalesce(excluded.stripe_payment_intent_id, billing.payments.stripe_payment_intent_id),
      stripe_charge_id = coalesce(excluded.stripe_charge_id, billing.payments.stripe_charge_id),
      stripe_customer_id = coalesce(excluded.stripe_customer_id, billing.payments.stripe_customer_id),
      status = 'succeeded',
      paid_at = coalesce(billing.payments.paid_at, excluded.paid_at),
      updated_at = now()
  returning * into v_payment;

  insert into public.user_credit_accounts (
    owner_id, balance, free_credits, promotional_credits, purchased_credits, earned_credits
  ) values (v_checkout.owner_id, 0, 0, 0, 0, 0)
  on conflict (owner_id) do nothing;

  v_total := v_checkout.paid_credits + v_checkout.promotional_credits;
  insert into public.credit_transactions (
    owner_id, direction, amount, reason, idempotency_key, provider,
    provider_object_id, promotional_delta, purchased_delta, metadata
  ) values (
    v_checkout.owner_id, 'purchased', v_total, 'Ricarica crediti Stripe',
    'stripe:checkout:' || p_stripe_session_id,
    'stripe', p_stripe_session_id,
    v_checkout.promotional_credits, v_checkout.paid_credits,
    jsonb_build_object(
      'amount_minor', p_amount_minor,
      'currency', lower(p_currency),
      'paid_credits', v_checkout.paid_credits,
      'promotional_credits', v_checkout.promotional_credits,
      'payment_id', v_payment.id
    )
  )
  on conflict (owner_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_transaction;

  if v_transaction is null then
    raise exception 'billing_topup_transaction_conflict' using errcode = '23505';
  end if;

  if v_checkout.paid_credits > 0 then
    insert into public.credit_lots (
      owner_id, bucket, origin, source_key, units_granted, units_remaining,
      cash_backing_minor, cash_remaining_minor, currency, cash_convertible
    ) values (
      v_checkout.owner_id, 'purchased', 'topup_paid',
      'stripe:checkout:' || p_stripe_session_id || ':paid',
      v_checkout.paid_credits, v_checkout.paid_credits,
      p_amount_minor, p_amount_minor, lower(p_currency), true
    );
  end if;
  if v_checkout.promotional_credits > 0 then
    insert into public.credit_lots (
      owner_id, bucket, origin, source_key, units_granted, units_remaining
    ) values (
      v_checkout.owner_id, 'promotional', 'topup_bonus',
      'stripe:checkout:' || p_stripe_session_id || ':promo',
      v_checkout.promotional_credits, v_checkout.promotional_credits
    );
  end if;

  update public.user_credit_accounts
  set purchased_credits = purchased_credits + v_checkout.paid_credits,
      promotional_credits = promotional_credits + v_checkout.promotional_credits,
      balance = balance + v_total,
      updated_at = now()
  where owner_id = v_checkout.owner_id;

  update public.credit_transactions
  set balance_after = (
    select balance from public.user_credit_accounts where owner_id = v_checkout.owner_id
  )
  where id = v_transaction;

  update billing.checkout_requests
  set status = 'paid',
      stripe_customer_id = coalesce(nullif(p_stripe_customer_id, ''), stripe_customer_id),
      stripe_payment_intent_id = coalesce(nullif(p_stripe_payment_intent_id, ''), stripe_payment_intent_id),
      fulfilled_at = coalesce(fulfilled_at, now()),
      updated_at = now()
  where id = v_checkout.id;

  return jsonb_build_object(
    'checkout_request_id', v_checkout.id,
    'payment_id', v_payment.id,
    'status', 'paid',
    'credits_granted', v_total,
    'paid_credits', v_checkout.paid_credits,
    'promotional_credits', v_checkout.promotional_credits,
    'idempotent', false
  );
end;
$$;

revoke all on function public.billing_apply_paid_checkout(text, boolean, text, text, text, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.billing_apply_paid_checkout(text, boolean, text, text, text, integer, text, timestamptz)
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
    p_stripe_customer_id, nullif(p_stripe_product_id, ''), nullif(p_stripe_price_id, ''),
    p_livemode, p_status, p_period_start, p_period_end, p_trial_end,
    coalesce(p_cancel_at_period_end, false), p_canceled_at, p_event_created_at
  )
  on conflict (livemode, stripe_subscription_id) do update
  set owner_id = coalesce(billing.subscriptions.owner_id, excluded.owner_id),
      checkout_request_id = coalesce(billing.subscriptions.checkout_request_id, excluded.checkout_request_id),
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_product_id = coalesce(excluded.stripe_product_id, billing.subscriptions.stripe_product_id),
      stripe_price_id = coalesce(excluded.stripe_price_id, billing.subscriptions.stripe_price_id),
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

revoke all on function public.billing_sync_subscription(text, boolean, text, text, text, text, timestamptz, timestamptz, timestamptz, boolean, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.billing_sync_subscription(text, boolean, text, text, text, text, timestamptz, timestamptz, timestamptz, boolean, timestamptz, timestamptz)
  to service_role;

create or replace function public.billing_record_invoice_payment(
  p_stripe_subscription_id text,
  p_stripe_invoice_id text,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_livemode boolean,
  p_status text,
  p_amount_minor integer,
  p_currency text,
  p_paid_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_subscription billing.subscriptions;
  v_checkout billing.checkout_requests;
  v_payment billing.payments;
begin
  if p_status not in ('processing', 'succeeded', 'failed') then
    raise exception 'billing_invoice_payment_status_invalid' using errcode = '22023';
  end if;
  select * into v_subscription
  from billing.subscriptions
  where livemode = p_livemode and stripe_subscription_id = p_stripe_subscription_id;
  if not found or v_subscription.owner_id is null then
    raise exception 'billing_invoice_subscription_not_found' using errcode = 'P0002';
  end if;
  select * into v_checkout
  from billing.checkout_requests
  where id = v_subscription.checkout_request_id;
  if not found then
    raise exception 'billing_invoice_checkout_not_found' using errcode = 'P0002';
  end if;

  insert into billing.payments (
    owner_id, subject_reference, checkout_request_id, stripe_checkout_session_id,
    stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id,
    stripe_customer_id, livemode, status, amount_minor, currency, paid_at
  ) values (
    v_subscription.owner_id, v_subscription.subject_reference, v_checkout.id,
    'invoice:' || p_stripe_invoice_id, p_stripe_invoice_id,
    nullif(p_stripe_payment_intent_id, ''), nullif(p_stripe_charge_id, ''),
    v_subscription.stripe_customer_id, p_livemode, p_status,
    greatest(p_amount_minor, 0), lower(p_currency), p_paid_at
  )
  on conflict (livemode, stripe_invoice_id) where stripe_invoice_id is not null do update
  set stripe_payment_intent_id = coalesce(excluded.stripe_payment_intent_id, billing.payments.stripe_payment_intent_id),
      stripe_charge_id = coalesce(excluded.stripe_charge_id, billing.payments.stripe_charge_id),
      status = excluded.status,
      amount_minor = excluded.amount_minor,
      paid_at = coalesce(excluded.paid_at, billing.payments.paid_at),
      updated_at = now()
  returning * into v_payment;
  return jsonb_build_object('payment_id', v_payment.id, 'status', v_payment.status);
end;
$$;

revoke all on function public.billing_record_invoice_payment(text, text, text, text, boolean, text, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.billing_record_invoice_payment(text, text, text, text, boolean, text, integer, text, timestamptz)
  to service_role;

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

  -- Remove the proportional, not-yet-reserved seller liability generated by
  -- credits from this payment. Already transferred amounts become a debt/audit
  -- item instead of silently making balances negative.
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
  end if;

  return jsonb_build_object(
    'wallet_debit_credits', v_paid_revoke + v_promo_revoke,
    'unapplied_debt_minor', v_debt,
    'transaction_id', v_transaction
  );
end;
$$;

revoke all on function billing.apply_payment_reversal(uuid, text, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function billing.apply_payment_reversal(uuid, text, uuid, integer, text)
  to service_role;

create or replace function public.billing_apply_refund(
  p_stripe_refund_id text,
  p_livemode boolean,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_status text,
  p_amount_minor integer,
  p_currency text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_payment billing.payments;
  v_checkout billing.checkout_requests;
  v_refund billing.refunds;
  v_result jsonb := '{}'::jsonb;
begin
  if p_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'billing_refund_status_invalid' using errcode = '22023';
  end if;
  select * into v_payment
  from billing.payments
  where livemode = p_livemode
    and (
      (nullif(p_stripe_payment_intent_id, '') is not null and stripe_payment_intent_id = p_stripe_payment_intent_id)
      or (nullif(p_stripe_charge_id, '') is not null and stripe_charge_id = p_stripe_charge_id)
    )
  order by created_at desc limit 1;
  if not found then raise exception 'billing_refund_payment_not_found' using errcode = 'P0002'; end if;
  select * into v_checkout from billing.checkout_requests where id = v_payment.checkout_request_id;
  if not found then raise exception 'billing_refund_checkout_not_found' using errcode = 'P0002'; end if;
  if lower(p_currency) <> v_payment.currency or p_amount_minor > v_payment.amount_minor then
    raise exception 'billing_refund_amount_mismatch' using errcode = '23514';
  end if;

  insert into billing.refunds (
    payment_id, stripe_refund_id, stripe_payment_intent_id, stripe_charge_id,
    livemode, status, amount_minor, currency, reason
  ) values (
    v_payment.id, p_stripe_refund_id, nullif(p_stripe_payment_intent_id, ''),
    nullif(p_stripe_charge_id, ''), p_livemode, p_status, p_amount_minor,
    lower(p_currency), nullif(p_reason, '')
  )
  on conflict (livemode, stripe_refund_id) do update
  set status = excluded.status,
      reason = coalesce(excluded.reason, billing.refunds.reason),
      updated_at = now()
  returning * into v_refund;

  if p_status = 'succeeded' and v_refund.applied_at is null then
    if v_checkout.kind = 'topup' then
      v_result := billing.apply_payment_reversal(
        v_payment.id, 'refund', v_refund.id, p_amount_minor,
        'stripe:refund:' || p_stripe_refund_id
      );
    else
      v_result := jsonb_build_object('wallet_debit_credits', 0, 'unapplied_debt_minor', 0);
      if p_amount_minor >= v_payment.amount_minor and v_checkout.stripe_subscription_id is not null then
        update billing.entitlement_grants
        set status = 'revoked', ends_at = least(coalesce(ends_at, now()), now()), updated_at = now()
        where source = 'stripe_subscription'
          and external_reference = 'stripe:' || v_checkout.stripe_subscription_id;
        perform billing.recompute_entitlement(v_checkout.owner_id);
      end if;
    end if;
    update billing.refunds
    set wallet_debit_credits = coalesce((v_result->>'wallet_debit_credits')::integer, 0),
        unapplied_debt_minor = coalesce((v_result->>'unapplied_debt_minor')::integer, 0),
        applied_at = now(), updated_at = now()
    where id = v_refund.id;
    update billing.payments
    set amount_refunded_minor = least(amount_minor, amount_refunded_minor + p_amount_minor),
        status = case when amount_refunded_minor + p_amount_minor >= amount_minor then 'refunded' else status end,
        updated_at = now()
    where id = v_payment.id;
  end if;

  return jsonb_build_object(
    'refund_id', v_refund.id,
    'status', p_status,
    'applied', p_status = 'succeeded',
    'result', v_result
  );
end;
$$;

revoke all on function public.billing_apply_refund(text, boolean, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_apply_refund(text, boolean, text, text, text, integer, text, text)
  to service_role;

create or replace function public.billing_apply_dispute(
  p_stripe_dispute_id text,
  p_livemode boolean,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_status text,
  p_amount_minor integer,
  p_currency text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_payment billing.payments;
  v_checkout billing.checkout_requests;
  v_dispute billing.disputes;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_payment
  from billing.payments
  where livemode = p_livemode
    and (
      (nullif(p_stripe_payment_intent_id, '') is not null and stripe_payment_intent_id = p_stripe_payment_intent_id)
      or (nullif(p_stripe_charge_id, '') is not null and stripe_charge_id = p_stripe_charge_id)
    )
  order by created_at desc limit 1;
  if not found then raise exception 'billing_dispute_payment_not_found' using errcode = 'P0002'; end if;
  select * into v_checkout from billing.checkout_requests where id = v_payment.checkout_request_id;
  if not found then raise exception 'billing_dispute_checkout_not_found' using errcode = 'P0002'; end if;
  if lower(p_currency) <> v_payment.currency or p_amount_minor > v_payment.amount_minor then
    raise exception 'billing_dispute_amount_mismatch' using errcode = '23514';
  end if;

  insert into billing.disputes (
    payment_id, stripe_dispute_id, stripe_payment_intent_id, stripe_charge_id,
    livemode, status, amount_minor, currency, reason
  ) values (
    v_payment.id, p_stripe_dispute_id, nullif(p_stripe_payment_intent_id, ''),
    nullif(p_stripe_charge_id, ''), p_livemode, p_status, p_amount_minor,
    lower(p_currency), nullif(p_reason, '')
  )
  on conflict (livemode, stripe_dispute_id) do update
  set status = excluded.status,
      reason = coalesce(excluded.reason, billing.disputes.reason),
      updated_at = now()
  returning * into v_dispute;

  -- Apply once when funds are at risk. A later win remains an explicit
  -- compensating operation for reconciliation rather than deleting this audit.
  if p_status in ('warning_needs_response', 'needs_response', 'under_review', 'lost')
    and v_dispute.applied_at is null then
    if v_checkout.kind = 'topup' then
      v_result := billing.apply_payment_reversal(
        v_payment.id, 'dispute', v_dispute.id, p_amount_minor,
        'stripe:dispute:' || p_stripe_dispute_id
      );
    else
      v_result := jsonb_build_object('wallet_debit_credits', 0, 'unapplied_debt_minor', 0);
      if v_checkout.stripe_subscription_id is not null then
        update billing.entitlement_grants
        set status = 'revoked', ends_at = least(coalesce(ends_at, now()), now()), updated_at = now()
        where source = 'stripe_subscription'
          and external_reference = 'stripe:' || v_checkout.stripe_subscription_id;
        perform billing.recompute_entitlement(v_checkout.owner_id);
      end if;
    end if;
    update billing.disputes
    set wallet_debit_credits = coalesce((v_result->>'wallet_debit_credits')::integer, 0),
        unapplied_debt_minor = coalesce((v_result->>'unapplied_debt_minor')::integer, 0),
        applied_at = now(), updated_at = now()
    where id = v_dispute.id;
    update billing.payments set status = 'disputed', updated_at = now() where id = v_payment.id;
  end if;

  return jsonb_build_object(
    'dispute_id', v_dispute.id,
    'status', p_status,
    'applied', v_dispute.applied_at is not null or p_status in ('warning_needs_response', 'needs_response', 'under_review', 'lost'),
    'result', v_result
  );
end;
$$;

revoke all on function public.billing_apply_dispute(text, boolean, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_apply_dispute(text, boolean, text, text, text, integer, text, text)
  to service_role;

create or replace function public.billing_prepare_connect(
  p_owner uuid,
  p_livemode boolean,
  p_connect_terms_version text
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_settings billing.settings;
  v_account billing.connected_accounts;
  v_email text;
  v_display_name text;
begin
  select * into v_settings from billing.settings where id = 1;
  if not found or v_settings.mode = 'disabled' or not v_settings.connect_enabled then
    raise exception 'billing_connect_disabled' using errcode = 'P0001';
  end if;
  if (v_settings.mode = 'live') <> p_livemode then
    raise exception 'billing_mode_mismatch' using errcode = 'P0001';
  end if;
  if v_settings.required_connect_terms_version is null
    or p_connect_terms_version is distinct from v_settings.required_connect_terms_version then
    raise exception 'billing_connect_legal_version_mismatch' using errcode = 'P0001';
  end if;

  select auth_user.email, coalesce(profile.public_display_name, profile.full_name)
  into v_email, v_display_name
  from auth.users auth_user
  join public.profiles profile on profile.id = auth_user.id
  where auth_user.id = p_owner
    and profile.seller_profile_enabled = true
    and profile.public_display_name is not null;
  if not found then
    raise exception 'billing_public_seller_profile_required' using errcode = 'P0001';
  end if;

  select * into v_account
  from billing.connected_accounts
  where owner_id = p_owner and livemode = p_livemode
  for update;
  if not found then
    insert into billing.connected_accounts (
      owner_id, subject_reference, livemode, connect_terms_version
    ) values (p_owner, p_owner, p_livemode, p_connect_terms_version)
    returning * into v_account;
  elsif v_account.connect_terms_version is distinct from p_connect_terms_version then
    update billing.connected_accounts
    set connect_terms_version = p_connect_terms_version,
        updated_at = now()
    where id = v_account.id
    returning * into v_account;
  end if;

  insert into billing.legal_acceptances (
    owner_id, subject_reference, document_kind, version
  ) values (p_owner, p_owner, 'connect', p_connect_terms_version)
  on conflict (subject_reference, document_kind, version) do nothing;

  return jsonb_build_object(
    'connected_account_id', v_account.id,
    'stripe_account_id', v_account.stripe_account_id,
    'status', v_account.status,
    'transfers_status', v_account.transfers_status,
    'payouts_status', v_account.payouts_status,
    'email', v_email,
    'display_name', v_display_name
  );
end;
$$;

revoke all on function public.billing_prepare_connect(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.billing_prepare_connect(uuid, boolean, text) to service_role;

create or replace function public.billing_attach_connected_account(
  p_owner uuid,
  p_livemode boolean,
  p_stripe_account_id text,
  p_status text,
  p_transfers_status text,
  p_payouts_status text,
  p_details_submitted boolean,
  p_requirements jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_account billing.connected_accounts;
begin
  if p_status not in ('onboarding', 'pending', 'active', 'restricted', 'closed')
    or p_transfers_status not in ('pending', 'active', 'restricted', 'unsupported')
    or p_payouts_status not in ('pending', 'active', 'restricted', 'unsupported') then
    raise exception 'billing_connected_account_status_invalid' using errcode = '22023';
  end if;
  update billing.connected_accounts
  set stripe_account_id = p_stripe_account_id,
      status = p_status,
      transfers_status = p_transfers_status,
      payouts_status = p_payouts_status,
      details_submitted = coalesce(p_details_submitted, false),
      requirements = coalesce(p_requirements, '{}'::jsonb),
      updated_at = now()
  where owner_id = p_owner and livemode = p_livemode
  returning * into v_account;
  if not found then raise exception 'billing_connected_account_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'connected_account_id', v_account.id,
    'status', v_account.status,
    'transfers_status', v_account.transfers_status,
    'payouts_status', v_account.payouts_status,
    'details_submitted', v_account.details_submitted
  );
end;
$$;

revoke all on function public.billing_attach_connected_account(uuid, boolean, text, text, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.billing_attach_connected_account(uuid, boolean, text, text, text, text, boolean, jsonb)
  to service_role;

create or replace function billing.reserve_payout_lots(
  p_owner uuid,
  p_payout uuid,
  p_units integer
) returns bigint
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_remaining integer := p_units;
  v_cash bigint := 0;
  v_lot public.credit_lots;
  v_take integer;
  v_take_cash integer;
begin
  for v_lot in
    select * from public.credit_lots lot
    where lot.owner_id = p_owner
      and lot.bucket = 'earned_convertible'
      and lot.status = 'active'
      and lot.units_remaining > 0
      and lot.cash_convertible
      and lot.cash_remaining_minor > 0
    order by lot.created_at, lot.id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, v_lot.units_remaining, floor(v_lot.cash_remaining_minor::numeric / 10)::integer);
    continue when v_take <= 0;
    v_take_cash := least(v_lot.cash_remaining_minor, v_take * 10);
    update public.credit_lots
    set units_remaining = units_remaining - v_take,
        cash_remaining_minor = cash_remaining_minor - v_take_cash,
        status = case when units_remaining - v_take = 0 then 'consumed' else status end,
        updated_at = now()
    where id = v_lot.id;
    insert into billing.payout_lot_allocations
      (payout_request_id, lot_id, units, cash_backing_minor)
    values (p_payout, v_lot.id, v_take, v_take_cash);
    v_remaining := v_remaining - v_take;
    v_cash := v_cash + v_take_cash;
  end loop;
  if v_remaining <> 0 then
    raise exception 'billing_payout_credit_backing_missing' using errcode = '23514';
  end if;
  return v_cash;
end;
$$;

revoke all on function billing.reserve_payout_lots(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function billing.reserve_payout_lots(uuid, uuid, integer) to service_role;

create or replace function public.billing_reserve_payout(
  p_owner uuid,
  p_credits integer,
  p_request_key text,
  p_livemode boolean
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_settings billing.settings;
  v_account billing.connected_accounts;
  v_wallet public.user_credit_accounts;
  v_payout billing.payout_requests;
  v_earning billing.seller_earnings;
  v_available_credits integer;
  v_available_minor integer;
  v_take integer;
  v_take_minor integer;
  v_remaining integer := p_credits;
  v_amount integer := 0;
  v_lot_cash bigint;
begin
  if p_credits <= 0 or p_request_key is null or char_length(p_request_key) not between 16 and 160 then
    raise exception 'billing_payout_request_invalid' using errcode = '22023';
  end if;
  select * into v_settings from billing.settings where id = 1;
  if not found or v_settings.mode = 'disabled' or not v_settings.connect_enabled or not v_settings.payouts_enabled then
    raise exception 'billing_payout_disabled' using errcode = 'P0001';
  end if;
  if (v_settings.mode = 'live') <> p_livemode then
    raise exception 'billing_mode_mismatch' using errcode = 'P0001';
  end if;

  select * into v_payout
  from billing.payout_requests
  where seller_id = p_owner and request_key = p_request_key
  for update;
  if found then
    return jsonb_build_object(
      'request_id', v_payout.id,
      'status', v_payout.status,
      'amount_minor', v_payout.amount_minor,
      'currency', v_payout.currency,
      'stripe_account_id', (
        select account.stripe_account_id
        from billing.connected_accounts account
        where account.id = v_payout.connected_account_id
      ),
      'idempotent', true
    );
  end if;

  select * into v_account
  from billing.connected_accounts
  where owner_id = p_owner and livemode = p_livemode
  for update;
  if not found or v_account.stripe_account_id is null
    or v_account.status <> 'active' or v_account.transfers_status <> 'active' then
    raise exception 'billing_connected_account_not_ready' using errcode = 'P0001';
  end if;
  if v_settings.required_connect_terms_version is null
    or v_account.connect_terms_version is distinct from v_settings.required_connect_terms_version then
    raise exception 'billing_connect_legal_version_mismatch' using errcode = 'P0001';
  end if;

  update billing.seller_earnings
  set status = 'available', available_at = coalesce(available_at, now()), updated_at = now()
  where seller_id = p_owner and status = 'pending' and hold_until <= now();

  select * into v_wallet
  from public.user_credit_accounts where owner_id = p_owner for update;
  if not found or v_wallet.earned_convertible < p_credits then
    raise exception 'billing_payout_credits_insufficient' using errcode = 'P0001';
  end if;

  insert into billing.payout_requests (
    seller_id, seller_subject_reference, connected_account_id, request_key,
    requested_credits, amount_minor, currency
  ) values (
    p_owner, v_account.subject_reference, v_account.id, p_request_key,
    p_credits, 1, v_settings.currency
  ) returning * into v_payout;

  for v_earning in
    select * from billing.seller_earnings earning
    where earning.seller_id = p_owner
      and earning.status in ('available', 'reserved')
      and earning.hold_until <= now()
      and earning.convertible_credits > earning.reserved_credits
        + earning.transferred_credits + earning.reversed_credits
    order by earning.hold_until, earning.created_at, earning.id
    for update
  loop
    exit when v_remaining = 0;
    v_available_credits := v_earning.convertible_credits
      - v_earning.reserved_credits - v_earning.transferred_credits - v_earning.reversed_credits;
    v_available_minor := v_earning.amount_minor
      - v_earning.reserved_minor - v_earning.transferred_minor - v_earning.reversed_minor;
    v_take := least(v_remaining, v_available_credits);
    v_take_minor := case
      when v_take = v_available_credits then v_available_minor
      else floor(v_available_minor::numeric * v_take / v_available_credits)::integer
    end;
    if v_take_minor <= 0 then continue; end if;

    insert into billing.payout_items (payout_request_id, earning_id, credits, amount_minor)
    values (v_payout.id, v_earning.id, v_take, v_take_minor);
    update billing.seller_earnings
    set reserved_credits = reserved_credits + v_take,
        reserved_minor = reserved_minor + v_take_minor,
        status = 'reserved', updated_at = now()
    where id = v_earning.id;
    v_remaining := v_remaining - v_take;
    v_amount := v_amount + v_take_minor;
  end loop;

  if v_remaining <> 0 then
    raise exception 'billing_payout_earnings_insufficient' using errcode = 'P0001';
  end if;
  if v_amount < v_settings.minimum_payout_minor then
    raise exception 'billing_payout_below_minimum' using errcode = 'P0001';
  end if;

  v_lot_cash := billing.reserve_payout_lots(p_owner, v_payout.id, p_credits);
  if v_lot_cash < v_amount then
    raise exception 'billing_payout_backing_mismatch' using errcode = '23514';
  end if;

  update public.user_credit_accounts
  set earned_credits = earned_credits - p_credits,
      earned_convertible = earned_convertible - p_credits,
      balance = balance - p_credits,
      reserved = reserved + p_credits,
      updated_at = now()
  where owner_id = p_owner;

  insert into public.credit_transactions (
    owner_id, direction, amount, reason, idempotency_key,
    earned_delta, earned_convertible_delta, balance_after, metadata
  ) values (
    p_owner, 'reserved', p_credits, 'Prelievo venditore riservato',
    'payout:reserve:' || v_payout.id::text,
    -p_credits, -p_credits,
    (select balance from public.user_credit_accounts where owner_id = p_owner),
    jsonb_build_object('payout_request_id', v_payout.id, 'amount_minor', v_amount, 'currency', v_settings.currency)
  );

  update billing.payout_requests
  set amount_minor = v_amount, status = 'processing', updated_at = now()
  where id = v_payout.id
  returning * into v_payout;

  return jsonb_build_object(
    'request_id', v_payout.id,
    'status', v_payout.status,
    'stripe_account_id', v_account.stripe_account_id,
    'credits', p_credits,
    'amount_minor', v_amount,
    'currency', v_settings.currency,
    'idempotent', false
  );
end;
$$;

revoke all on function public.billing_reserve_payout(uuid, integer, text, boolean)
  from public, anon, authenticated;
grant execute on function public.billing_reserve_payout(uuid, integer, text, boolean) to service_role;

create or replace function public.billing_complete_payout(
  p_request uuid,
  p_stripe_transfer_id text
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_payout billing.payout_requests;
begin
  select * into v_payout from billing.payout_requests where id = p_request for update;
  if not found then raise exception 'billing_payout_not_found' using errcode = 'P0002'; end if;
  if v_payout.status in ('transferred', 'paid') then
    return jsonb_build_object('request_id', v_payout.id, 'status', v_payout.status, 'idempotent', true);
  end if;
  if v_payout.status <> 'processing' then
    raise exception 'billing_payout_not_completable' using errcode = 'P0001';
  end if;

  update billing.seller_earnings earning
  set reserved_credits = reserved_credits - item.credits,
      transferred_credits = transferred_credits + item.credits,
      reserved_minor = reserved_minor - item.amount_minor,
      transferred_minor = transferred_minor + item.amount_minor,
      status = case
        when earning.transferred_minor + item.amount_minor + earning.reversed_minor >= earning.amount_minor then 'transferred'
        else 'available'
      end,
      updated_at = now()
  from billing.payout_items item
  where item.payout_request_id = v_payout.id and item.earning_id = earning.id;

  update public.user_credit_accounts
  set reserved = reserved - v_payout.requested_credits, updated_at = now()
  where owner_id = v_payout.seller_id;

  update billing.payout_requests
  set status = 'transferred', stripe_transfer_id = p_stripe_transfer_id,
      completed_at = now(), updated_at = now()
  where id = v_payout.id
  returning * into v_payout;

  return jsonb_build_object('request_id', v_payout.id, 'status', v_payout.status, 'idempotent', false);
end;
$$;

revoke all on function public.billing_complete_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_complete_payout(uuid, text) to service_role;

create or replace function public.billing_fail_payout(
  p_request uuid,
  p_failure_code text,
  p_failure_message text
) returns jsonb
language plpgsql
security definer
set search_path = billing, public, pg_temp
as $$
declare
  v_payout billing.payout_requests;
  v_allocation billing.payout_lot_allocations;
begin
  select * into v_payout from billing.payout_requests where id = p_request for update;
  if not found then raise exception 'billing_payout_not_found' using errcode = 'P0002'; end if;
  if v_payout.status = 'failed' then
    return jsonb_build_object('request_id', v_payout.id, 'status', 'failed', 'idempotent', true);
  end if;
  if v_payout.status <> 'processing' or v_payout.stripe_transfer_id is not null then
    raise exception 'billing_payout_not_releasable' using errcode = 'P0001';
  end if;

  for v_allocation in
    select * from billing.payout_lot_allocations where payout_request_id = v_payout.id
  loop
    update public.credit_lots
    set units_remaining = units_remaining + v_allocation.units,
        cash_remaining_minor = cash_remaining_minor + v_allocation.cash_backing_minor,
        status = 'active', updated_at = now()
    where id = v_allocation.lot_id;
  end loop;

  update billing.seller_earnings earning
  set reserved_credits = reserved_credits - item.credits,
      reserved_minor = reserved_minor - item.amount_minor,
      status = 'available', updated_at = now()
  from billing.payout_items item
  where item.payout_request_id = v_payout.id and item.earning_id = earning.id;

  update public.user_credit_accounts
  set earned_credits = earned_credits + v_payout.requested_credits,
      earned_convertible = earned_convertible + v_payout.requested_credits,
      balance = balance + v_payout.requested_credits,
      reserved = reserved - v_payout.requested_credits,
      updated_at = now()
  where owner_id = v_payout.seller_id;

  insert into public.credit_transactions (
    owner_id, direction, amount, reason, idempotency_key,
    earned_delta, earned_convertible_delta, balance_after, metadata
  ) values (
    v_payout.seller_id, 'released', v_payout.requested_credits,
    'Prelievo venditore non completato', 'payout:release:' || v_payout.id::text,
    v_payout.requested_credits, v_payout.requested_credits,
    (select balance from public.user_credit_accounts where owner_id = v_payout.seller_id),
    jsonb_build_object('payout_request_id', v_payout.id, 'failure_code', p_failure_code)
  );

  update billing.payout_requests
  set status = 'failed', failure_code = left(coalesce(p_failure_code, 'stripe_transfer_failed'), 120),
      failure_message = left(coalesce(p_failure_message, 'Trasferimento non completato.'), 500),
      completed_at = now(), updated_at = now()
  where id = v_payout.id
  returning * into v_payout;

  return jsonb_build_object('request_id', v_payout.id, 'status', 'failed', 'idempotent', false);
end;
$$;

revoke all on function public.billing_fail_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.billing_fail_payout(uuid, text, text) to service_role;

-- Final grant audit: none of the privileged billing entrypoints is callable by
-- browser roles. This also protects against PostgreSQL's default PUBLIC EXECUTE.
do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.billing_get_config()',
    'public.billing_prepare_checkout(uuid,text,text,boolean,text,text,text)',
    'public.billing_attach_checkout(uuid,uuid,text,text,text,text,timestamptz,boolean)',
    'public.billing_portal_context(uuid,boolean)',
    'public.billing_get_status(uuid,uuid)',
    'public.billing_privacy_export(uuid)',
    'public.billing_store_webhook(text,boolean,text,text,text,text,jsonb)',
    'public.billing_finish_webhook(uuid,text,text)',
    'public.billing_mark_checkout_event(text,boolean,text,text,text,text)',
    'public.billing_apply_paid_checkout(text,boolean,text,text,text,integer,text,timestamptz)',
    'public.billing_sync_subscription(text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,timestamptz,timestamptz)',
    'public.billing_record_invoice_payment(text,text,text,text,boolean,text,integer,text,timestamptz)',
    'public.billing_apply_refund(text,boolean,text,text,text,integer,text,text)',
    'public.billing_apply_dispute(text,boolean,text,text,text,integer,text,text)',
    'public.billing_prepare_connect(uuid,boolean,text)',
    'public.billing_attach_connected_account(uuid,boolean,text,text,text,text,boolean,jsonb)',
    'public.billing_reserve_payout(uuid,integer,text,boolean)',
    'public.billing_complete_payout(uuid,text)',
    'public.billing_fail_payout(uuid,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

-- Deploy-time invariants. These abort the migration instead of allowing an
-- ambiguous wallet or cash liability to reach production.
do $$
begin
  if exists (
    select 1 from public.user_credit_accounts
    where balance <> free_credits + promotional_credits + purchased_credits + earned_credits
      or earned_convertible > earned_credits
      or reserved < 0
  ) then
    raise exception 'billing_wallet_invariant_failed' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.credit_lots
    where units_remaining > units_granted
      or cash_remaining_minor > cash_backing_minor
      or units_remaining < 0
      or cash_remaining_minor < 0
  ) then
    raise exception 'billing_lot_invariant_failed' using errcode = '23514';
  end if;
  if exists (
    select 1 from billing.offers
    where active and stripe_price_id is null
  ) then
    raise exception 'billing_active_offer_without_price' using errcode = '23514';
  end if;
end;
$$;
