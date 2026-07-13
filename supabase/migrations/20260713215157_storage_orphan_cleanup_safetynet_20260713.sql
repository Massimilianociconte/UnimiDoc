-- Deleting a documents row cascades all child DB rows, but the Storage objects
-- (original PDF in private-documents, preview images in derived-previews) are
-- NOT rows and would be orphaned. This safety-net captures their paths on any
-- documents DELETE into a service-role-only queue, so a GC worker can remove
-- them via the Storage API. Non-destructive: fires only on DELETE and never
-- blocks existing operations.
create table if not exists public.storage_cleanup_queue (
  id           bigint generated always as identity primary key,
  bucket       text not null,
  path         text not null,
  document_id  uuid,
  owner_id     uuid,
  reason       text not null default 'document_deleted',
  enqueued_at  timestamptz not null default now(),
  processed_at timestamptz,
  attempts     integer not null default 0,
  last_error   text
);
alter table public.storage_cleanup_queue enable row level security;
-- No policy on purpose: reachable only by service_role (queue is server-internal).
create index if not exists storage_cleanup_queue_pending_idx
  on public.storage_cleanup_queue (enqueued_at) where processed_at is null;

create or replace function public.enqueue_document_storage_cleanup()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
begin
  -- Original document object.
  if old.storage_path is not null then
    insert into public.storage_cleanup_queue (bucket, path, document_id, owner_id)
    values (coalesce(old.storage_bucket, 'private-documents'), old.storage_path, old.id, old.owner_id);
  end if;
  -- Derived preview objects (still present in BEFORE DELETE, before FK cascade).
  insert into public.storage_cleanup_queue (bucket, path, document_id, owner_id)
  select coalesce(p.storage_bucket, 'derived-previews'), p.storage_path, old.id, old.owner_id
  from public.document_previews p
  where p.document_id = old.id and p.storage_path is not null;
  return old;
end;
$$;

drop trigger if exists documents_enqueue_storage_cleanup on public.documents;
create trigger documents_enqueue_storage_cleanup
  before delete on public.documents
  for each row execute function public.enqueue_document_storage_cleanup();
