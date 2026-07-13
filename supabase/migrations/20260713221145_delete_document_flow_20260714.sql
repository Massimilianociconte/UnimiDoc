-- Document deletion flow.
--  * Sold document (>=1 active purchase by another user) -> SOFT delete:
--    visibility='withdrawn'. Purchases/earnings preserved; buyers keep the
--    access they paid for (access checks grant buyers regardless of visibility);
--    listing leaves the public catalog (rankings filter visibility='published').
--  * Otherwise -> HARD delete: FK cascade removes children and the BEFORE DELETE
--    trigger enqueues durable Storage objects into storage_cleanup_queue.
alter table public.documents drop constraint if exists documents_visibility_check;
alter table public.documents add constraint documents_visibility_check
  check (visibility = any (array['private'::text,'submitted'::text,'published'::text,'rejected'::text,'withdrawn'::text]));

alter table public.documents add column if not exists withdrawn_at timestamptz;

create or replace function public.delete_document(p_document_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_visibility text;
  v_external_active integer;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select owner_id, visibility into v_owner, v_visibility
  from public.documents where id = p_document_id;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if v_owner <> v_user then
    raise exception 'not_document_owner' using errcode = '42501';
  end if;

  select count(*) into v_external_active
  from public.document_purchases p
  where p.document_id = p_document_id
    and p.buyer_id <> v_user
    and p.status = 'active';

  if v_external_active > 0 then
    if v_visibility = 'withdrawn' then
      return jsonb_build_object('mode','soft','document_id',p_document_id,'already',true,'active_buyers',v_external_active);
    end if;
    update public.documents
    set visibility = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where id = p_document_id;
    return jsonb_build_object('mode','soft','document_id',p_document_id,'active_buyers',v_external_active);
  end if;

  delete from public.documents where id = p_document_id;
  return jsonb_build_object('mode','hard','document_id',p_document_id);
end;
$$;

revoke all on function public.delete_document(uuid) from public;
grant execute on function public.delete_document(uuid) to authenticated;
