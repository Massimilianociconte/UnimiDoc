-- Access-after-refund hardening: only an ACTIVE (non-refunded/revoked) purchase
-- should grant document / RAG / flashcard-vote access. No behavioural change today
-- (default status='active', and no flow sets another status yet), but this makes
-- the access checks correct once a revoke/refund flow lands. Mirrors the status
-- semantics already used by public_document_rankings / document_ranking_signals.

create or replace function public.rag_accessible_document_ids(p_user uuid)
 returns table(document_id uuid)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select d.id
  from public.documents d
  where p_user is not null
    and (
      d.owner_id = p_user
      or exists (
        select 1
        from public.document_purchases purchase
        where purchase.document_id = d.id
          and purchase.buyer_id = p_user
          and purchase.status = 'active'
      )
      or (
        d.visibility = 'published'
        and d.price_credits = 0
      )
      or (
        d.visibility = 'published'
        and d.preview_policy = 'premium_full'
        and exists (
          select 1
          from public.user_entitlements entitlement
          where entitlement.owner_id = p_user
            and entitlement.plan = 'premium'
            and (entitlement.premium_until is null or entitlement.premium_until > now())
        )
      )
    )
$function$;

create or replace function public.user_can_access_flashcard(p_flashcard_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.flashcards f
    join public.documents d on d.id = f.document_id
    where f.id = p_flashcard_id
      and f.status <> 'deleted'
      and (
        f.owner_id = (select auth.uid())
        or d.owner_id = (select auth.uid())
        or exists (
          select 1
          from public.document_purchases p
          where p.document_id = f.document_id
            and p.buyer_id = (select auth.uid())
            and p.status = 'active'
        )
      )
  );
$function$;
