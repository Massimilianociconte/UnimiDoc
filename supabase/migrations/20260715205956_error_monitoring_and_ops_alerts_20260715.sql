-- Monitoraggio centralizzato:
-- 1) client_errors: errori del frontend (insert-only dai ruoli API, lettura
--    solo service role). Niente contenuti documenti/query private: il client
--    sanifica e tronca prima dell'invio; qui vincoli difensivi su lunghezza.
-- 2) app_private.ops_metrics(): fotografia operativa (backlog worker, dead
--    letter, errori, crescita DB/storage, spesa AI, cron falliti).
-- 3) app_private.ops_alerts + evaluate_ops_alerts(): valutazione soglie ogni
--    15 minuti via pg_cron; il canale di consegna (email/webhook) si aggancia
--    leggendo le righe non riconosciute (vedi docs/OPERATIONS_MONITORING.md).

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  release text not null default 'dev',
  environment text not null default 'production',
  event_type text not null default 'error',
  message text not null,
  stack text,
  url_path text,
  correlation_id uuid,
  breadcrumbs jsonb not null default '[]'::jsonb,
  user_agent text,
  constraint client_errors_event_type_check check (event_type in ('error', 'unhandledrejection', 'react', 'manual')),
  constraint client_errors_message_len check (char_length(message) between 1 and 2000),
  constraint client_errors_stack_len check (stack is null or char_length(stack) <= 8000),
  constraint client_errors_release_len check (char_length(release) <= 64),
  constraint client_errors_environment_len check (char_length(environment) <= 32),
  constraint client_errors_url_len check (url_path is null or char_length(url_path) <= 300),
  constraint client_errors_ua_len check (user_agent is null or char_length(user_agent) <= 300),
  constraint client_errors_breadcrumbs_size check (pg_column_size(breadcrumbs) <= 16384)
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
create index if not exists client_errors_release_idx on public.client_errors (release, created_at desc);

alter table public.client_errors enable row level security;

revoke all on table public.client_errors from anon, authenticated;
grant insert (user_id, release, environment, event_type, message, stack, url_path, correlation_id, breadcrumbs, user_agent)
  on public.client_errors to anon, authenticated;

drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- Retention 30 giorni.
create or replace function app_private.purge_old_client_errors()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$ delete from public.client_errors where created_at < now() - interval '30 days' $$;
revoke all on function app_private.purge_old_client_errors() from public, anon, authenticated;

-- ── Metriche operative ───────────────────────────────────────────────────────
create or replace function app_private.ops_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'worker_backlog', (select count(*) from public.pdf_processing_jobs where status in ('queued', 'retry_wait')),
    'worker_oldest_queued_minutes', coalesce((
      select extract(epoch from now() - min(available_at)) / 60
      from public.pdf_processing_jobs where status in ('queued', 'retry_wait')), 0),
    'worker_stuck_leases', (
      select count(*) from public.pdf_processing_jobs
      where status = 'running' and lease_expires_at < now() - interval '5 minutes'),
    'jobs_dead_lettered_24h', (
      select count(*) from public.pdf_processing_jobs
      where status = 'dead_lettered' and updated_at > now() - interval '24 hours'),
    'jobs_failed_24h', (
      select count(*) from public.pdf_processing_job_attempts
      where outcome in ('failed', 'dead_lettered') and created_at > now() - interval '24 hours'),
    'ocr_failures_24h', (
      select count(*) from public.pdf_processing_job_attempts a
      join public.pdf_processing_jobs j on j.id = a.job_id
      where j.job_type = 'ocr' and a.outcome in ('failed', 'dead_lettered')
        and a.created_at > now() - interval '24 hours'),
    'client_errors_24h', (
      select count(*) from public.client_errors where created_at > now() - interval '24 hours'),
    'ai_cost_month_usd', coalesce((
      select sum(estimated_cost_usd) from public.ai_cost_ledger
      where created_at > date_trunc('month', now())), 0),
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((
      select sum(coalesce((metadata->>'size')::bigint, 0)) from storage.objects), 0),
    'cron_failures_24h', (
      select count(*) from cron.job_run_details
      where status = 'failed' and end_time > now() - interval '24 hours')
  )
$$;
revoke all on function app_private.ops_metrics() from public, anon, authenticated;

-- ── Alert su soglie ──────────────────────────────────────────────────────────
create table if not exists app_private.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  severity text not null check (severity in ('warning', 'critical')),
  metric text not null,
  value numeric not null,
  threshold numeric not null,
  message text not null,
  acknowledged_at timestamptz
);
create index if not exists ops_alerts_open_idx on app_private.ops_alerts (metric, created_at desc) where acknowledged_at is null;

create or replace function app_private.evaluate_ops_alerts()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m jsonb := app_private.ops_metrics();
  inserted integer := 0;

  procedure_check record;
begin
  -- Un alert per metrica al massimo ogni 6 ore finché non viene riconosciuto.
  for procedure_check in
    select * from (values
      ('worker_backlog',               (m->>'worker_backlog')::numeric,               25::numeric, 'warning',  'Backlog worker PDF sopra soglia'),
      ('worker_oldest_queued_minutes', (m->>'worker_oldest_queued_minutes')::numeric, 30::numeric, 'critical', 'Job PDF in coda da oltre 30 minuti: verificare che il worker sia vivo'),
      ('worker_stuck_leases',          (m->>'worker_stuck_leases')::numeric,           1::numeric, 'warning',  'Lease worker scaduti da oltre 5 minuti non ripresi'),
      ('jobs_dead_lettered_24h',       (m->>'jobs_dead_lettered_24h')::numeric,        1::numeric, 'critical', 'Job PDF in dead-letter nelle ultime 24h'),
      ('ocr_failures_24h',             (m->>'ocr_failures_24h')::numeric,              5::numeric, 'warning',  'Fallimenti OCR anomali nelle ultime 24h'),
      ('client_errors_24h',            (m->>'client_errors_24h')::numeric,            50::numeric, 'warning',  'Errori frontend anomali nelle ultime 24h'),
      ('cron_failures_24h',            (m->>'cron_failures_24h')::numeric,             1::numeric, 'critical', 'Job pianificati falliti nelle ultime 24h'),
      ('ai_cost_month_usd',            (m->>'ai_cost_month_usd')::numeric,            50::numeric, 'warning',  'Spesa AI mensile sopra soglia')
    ) as checks(metric, value, threshold, severity, message)
  loop
    if procedure_check.value >= procedure_check.threshold and not exists (
      select 1 from app_private.ops_alerts a
      where a.metric = procedure_check.metric
        and a.acknowledged_at is null
        and a.created_at > now() - interval '6 hours'
    ) then
      insert into app_private.ops_alerts (severity, metric, value, threshold, message)
      values (procedure_check.severity, procedure_check.metric, procedure_check.value, procedure_check.threshold, procedure_check.message);
      inserted := inserted + 1;
    end if;
  end loop;

  return inserted;
end;
$$;
revoke all on function app_private.evaluate_ops_alerts() from public, anon, authenticated;

do $do$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'evaluate-ops-alerts';
exception when others then null;
end $do$;
select cron.schedule('evaluate-ops-alerts', '*/15 * * * *', $$select app_private.evaluate_ops_alerts()$$);

do $do$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-client-errors';
exception when others then null;
end $do$;
select cron.schedule('purge-client-errors', '15 4 * * *', $$select app_private.purge_old_client_errors()$$);
