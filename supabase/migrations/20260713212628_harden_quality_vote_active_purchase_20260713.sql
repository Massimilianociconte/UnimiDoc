-- Quality vote must require an ACTIVE purchase (refunded/revoked buyers should
-- not keep the right to influence a document's flashcard-quality ranking).
create or replace function public.set_flashcard_quality_vote(p_flashcard_id uuid, p_vote smallint)
 returns flashcard_quality_votes
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_document uuid;
  v_author uuid;
  v_public_enabled boolean;
  v_public_name text;
  v_vote public.flashcard_quality_votes;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select
    flashcard.document_id,
    document.owner_id,
    profile.seller_profile_enabled,
    profile.public_display_name
  into v_document, v_author, v_public_enabled, v_public_name
  from public.flashcards flashcard
  join public.documents document on document.id = flashcard.document_id
  left join public.profiles profile on profile.id = document.owner_id
  where flashcard.id = p_flashcard_id
    and flashcard.status <> 'deleted';

  if not found then
    raise exception 'flashcard_not_accessible' using errcode = 'P0001';
  end if;
  if v_author = v_user then
    raise exception 'author_cannot_vote' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.document_purchases purchase
    where purchase.document_id = v_document
      and purchase.buyer_id = v_user
      and purchase.status = 'active'
  ) then
    raise exception 'purchase_required_for_quality_vote' using errcode = '42501';
  end if;

  v_vote := public.set_flashcard_quality_vote_internal(p_flashcard_id, p_vote);
  if not (v_public_enabled and v_public_name is not null) then
    update public.flashcard_quality_votes
    set document_author_id = null
    where id = v_vote.id
      and owner_id = v_user
    returning * into v_vote;
  end if;
  return v_vote;
end;
$function$;
