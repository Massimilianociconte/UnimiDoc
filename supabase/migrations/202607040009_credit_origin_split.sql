-- ============================================================================
-- Credit origin split + free-credit anti-abuse (GDPR-minimal).
--
-- Mirrors src/lib/creditsWallet.ts: the balance is split by ORIGIN so free
-- (welcome) credits can be treated differently from purchased/earned ones —
-- notably, free credits only unlock low-cost documents and never make the
-- platform pay a seller real cash (see credits-economy.md).
--
-- Invariant: balance = free_credits + purchased_credits + earned_credits.
-- The generic `balance` column is kept as the fast-read total.
-- ============================================================================

alter table public.user_credit_accounts
  add column if not exists free_credits integer not null default 0 check (free_credits >= 0),
  add column if not exists purchased_credits integer not null default 0 check (purchased_credits >= 0),
  add column if not exists earned_credits integer not null default 0 check (earned_credits >= 0),
  -- Portion of earned_credits backed by real money (withdrawable). The rest is
  -- non-convertible (funded by buyers spending their free welcome credits).
  add column if not exists earned_convertible integer not null default 0 check (earned_convertible >= 0);

-- Ledger direction vocabulary: add 'welcome' and 'purchased' as first-class
-- origins so the dashboard can render an honest, typed history.
alter table public.credit_transactions
  drop constraint if exists credit_transactions_direction_check;
alter table public.credit_transactions
  add constraint credit_transactions_direction_check
  check (direction in ('welcome', 'purchased', 'earned', 'spent', 'reserved', 'released', 'adjusted'));

-- ---------------------------------------------------------------------------
-- Anti-abuse for the welcome bonus (GDPR-minimal, data-minimisation first):
--   • The 30 welcome credits are granted at most ONCE per account, and only
--     after the email is verified (Supabase email confirmation is ON). We do
--     NOT collect phone numbers, device fingerprints or any extra PII — email
--     verification + one-account-per-verified-email is a standard, proportionate
--     control. Duplicate-account farming is further limited by the auth layer's
--     unique-email constraint.
--   • The grant is recorded as a 'welcome' ledger row, which doubles as the
--     idempotency marker (no second grant if one already exists).
-- ---------------------------------------------------------------------------

create or replace function public.grant_welcome_credits(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_confirmed timestamptz;
  v_welcome integer := 30;
begin
  -- Only for verified emails.
  select email_confirmed_at into v_email_confirmed from auth.users where id = p_user;
  if v_email_confirmed is null then
    return;
  end if;

  -- Idempotent: never grant twice.
  if exists (
    select 1 from public.credit_transactions
    where owner_id = p_user and direction = 'welcome'
  ) then
    return;
  end if;

  insert into public.user_credit_accounts (owner_id, balance, free_credits)
  values (p_user, v_welcome, v_welcome)
  on conflict (owner_id) do update
    set balance = public.user_credit_accounts.balance + v_welcome,
        free_credits = public.user_credit_accounts.free_credits + v_welcome,
        updated_at = now();

  insert into public.credit_transactions (owner_id, direction, amount, reason)
  values (p_user, 'welcome', v_welcome, 'Bonus di benvenuto');
end;
$$;

revoke all on function public.grant_welcome_credits(uuid) from public;
grant execute on function public.grant_welcome_credits(uuid) to authenticated;

-- Keep purchase_document (202607040008) consuming free credits first, then
-- purchased, then earned. The function is updated here to respect the split and
-- the free-credit eligibility rule (free credits only on docs priced <= 30).
create or replace function public.purchase_document(p_document_id uuid)
returns public.document_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := auth.uid();
  v_doc public.documents;
  v_price integer;
  v_free integer; v_purchased integer; v_earned integer;
  v_free_avail integer; v_use_free integer; v_use_purchased integer; v_use_earned integer;
  v_seller_convertible integer; v_seller_nonconv integer;
  v_purchase public.document_purchases;
begin
  if v_buyer is null then raise exception 'auth_required' using errcode = '28000'; end if;

  select * into v_doc from public.documents where id = p_document_id;
  if not found then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if v_doc.owner_id = v_buyer then raise exception 'own_document' using errcode = 'P0001'; end if;
  if v_doc.visibility <> 'published' then raise exception 'not_purchasable' using errcode = 'P0001'; end if;

  select * into v_purchase from public.document_purchases
  where document_id = p_document_id and buyer_id = v_buyer;
  if found then return v_purchase; end if;

  v_price := coalesce(v_doc.price_credits, 0);
  if v_price <= 0 then raise exception 'price_unavailable' using errcode = 'P0001'; end if;

  select free_credits, purchased_credits, earned_credits
    into v_free, v_purchased, v_earned
  from public.user_credit_accounts where owner_id = v_buyer for update;
  if not found then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;

  -- Free credits only apply to low-cost documents (<= 30 credits).
  v_free_avail := case when v_price <= 30 then v_free else 0 end;
  if v_free_avail + v_purchased + v_earned < v_price then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  -- Consume free -> purchased -> earned.
  v_use_free := least(v_free_avail, v_price);
  v_use_purchased := least(v_purchased, v_price - v_use_free);
  v_use_earned := v_price - v_use_free - v_use_purchased;

  update public.user_credit_accounts
  set free_credits = free_credits - v_use_free,
      purchased_credits = purchased_credits - v_use_purchased,
      earned_credits = earned_credits - v_use_earned,
      balance = balance - v_price,
      lifetime_spent = lifetime_spent + v_price,
      updated_at = now()
  where owner_id = v_buyer;

  insert into public.document_purchases (document_id, buyer_id, credits_spent)
  values (p_document_id, v_buyer, v_price)
  returning * into v_purchase;

  insert into public.credit_transactions (owner_id, document_id, purchase_id, direction, amount, reason)
  values (v_buyer, p_document_id, v_purchase.id, 'spent', v_price, 'Acquisto documento');

  -- Seller payout: paid part (purchased+earned) is convertible, free part is not.
  v_seller_convertible := floor((v_use_purchased + v_use_earned) * 0.7);
  v_seller_nonconv := floor(v_use_free * 0.7);
  if v_seller_convertible + v_seller_nonconv > 0 then
    update public.user_credit_accounts
    set earned_credits = earned_credits + v_seller_convertible + v_seller_nonconv,
        earned_convertible = earned_convertible + v_seller_convertible,
        balance = balance + v_seller_convertible + v_seller_nonconv,
        lifetime_earned = lifetime_earned + v_seller_convertible + v_seller_nonconv,
        updated_at = now()
    where owner_id = v_doc.owner_id;

    if found then
      insert into public.credit_transactions (owner_id, document_id, purchase_id, direction, amount, reason)
      values (v_doc.owner_id, p_document_id, v_purchase.id, 'earned', v_seller_convertible + v_seller_nonconv, 'Vendita documento');
    end if;
  end if;

  return v_purchase;
end;
$$;

revoke all on function public.purchase_document(uuid) from public;
grant execute on function public.purchase_document(uuid) to authenticated;
