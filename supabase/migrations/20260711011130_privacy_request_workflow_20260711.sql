-- Privacy operations are explicit, auditable workflows. Account erasure is
-- intentionally asynchronous: billing records and active disputes may require
-- retention or pseudonymisation instead of an unsafe cascade delete.

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references auth.users(id) on delete set null,
  requester_email_hash text not null check (char_length(requester_email_hash) = 64),
  request_type text not null check (request_type in ('access', 'export', 'rectification', 'erasure', 'restriction', 'objection')),
  status text not null default 'queued' check (status in ('queued', 'identity_check', 'in_progress', 'completed', 'partially_completed', 'rejected', 'cancelled')),
  public_message text,
  internal_payload jsonb not null default '{}'::jsonb,
  legal_hold boolean not null default false,
  legal_hold_reason text,
  requested_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((not legal_hold) or legal_hold_reason is not null)
);

create unique index if not exists privacy_requests_one_active_erasure_idx
  on public.privacy_requests (requester_id)
  where request_type = 'erasure' and status in ('queued', 'identity_check', 'in_progress');
create index if not exists privacy_requests_owner_created_idx
  on public.privacy_requests (requester_id, requested_at desc);
create index if not exists privacy_requests_operations_idx
  on public.privacy_requests (status, request_type, requested_at)
  where status in ('queued', 'identity_check', 'in_progress');

create table if not exists public.privacy_export_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  export_format text not null default 'json' check (export_format in ('json')),
  manifest_sha256 text not null check (char_length(manifest_sha256) = 64),
  datasets text[] not null default '{}',
  generated_at timestamptz not null default now()
);
create index if not exists privacy_export_events_owner_idx
  on public.privacy_export_events (owner_id, generated_at desc);

drop trigger if exists privacy_requests_set_updated_at on public.privacy_requests;
create trigger privacy_requests_set_updated_at
before update on public.privacy_requests
for each row execute function public.set_updated_at();

alter table public.privacy_requests enable row level security;
alter table public.privacy_export_events enable row level security;

drop policy if exists "Users read own privacy requests" on public.privacy_requests;
create policy "Users read own privacy requests"
on public.privacy_requests for select to authenticated
using ((select auth.uid()) = requester_id);

drop policy if exists "Users read own privacy exports" on public.privacy_export_events;
create policy "Users read own privacy exports"
on public.privacy_export_events for select to authenticated
using ((select auth.uid()) = owner_id);

revoke all on public.privacy_requests from public, anon, authenticated;
revoke all on public.privacy_export_events from public, anon, authenticated;
grant select (
  id,
  requester_id,
  request_type,
  status,
  public_message,
  legal_hold,
  requested_at,
  acknowledged_at,
  completed_at,
  cancelled_at,
  updated_at
) on public.privacy_requests to authenticated;
grant select on public.privacy_export_events to authenticated;
grant all on public.privacy_requests to service_role;
grant all on public.privacy_export_events to service_role;

comment on table public.privacy_requests is
  'Auditable GDPR/consumer privacy workflow. internal_payload is service-role only; browser users can only read their own request state.';
comment on table public.privacy_export_events is
  'Audit metadata for generated exports. The export payload itself is never retained in this table.';
