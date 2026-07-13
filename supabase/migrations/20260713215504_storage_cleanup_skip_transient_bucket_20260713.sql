-- Refinement: `document-upload` (cancel) already removes transient
-- `processing-temp` objects itself, and the PDF worker owns that bucket's
-- lifecycle. Only enqueue DURABLE artifacts (original in private-documents,
-- previews in derived-previews) that nothing else would clean up on delete.
create or replace function public.enqueue_document_storage_cleanup()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
begin
  if old.storage_path is not null
     and coalesce(old.storage_bucket, 'private-documents') <> 'processing-temp' then
    insert into public.storage_cleanup_queue (bucket, path, document_id, owner_id)
    values (coalesce(old.storage_bucket, 'private-documents'), old.storage_path, old.id, old.owner_id);
  end if;
  insert into public.storage_cleanup_queue (bucket, path, document_id, owner_id)
  select coalesce(p.storage_bucket, 'derived-previews'), p.storage_path, old.id, old.owner_id
  from public.document_previews p
  where p.document_id = old.id
    and p.storage_path is not null
    and coalesce(p.storage_bucket, 'derived-previews') <> 'processing-temp';
  return old;
end;
$$;
