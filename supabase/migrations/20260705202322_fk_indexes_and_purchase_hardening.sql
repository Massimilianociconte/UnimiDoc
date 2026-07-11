-- Applied to the live project on 2026-07-05 as `fk_indexes_and_purchase_hardening`.
--
-- 1) Covering indexes for every advisor-flagged foreign key (fast owner/document
--    lookups and fast cascaded deletes from documents/flashcards/auth.users).
-- 2) purchase_document: re-check for an existing purchase AFTER acquiring the
--    FOR UPDATE lock on the buyer's credit account. Concurrent double-clicks
--    previously surfaced a raw unique_violation; now the RPC is idempotent.

create index if not exists ai_cost_ledger_document_idx on public.ai_cost_ledger (document_id);
create index if not exists ai_helps_flashcard_idx on public.ai_helps (flashcard_id);
create index if not exists credit_transactions_document_idx on public.credit_transactions (document_id);
create index if not exists credit_transactions_purchase_idx on public.credit_transactions (purchase_id);
create index if not exists document_assets_owner_idx on public.document_assets (owner_id);
create index if not exists document_blocks_owner_idx on public.document_blocks (owner_id);
create index if not exists document_outline_owner_idx on public.document_outline (owner_id);
create index if not exists document_previews_owner_idx on public.document_previews (owner_id);
create index if not exists document_quality_reports_owner_idx on public.document_quality_reports (owner_id);
create index if not exists document_study_progress_document_idx on public.document_study_progress (document_id);
create index if not exists flashcard_generation_cache_owner_idx on public.flashcard_generation_cache (owner_id);
create index if not exists image_occlusion_masks_document_idx on public.image_occlusion_masks (document_id);
create index if not exists image_occlusion_masks_owner_idx on public.image_occlusion_masks (owner_id);
create index if not exists image_occlusion_sets_document_idx on public.image_occlusion_sets (document_id);
create index if not exists ocr_runs_owner_idx on public.ocr_runs (owner_id);
create index if not exists quiz_attempts_document_idx on public.quiz_attempts (document_id);
create index if not exists review_tasks_document_idx on public.review_tasks (document_id);
create index if not exists review_tasks_flashcard_idx on public.review_tasks (flashcard_id);
create index if not exists srs_state_flashcard_idx on public.srs_state (flashcard_id);
create index if not exists study_sessions_document_idx on public.study_sessions (document_id);
create index if not exists user_answers_flashcard_idx on public.user_answers (flashcard_id);
create index if not exists user_library_items_document_idx on public.user_library_items (document_id);

create or replace function public.purchase_document(p_document_id uuid)
returns public.document_purchases
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_buyer uuid := auth.uid();
  v_doc public.documents;
  v_price integer;
  v_free integer; v_purchased integer; v_earned integer; v_earned_convertible integer;
  v_free_avail integer; v_use_free integer; v_use_purchased integer; v_use_earned integer;
  v_earned_nonconvertible integer; v_use_earned_convertible integer;
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

  select free_credits, purchased_credits, earned_credits, earned_convertible
    into v_free, v_purchased, v_earned, v_earned_convertible
  from public.user_credit_accounts where owner_id = v_buyer for update;
  if not found then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;

  -- Re-check under the account lock: a concurrent call for the same buyer has
  -- to wait on the FOR UPDATE above, so this makes the RPC fully idempotent.
  select * into v_purchase from public.document_purchases
  where document_id = p_document_id and buyer_id = v_buyer;
  if found then return v_purchase; end if;

  v_free_avail := case when v_price <= 30 then v_free else 0 end;
  if v_free_avail + v_purchased + v_earned < v_price then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  v_use_free := least(v_free_avail, v_price);
  v_use_purchased := least(v_purchased, v_price - v_use_free);
  v_use_earned := v_price - v_use_free - v_use_purchased;
  v_earned_nonconvertible := v_earned - v_earned_convertible;
  v_use_earned_convertible := greatest(0, v_use_earned - v_earned_nonconvertible);

  update public.user_credit_accounts
  set free_credits = free_credits - v_use_free,
      purchased_credits = purchased_credits - v_use_purchased,
      earned_credits = earned_credits - v_use_earned,
      earned_convertible = earned_convertible - v_use_earned_convertible,
      balance = balance - v_price,
      lifetime_spent = lifetime_spent + v_price,
      updated_at = now()
  where owner_id = v_buyer;

  insert into public.document_purchases (document_id, buyer_id, credits_spent)
  values (p_document_id, v_buyer, v_price)
  returning * into v_purchase;

  insert into public.credit_transactions (owner_id, document_id, purchase_id, direction, amount, reason, metadata)
  values (
    v_buyer,
    p_document_id,
    v_purchase.id,
    'spent',
    v_price,
    'Acquisto documento',
    jsonb_build_object(
      'free_credits', v_use_free,
      'purchased_credits', v_use_purchased,
      'earned_credits', v_use_earned,
      'earned_convertible', v_use_earned_convertible
    )
  );

  v_seller_convertible := floor((v_use_purchased + v_use_earned_convertible) * 0.7);
  v_seller_nonconv := floor((v_use_free + v_use_earned - v_use_earned_convertible) * 0.7);
  if v_seller_convertible + v_seller_nonconv > 0 then
    insert into public.user_credit_accounts (owner_id, balance, free_credits, purchased_credits, earned_credits)
    values (v_doc.owner_id, 0, 0, 0, 0)
    on conflict (owner_id) do nothing;

    update public.user_credit_accounts
    set earned_credits = earned_credits + v_seller_convertible + v_seller_nonconv,
        earned_convertible = earned_convertible + v_seller_convertible,
        balance = balance + v_seller_convertible + v_seller_nonconv,
        lifetime_earned = lifetime_earned + v_seller_convertible + v_seller_nonconv,
        updated_at = now()
    where owner_id = v_doc.owner_id;

    if found then
      insert into public.credit_transactions (owner_id, document_id, purchase_id, direction, amount, reason, metadata)
      values (
        v_doc.owner_id,
        p_document_id,
        v_purchase.id,
        'earned',
        v_seller_convertible + v_seller_nonconv,
        'Vendita documento',
        jsonb_build_object('convertible', v_seller_convertible, 'non_convertible', v_seller_nonconv)
      );
    end if;
  end if;

  return v_purchase;
end;
$function$;

revoke execute on function public.purchase_document(uuid) from anon, public;
grant execute on function public.purchase_document(uuid) to authenticated, service_role;
