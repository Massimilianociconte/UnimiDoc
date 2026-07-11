-- ============================================================================
-- Secure purchase flow — closes a critical access-control hole.
--
-- BEFORE: `document_purchases` had a client INSERT policy
--   ("Buyers create own purchases", with check auth.uid() = buyer_id).
-- The `document-access` Edge Function treats any purchase row as proof of
-- purchase and unlocks ALL preview pages (and the original download when the
-- policy allows). A user could therefore INSERT their own purchase row from the
-- client and unlock a paid document WITHOUT spending a single credit.
--
-- AFTER: purchases can only be created by `purchase_document(...)`, a
-- SECURITY DEFINER function that atomically checks the balance, deducts the
-- buyer's credits, credits the seller's payout, records both ledger entries and
-- inserts the purchase row. The client INSERT policy is removed, so the only
-- path to a purchase row is the paid one.
-- ============================================================================

-- Authoritative price lives on the document (set at publish time), not on the
-- client, so it can't be spoofed at purchase time.
alter table public.documents
  add column if not exists price_credits integer
  check (price_credits is null or price_credits between 0 and 250);

-- Remove the insecure client-side purchase insert. Purchases go through the
-- SECURITY DEFINER function below only.
drop policy if exists "Buyers create own purchases" on public.document_purchases;

-- Seller payout share in credits (mirrors PLATFORM_COMMISSION = 0.30 in
-- src/lib/creditPricing.ts: the seller keeps 70% of the price in credits).
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
  v_seller_credits integer;
  v_balance integer;
  v_purchase public.document_purchases;
begin
  if v_buyer is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select * into v_doc from public.documents where id = p_document_id;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  -- Only published documents can be bought; owners never "buy" their own file.
  if v_doc.owner_id = v_buyer then
    raise exception 'own_document' using errcode = 'P0001';
  end if;
  if v_doc.visibility <> 'published' then
    raise exception 'not_purchasable' using errcode = 'P0001';
  end if;

  -- Idempotent: if already purchased, just return the existing row.
  select * into v_purchase
  from public.document_purchases
  where document_id = p_document_id and buyer_id = v_buyer;
  if found then
    return v_purchase;
  end if;

  v_price := coalesce(v_doc.price_credits, 0);
  if v_price <= 0 then
    raise exception 'price_unavailable' using errcode = 'P0001';
  end if;

  -- Lock the buyer's account row to make balance check + deduction atomic.
  select balance into v_balance
  from public.user_credit_accounts
  where owner_id = v_buyer
  for update;
  if not found or v_balance < v_price then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  update public.user_credit_accounts
  set balance = balance - v_price,
      lifetime_spent = lifetime_spent + v_price,
      updated_at = now()
  where owner_id = v_buyer;

  insert into public.document_purchases (document_id, buyer_id, credits_spent)
  values (p_document_id, v_buyer, v_price)
  returning * into v_purchase;

  insert into public.credit_transactions (owner_id, document_id, purchase_id, direction, amount, reason)
  values (v_buyer, p_document_id, v_purchase.id, 'spent', v_price, 'Acquisto documento');

  -- Credit the seller 70% of the price (platform keeps 30%). Only credited if
  -- the seller still has an account row.
  v_seller_credits := floor(v_price * 0.7);
  if v_seller_credits > 0 then
    update public.user_credit_accounts
    set balance = balance + v_seller_credits,
        lifetime_earned = lifetime_earned + v_seller_credits,
        updated_at = now()
    where owner_id = v_doc.owner_id;

    if found then
      insert into public.credit_transactions (owner_id, document_id, purchase_id, direction, amount, reason)
      values (v_doc.owner_id, p_document_id, v_purchase.id, 'earned', v_seller_credits, 'Vendita documento');
    end if;
  end if;

  return v_purchase;
end;
$$;

-- Callable by authenticated users; the function enforces all the rules above.
revoke all on function public.purchase_document(uuid) from public;
grant execute on function public.purchase_document(uuid) to authenticated;
