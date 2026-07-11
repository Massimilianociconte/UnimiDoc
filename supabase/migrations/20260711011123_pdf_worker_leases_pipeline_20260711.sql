-- ============================================================================
-- Production PDF worker: durable runs, dependency-aware jobs, leases, retries,
-- dead-letter handling and versioned document artifacts.
--
-- The browser/Edge upload endpoint only verifies that the expected object exists
-- and enqueues a run. A container worker performs byte hashing, qpdf/Poppler/OCR
-- work and writes artifacts with the run's immutable artifact_version. The final
-- quality-review commit switches all artifacts atomically.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Document-level processing projection.
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists analysis_status text not null default 'not_started'
    check (analysis_status in ('not_started', 'queued', 'processing', 'ready', 'partial', 'failed', 'cancelled')),
  add column if not exists analysis_progress smallint not null default 0
    check (analysis_progress between 0 and 100),
  add column if not exists analysis_stage text,
  add column if not exists analysis_error_code text,
  add column if not exists analysis_updated_at timestamptz,
  add column if not exists active_processing_run_id uuid,
  add column if not exists processing_version text;

create table if not exists public.pdf_processing_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  pipeline_version text not null check (char_length(pipeline_version) between 1 and 80),
  artifact_version text not null check (char_length(artifact_version) between 1 and 120),
  requested_tier text not null default 'base' check (requested_tier in ('free', 'base', 'premium')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'partial', 'failed', 'cancelled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  current_stage text,
  jobs_total smallint not null default 0 check (jobs_total >= 0),
  jobs_succeeded smallint not null default 0 check (jobs_succeeded >= 0),
  jobs_failed smallint not null default 0 check (jobs_failed >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, input_hash, pipeline_version),
  unique (artifact_version)
);

alter table public.documents
  drop constraint if exists documents_active_processing_run_id_fkey;
alter table public.documents
  add constraint documents_active_processing_run_id_fkey
  foreign key (active_processing_run_id)
  references public.pdf_processing_runs(id)
  on delete set null;

drop trigger if exists pdf_processing_runs_set_updated_at on public.pdf_processing_runs;
create trigger pdf_processing_runs_set_updated_at
before update on public.pdf_processing_runs
for each row execute function public.set_updated_at();

create index if not exists pdf_processing_runs_owner_created_idx
  on public.pdf_processing_runs (owner_id, created_at desc);
create index if not exists pdf_processing_runs_document_created_idx
  on public.pdf_processing_runs (document_id, created_at desc);
create index if not exists pdf_processing_runs_status_idx
  on public.pdf_processing_runs (status, created_at)
  where status in ('queued', 'processing');

-- ---------------------------------------------------------------------------
-- Turn the existing job table into a real lease-based work queue. Legacy rows
-- deliberately keep run_id/idempotency_key NULL and are not claimable.
-- ---------------------------------------------------------------------------

alter table public.pdf_processing_jobs
  drop constraint if exists pdf_processing_jobs_status_check;
alter table public.pdf_processing_jobs
  add constraint pdf_processing_jobs_status_check
  check (status in (
    'queued', 'running', 'retry_wait', 'succeeded', 'skipped',
    'failed', 'dead_lettered', 'cancelled'
  ));

alter table public.pdf_processing_jobs
  drop constraint if exists pdf_processing_jobs_job_type_check;
alter table public.pdf_processing_jobs
  add constraint pdf_processing_jobs_job_type_check
  check (job_type in (
    'compress', 'extract', 'ocr', 'flashcards', 'quality_review',
    'classify', 'layout', 'figures', 'outline', 'rag_index', 'cleanup'
  ));

alter table public.pdf_processing_jobs
  drop constraint if exists pdf_processing_jobs_document_type_input_key;

alter table public.pdf_processing_jobs
  add column if not exists run_id uuid references public.pdf_processing_runs(id) on delete cascade,
  add column if not exists pipeline_version text not null default 'legacy',
  add column if not exists idempotency_key text,
  add column if not exists priority smallint not null default 100 check (priority between -1000 and 1000),
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  add column if not exists lease_token uuid,
  add column if not exists leased_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists progress smallint not null default 0 check (progress between 0 and 100),
  add column if not exists progress_stage text,
  add column if not exists result jsonb not null default '{}'::jsonb;

alter table public.pdf_processing_jobs
  add constraint pdf_processing_jobs_idempotency_key_length_check
  check (idempotency_key is null or char_length(idempotency_key) between 3 and 180);

create unique index if not exists pdf_processing_jobs_idempotency_idx
  on public.pdf_processing_jobs (idempotency_key)
  where idempotency_key is not null;
create index if not exists pdf_processing_jobs_claim_idx
  on public.pdf_processing_jobs (priority desc, available_at, created_at)
  where status in ('queued', 'retry_wait');
create index if not exists pdf_processing_jobs_lease_idx
  on public.pdf_processing_jobs (lease_expires_at)
  where status = 'running';
create index if not exists pdf_processing_jobs_run_status_idx
  on public.pdf_processing_jobs (run_id, status, created_at);

create table if not exists public.pdf_processing_job_dependencies (
  job_id uuid not null references public.pdf_processing_jobs(id) on delete cascade,
  prerequisite_job_id uuid not null references public.pdf_processing_jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, prerequisite_job_id),
  check (job_id <> prerequisite_job_id)
);

create index if not exists pdf_processing_job_dependencies_prerequisite_idx
  on public.pdf_processing_job_dependencies (prerequisite_job_id, job_id);

-- Technical attempt diagnostics are service-only. pdf_processing_jobs contains
-- only public-safe error_code/error_message fields visible to the owner.
create table if not exists public.pdf_processing_job_attempts (
  id bigint generated by default as identity primary key,
  job_id uuid not null references public.pdf_processing_jobs(id) on delete cascade,
  run_id uuid not null references public.pdf_processing_runs(id) on delete cascade,
  attempt_no smallint not null check (attempt_no > 0),
  worker_id text,
  outcome text not null check (outcome in (
    'succeeded', 'skipped', 'retry_scheduled', 'failed', 'dead_lettered', 'lease_expired'
  )),
  error_code text,
  technical_error jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  unique (job_id, attempt_no, outcome)
);

create index if not exists pdf_processing_job_attempts_run_idx
  on public.pdf_processing_job_attempts (run_id, created_at desc);
create index if not exists pdf_processing_job_attempts_error_idx
  on public.pdf_processing_job_attempts (error_code, created_at desc)
  where error_code is not null;

-- ---------------------------------------------------------------------------
-- Version all derived artifacts. New rows are staged with is_active=false; the
-- final quality-review transaction activates one coherent artifact_version.
-- ---------------------------------------------------------------------------

alter table public.pdf_pages
  add column if not exists processing_run_id uuid references public.pdf_processing_runs(id) on delete set null,
  add column if not exists artifact_version text not null default 'legacy',
  add column if not exists is_active boolean not null default true,
  add column if not exists ocr_text text,
  add column if not exists resolved_text text not null default '',
  add column if not exists resolved_text_sha256 text
    check (resolved_text_sha256 is null or char_length(resolved_text_sha256) = 64),
  add column if not exists resolved_text_source text not null default 'none'
    check (resolved_text_source in ('native', 'ocr', 'mixed', 'none')),
  add column if not exists ocr_engine text,
  add column if not exists ocr_engine_version text,
  add column if not exists ocr_reason text;

update public.pdf_pages
set
  resolved_text = coalesce(native_text, ''),
  resolved_text_source = case when coalesce(native_text, '') = '' then 'none' else 'native' end
where artifact_version = 'legacy'
  and resolved_text = '';

alter table public.pdf_pages
  drop constraint if exists pdf_pages_document_id_page_number_key;
create unique index if not exists pdf_pages_document_version_page_idx
  on public.pdf_pages (document_id, artifact_version, page_number);
create unique index if not exists pdf_pages_one_active_page_idx
  on public.pdf_pages (document_id, page_number)
  where is_active;
create index if not exists pdf_pages_run_idx
  on public.pdf_pages (processing_run_id, page_number);

alter table public.pdf_chunks
  add column if not exists processing_run_id uuid references public.pdf_processing_runs(id) on delete set null,
  add column if not exists artifact_version text not null default 'legacy',
  add column if not exists is_active boolean not null default true,
  add column if not exists chunking_version text not null default 'legacy',
  add column if not exists source_text_sha256 text
    check (source_text_sha256 is null or char_length(source_text_sha256) = 64);

alter table public.pdf_chunks
  drop constraint if exists pdf_chunks_document_id_chunk_index_key;
create unique index if not exists pdf_chunks_document_version_index_idx
  on public.pdf_chunks (document_id, artifact_version, chunk_index);
create unique index if not exists pdf_chunks_one_active_index_idx
  on public.pdf_chunks (document_id, chunk_index)
  where is_active;
create index if not exists pdf_chunks_active_document_idx
  on public.pdf_chunks (document_id, chunk_index)
  where is_active and processing_state <> 'failed';
create index if not exists pdf_chunks_run_idx
  on public.pdf_chunks (processing_run_id, chunk_index);

alter table public.document_blocks
  add column if not exists processing_run_id uuid references public.pdf_processing_runs(id) on delete set null,
  add column if not exists artifact_version text not null default 'legacy',
  add column if not exists artifact_key text,
  add column if not exists is_active boolean not null default true,
  add column if not exists content_sha256 text
    check (content_sha256 is null or char_length(content_sha256) = 64);
update public.document_blocks set artifact_key = id::text where artifact_key is null;
alter table public.document_blocks alter column artifact_key set not null;
create unique index if not exists document_blocks_version_key_idx
  on public.document_blocks (document_id, artifact_version, artifact_key);
create index if not exists document_blocks_active_doc_page_idx
  on public.document_blocks (document_id, page_number, reading_order)
  where is_active;

alter table public.document_assets
  add column if not exists processing_run_id uuid references public.pdf_processing_runs(id) on delete set null,
  add column if not exists artifact_version text not null default 'legacy',
  add column if not exists artifact_key text,
  add column if not exists is_active boolean not null default true;
update public.document_assets set artifact_key = id::text where artifact_key is null;
alter table public.document_assets alter column artifact_key set not null;
create unique index if not exists document_assets_version_key_idx
  on public.document_assets (document_id, artifact_version, artifact_key);
create index if not exists document_assets_active_doc_page_idx
  on public.document_assets (document_id, page_number)
  where is_active;

alter table public.document_outline
  add column if not exists processing_run_id uuid references public.pdf_processing_runs(id) on delete set null,
  add column if not exists artifact_version text not null default 'legacy',
  add column if not exists artifact_key text,
  add column if not exists parent_ordinal integer,
  add column if not exists is_active boolean not null default true;
update public.document_outline set artifact_key = id::text where artifact_key is null;
alter table public.document_outline alter column artifact_key set not null;
create unique index if not exists document_outline_version_key_idx
  on public.document_outline (document_id, artifact_version, artifact_key);
with ranked_outline as (
  select
    id,
    row_number() over (
      partition by document_id, ordinal
      order by created_at desc, id desc
    ) as duplicate_rank
  from public.document_outline
  where is_active
)
update public.document_outline outline
set is_active = false
from ranked_outline ranked
where outline.id = ranked.id
  and ranked.duplicate_rank > 1;
create unique index if not exists document_outline_one_active_ordinal_idx
  on public.document_outline (document_id, ordinal)
  where is_active;
create index if not exists document_outline_run_idx
  on public.document_outline (processing_run_id, ordinal);

alter table public.document_quality_reports
  add column if not exists processing_run_id uuid references public.pdf_processing_runs(id) on delete set null,
  add column if not exists artifact_version text not null default 'legacy',
  add column if not exists metrics jsonb not null default '{}'::jsonb;

alter table public.ocr_runs
  add column if not exists job_id uuid references public.pdf_processing_jobs(id) on delete set null,
  add column if not exists processing_run_id uuid references public.pdf_processing_runs(id) on delete set null,
  add column if not exists engine_version text,
  add column if not exists pages_requested integer not null default 0 check (pages_requested >= 0),
  add column if not exists pages_succeeded integer not null default 0 check (pages_succeeded >= 0),
  add column if not exists pages_failed integer not null default 0 check (pages_failed >= 0),
  add column if not exists duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  add column if not exists error_code text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;
create unique index if not exists ocr_runs_job_idx
  on public.ocr_runs (job_id)
  where job_id is not null;

-- Owners see only the active artifact version. Historical rows remain for
-- provenance and old flashcard foreign keys but are service-only.
drop policy if exists "Users can read own pages" on public.pdf_pages;
create policy "Users can read own active pages"
  on public.pdf_pages for select to authenticated
  using ((select auth.uid()) = owner_id and is_active);

drop policy if exists "Users can read own chunks" on public.pdf_chunks;
create policy "Users can read own active chunks"
  on public.pdf_chunks for select to authenticated
  using ((select auth.uid()) = owner_id and is_active);

drop policy if exists "Owners read own document_blocks" on public.document_blocks;
create policy "Owners read own active document_blocks"
  on public.document_blocks for select to authenticated
  using ((select auth.uid()) = owner_id and is_active);

drop policy if exists "Owners read own document_assets" on public.document_assets;
create policy "Owners read own active document_assets"
  on public.document_assets for select to authenticated
  using ((select auth.uid()) = owner_id and is_active);

drop policy if exists "Owners read own document_outline" on public.document_outline;
create policy "Owners read own active document_outline"
  on public.document_outline for select to authenticated
  using ((select auth.uid()) = owner_id and is_active);

alter table public.pdf_processing_runs enable row level security;
alter table public.pdf_processing_job_dependencies enable row level security;
alter table public.pdf_processing_job_attempts enable row level security;

drop policy if exists "Users can read own processing runs" on public.pdf_processing_runs;
create policy "Users can read own processing runs"
  on public.pdf_processing_runs for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.pdf_processing_job_dependencies from public, anon, authenticated;
revoke all on public.pdf_processing_job_attempts from public, anon, authenticated;
grant select on public.pdf_processing_runs to authenticated;
grant select on public.pdf_processing_jobs to authenticated;
grant select on public.pdf_processing_runs, public.pdf_processing_jobs to service_role;
grant all on public.pdf_processing_job_dependencies, public.pdf_processing_job_attempts to service_role;

-- ---------------------------------------------------------------------------
-- Atomic enqueue. All seven stages are materialized up-front; dependencies make
-- only the next valid stage claimable. Existing runs are returned unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_pdf_processing_run(
  p_document uuid,
  p_owner uuid,
  p_input_hash text,
  p_pipeline_version text default 'pdf-worker-v1',
  p_requested_tier text default 'base',
  p_page_count integer default null,
  p_language text default null
)
returns table (run_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document public.documents%rowtype;
  v_run uuid;
  v_created boolean := false;
  v_stage text;
  v_job uuid;
  v_jobs jsonb := '{}'::jsonb;
  v_artifact_version text;
  v_existing_status text;
begin
  if p_owner is null or p_document is null then
    raise exception 'owner_and_document_required' using errcode = '22023';
  end if;
  if p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_input_hash' using errcode = '22023';
  end if;
  if char_length(coalesce(p_pipeline_version, '')) not between 1 and 80 then
    raise exception 'invalid_pipeline_version' using errcode = '22023';
  end if;
  if p_requested_tier not in ('free', 'base', 'premium') then
    raise exception 'invalid_requested_tier' using errcode = '22023';
  end if;

  select * into v_document
  from public.documents
  where id = p_document
  for update;

  if not found or v_document.owner_id <> p_owner then
    raise exception 'document_owner_mismatch' using errcode = '42501';
  end if;
  if lower(v_document.original_file_sha256) <> lower(p_input_hash) then
    raise exception 'document_hash_mismatch' using errcode = '22023';
  end if;
  if v_document.storage_bucket <> 'processing-temp'
     and coalesce(v_document.metadata->>'upload_state', '') <> 'verified_submitted' then
    raise exception 'document_not_uploaded' using errcode = '22023';
  end if;

  select id, status into v_run, v_existing_status
  from public.pdf_processing_runs
  where document_id = p_document
    and input_hash = lower(p_input_hash)
    and pipeline_version = p_pipeline_version;

  if v_run is null then
    v_run := gen_random_uuid();
    v_artifact_version := p_pipeline_version || ':' || v_run::text;
    insert into public.pdf_processing_runs (
      id, document_id, owner_id, input_hash, pipeline_version,
      artifact_version, requested_tier, status, progress, current_stage,
      jobs_total
    ) values (
      v_run, p_document, p_owner, lower(p_input_hash), p_pipeline_version,
      v_artifact_version, p_requested_tier, 'queued', 0, 'verifying', 7
    );
    v_created := true;
  else
    select artifact_version into v_artifact_version
    from public.pdf_processing_runs where id = v_run;

    -- An explicit finalize/retry request can resume a terminal run without
    -- duplicating successful stages or creating a second artifact version.
    if v_existing_status in ('failed', 'cancelled') then
      update public.pdf_processing_jobs job
      set
        status = 'queued',
        attempts = 0,
        available_at = now(),
        lease_token = null,
        leased_at = null,
        lease_expires_at = null,
        heartbeat_at = null,
        worker_id = null,
        progress = 0,
        progress_stage = 'waiting_for_dependency',
        error_code = null,
        error_message = null,
        started_at = null,
        finished_at = null
      where job.run_id = v_run
        and job.status in ('failed', 'dead_lettered', 'cancelled');

      update public.pdf_processing_runs
      set
        status = 'queued',
        progress = 0,
        current_stage = 'verifying',
        jobs_failed = 0,
        started_at = null,
        finished_at = null
      where id = v_run;
    end if;
  end if;

  if v_created then
    foreach v_stage in array array[
      'compress', 'extract', 'ocr', 'layout', 'figures', 'outline', 'quality_review'
    ] loop
      insert into public.pdf_processing_jobs (
        run_id, document_id, owner_id, job_type, requested_tier, status,
        attempts, input_hash, settings_hash, generation_mode, pipeline_version,
        idempotency_key, priority, available_at, max_attempts, progress,
        progress_stage
      ) values (
        v_run, p_document, p_owner, v_stage, p_requested_tier, 'queued',
        0, lower(p_input_hash), null, p_requested_tier, p_pipeline_version,
        v_run::text || ':' || v_stage,
        case v_stage
          when 'compress' then 300
          when 'extract' then 250
          when 'ocr' then 220
          when 'layout' then 180
          when 'outline' then 150
          when 'figures' then 140
          else 100
        end,
        now(),
        case when v_stage = 'ocr' then 4 else 5 end,
        0,
        case when v_stage = 'compress' then 'waiting_for_verification' else 'waiting_for_dependency' end
      )
      returning id into v_job;
      v_jobs := v_jobs || jsonb_build_object(v_stage, v_job);
    end loop;

    insert into public.pdf_processing_job_dependencies (job_id, prerequisite_job_id)
    values
      ((v_jobs->>'extract')::uuid, (v_jobs->>'compress')::uuid),
      ((v_jobs->>'ocr')::uuid, (v_jobs->>'extract')::uuid),
      ((v_jobs->>'layout')::uuid, (v_jobs->>'ocr')::uuid),
      ((v_jobs->>'figures')::uuid, (v_jobs->>'layout')::uuid),
      ((v_jobs->>'outline')::uuid, (v_jobs->>'layout')::uuid),
      ((v_jobs->>'quality_review')::uuid, (v_jobs->>'figures')::uuid),
      ((v_jobs->>'quality_review')::uuid, (v_jobs->>'outline')::uuid);
  end if;

  update public.documents
  set
    page_count = case
      when p_page_count between 1 and 2000 then p_page_count
      else page_count
    end,
    language = coalesce(nullif(left(trim(p_language), 12), ''), language),
    analysis_status = case
      when analysis_status in ('ready', 'partial') and active_processing_run_id = v_run then analysis_status
      else 'queued'
    end,
    analysis_progress = case
      when analysis_status in ('ready', 'partial') and active_processing_run_id = v_run then analysis_progress
      else 0
    end,
    analysis_stage = case
      when analysis_status in ('ready', 'partial') and active_processing_run_id = v_run then analysis_stage
      else 'verifying'
    end,
    analysis_error_code = null,
    analysis_updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'upload_state', case
        when metadata->>'upload_state' = 'verified_submitted' then 'verified_submitted'
        else 'verification_queued'
      end,
      'processing_run_id', v_run,
      'processing_pipeline_version', p_pipeline_version,
      'finalize_requested_at', now()
    )
  where id = p_document and owner_id = p_owner;

  return query select v_run, v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim/reclaim. The returned JSON is the worker's complete authoritative input
-- and includes a per-attempt lease token required by every mutation.
-- ---------------------------------------------------------------------------

create or replace function public.claim_pdf_processing_job(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_allowed_job_types text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.pdf_processing_jobs%rowtype;
  v_payload jsonb;
  v_lease integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
begin
  if char_length(trim(coalesce(p_worker_id, ''))) not between 1 and 120 then
    raise exception 'invalid_worker_id' using errcode = '22023';
  end if;

  insert into public.pdf_processing_job_attempts (
    job_id, run_id, attempt_no, worker_id, outcome, error_code,
    technical_error, started_at, finished_at, duration_ms
  )
  select
    job.id, job.run_id, job.attempts, job.worker_id, 'lease_expired',
    'lease_expired', '{}'::jsonb, job.leased_at, now(),
    greatest(0, (extract(epoch from (now() - coalesce(job.leased_at, job.started_at, job.created_at))) * 1000)::bigint)
  from public.pdf_processing_jobs job
  where job.status = 'running'
    and job.run_id is not null
    and job.lease_expires_at < now()
  on conflict (job_id, attempt_no, outcome) do nothing;

  update public.pdf_processing_jobs
  set
    status = case when attempts >= max_attempts then 'dead_lettered' else 'retry_wait' end,
    available_at = case
      when attempts >= max_attempts then available_at
      else now() + make_interval(secs => least(21600, 30 * (2 ^ greatest(0, attempts - 1))))
    end,
    error_code = 'lease_expired',
    error_message = 'Elaborazione interrotta: recupero automatico in corso.',
    lease_token = null,
    lease_expires_at = null,
    heartbeat_at = null,
    worker_id = null,
    finished_at = case when attempts >= max_attempts then now() else null end,
    progress_stage = case when attempts >= max_attempts then 'dead_lettered' else 'retry_wait' end
  where status = 'running'
    and run_id is not null
    and lease_expires_at < now();

  -- A lease that expires on the final permitted attempt is terminal. Cancel
  -- blocked dependants immediately so runs cannot remain "processing" forever.
  update public.pdf_processing_jobs dependant
  set
    status = 'cancelled',
    finished_at = now(),
    error_code = 'prerequisite_dead_lettered',
    error_message = 'Elaborazione interrotta dopo il numero massimo di tentativi.',
    progress_stage = 'cancelled'
  where dependant.status in ('queued', 'retry_wait')
    and exists (
      select 1
      from public.pdf_processing_jobs terminal
      where terminal.run_id = dependant.run_id
        and terminal.status = 'dead_lettered'
        and terminal.error_code = 'lease_expired'
    );

  update public.pdf_processing_runs run
  set status = 'failed', current_stage = 'dead_lettered', jobs_failed = 1, finished_at = now()
  where run.status in ('queued', 'processing')
    and exists (
      select 1 from public.pdf_processing_jobs job
      where job.run_id = run.id and job.status = 'dead_lettered'
    );

  update public.documents document
  set
    analysis_status = 'failed',
    analysis_stage = 'dead_lettered',
    analysis_error_code = 'lease_expired',
    analysis_updated_at = now()
  where exists (
    select 1 from public.pdf_processing_runs run
    where run.document_id = document.id and run.status = 'failed' and run.current_stage = 'dead_lettered'
  )
    and document.analysis_status in ('queued', 'processing');

  with candidate as (
    select job.id
    from public.pdf_processing_jobs job
    join public.pdf_processing_runs run on run.id = job.run_id
    join public.documents document on document.id = job.document_id
    where job.run_id is not null
      and job.idempotency_key is not null
      and job.status in ('queued', 'retry_wait')
      and job.available_at <= now()
      and job.attempts < job.max_attempts
      and run.status in ('queued', 'processing')
      and (p_allowed_job_types is null or job.job_type = any(p_allowed_job_types))
      and (
        job.job_type = 'compress'
        or coalesce(document.metadata->>'upload_state', '') = 'verified_submitted'
      )
      and not exists (
        select 1
        from public.pdf_processing_job_dependencies dependency
        join public.pdf_processing_jobs prerequisite
          on prerequisite.id = dependency.prerequisite_job_id
        where dependency.job_id = job.id
          and prerequisite.status not in ('succeeded', 'skipped')
      )
    order by job.priority desc, job.available_at, job.created_at, job.id
    for update of job skip locked
    limit 1
  )
  update public.pdf_processing_jobs job
  set
    status = 'running',
    attempts = job.attempts + 1,
    lease_token = gen_random_uuid(),
    leased_at = now(),
    lease_expires_at = now() + make_interval(secs => v_lease),
    heartbeat_at = now(),
    worker_id = left(trim(p_worker_id), 120),
    started_at = coalesce(job.started_at, now()),
    finished_at = null,
    error_code = null,
    error_message = null,
    progress_stage = 'claimed'
  from candidate
  where job.id = candidate.id
  returning job.* into v_job;

  if v_job.id is null then
    return null;
  end if;

  update public.pdf_processing_runs
  set
    status = 'processing',
    current_stage = v_job.job_type,
    started_at = coalesce(started_at, now())
  where id = v_job.run_id;

  update public.documents
  set
    analysis_status = 'processing',
    analysis_stage = v_job.job_type,
    analysis_updated_at = now(),
    compression_status = case when v_job.job_type = 'compress' then 'running' else compression_status end
  where id = v_job.document_id;

  select jsonb_build_object(
    'jobId', v_job.id,
    'runId', v_job.run_id,
    'documentId', v_job.document_id,
    'ownerId', v_job.owner_id,
    'jobType', v_job.job_type,
    'requestedTier', v_job.requested_tier,
    'attempt', v_job.attempts,
    'maxAttempts', v_job.max_attempts,
    'leaseToken', v_job.lease_token,
    'leaseExpiresAt', v_job.lease_expires_at,
    'pipelineVersion', run.pipeline_version,
    'artifactVersion', run.artifact_version,
    'inputHash', run.input_hash,
    'storageBucket', document.storage_bucket,
    'storagePath', document.storage_path,
    'originalSizeBytes', document.original_size_bytes,
    'mimeType', document.mime_type,
    'language', coalesce(document.language, 'it'),
    'metadata', document.metadata
  ) into v_payload
  from public.pdf_processing_runs run
  join public.documents document on document.id = run.document_id
  where run.id = v_job.run_id;

  return v_payload;
end;
$$;

create or replace function public.heartbeat_pdf_processing_job(
  p_job uuid,
  p_lease_token uuid,
  p_progress integer,
  p_stage text,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run uuid;
  v_document uuid;
  v_updated integer;
  v_progress integer := greatest(0, least(coalesce(p_progress, 0), 99));
  v_lease integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
begin
  update public.pdf_processing_jobs
  set
    progress = v_progress,
    progress_stage = left(nullif(trim(p_stage), ''), 120),
    heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => v_lease)
  where id = p_job
    and status = 'running'
    and lease_token = p_lease_token
    and lease_expires_at >= now()
  returning run_id, document_id into v_run, v_document;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then return false; end if;

  update public.pdf_processing_runs
  set current_stage = left(nullif(trim(p_stage), ''), 120)
  where id = v_run;
  update public.documents
  set analysis_stage = left(nullif(trim(p_stage), ''), 120), analysis_updated_at = now()
  where id = v_document;
  return true;
end;
$$;

-- Refresh run/document projections after any terminal job transition.
create or replace function public.refresh_pdf_processing_run(p_run uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document uuid;
  v_total integer;
  v_done integer;
  v_failed integer;
  v_progress integer;
  v_next_stage text;
begin
  select document_id into v_document from public.pdf_processing_runs where id = p_run for update;
  if v_document is null then return; end if;

  select
    count(*),
    count(*) filter (where status in ('succeeded', 'skipped')),
    count(*) filter (where status in ('failed', 'dead_lettered'))
  into v_total, v_done, v_failed
  from public.pdf_processing_jobs where run_id = p_run;

  v_progress := case when v_total = 0 then 0 else floor((v_done::numeric / v_total::numeric) * 100)::integer end;

  select job.job_type into v_next_stage
  from public.pdf_processing_jobs job
  where job.run_id = p_run
    and job.status in ('queued', 'retry_wait', 'running')
  order by
    case job.status when 'running' then 0 else 1 end,
    job.priority desc,
    job.created_at
  limit 1;

  update public.pdf_processing_runs
  set
    progress = greatest(progress, least(v_progress, 99)),
    jobs_total = v_total,
    jobs_succeeded = v_done,
    jobs_failed = v_failed,
    current_stage = coalesce(v_next_stage, current_stage)
  where id = p_run;

  update public.documents
  set
    analysis_progress = greatest(analysis_progress, least(v_progress, 99)),
    analysis_stage = coalesce(v_next_stage, analysis_stage),
    analysis_updated_at = now()
  where id = v_document;
end;
$$;

create or replace function public.complete_pdf_processing_job(
  p_job uuid,
  p_lease_token uuid,
  p_result jsonb default '{}'::jsonb,
  p_skipped boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.pdf_processing_jobs%rowtype;
  v_run public.pdf_processing_runs%rowtype;
  v_document public.documents%rowtype;
  v_partial boolean := coalesce((p_result->>'partial')::boolean, false);
  v_quality jsonb := coalesce(p_result->'qualityReport', '{}'::jsonb);
  v_bucket text;
  v_path text;
  v_original_hash text;
  v_compressed_hash text;
  v_compressed_size bigint;
begin
  select * into v_job
  from public.pdf_processing_jobs
  where id = p_job
  for update;

  if not found
     or v_job.status <> 'running'
     or v_job.lease_token <> p_lease_token
     or v_job.lease_expires_at < now() then
    return false;
  end if;

  select * into v_run from public.pdf_processing_runs where id = v_job.run_id for update;
  select * into v_document from public.documents where id = v_job.document_id for update;

  if v_job.job_type = 'compress' then
    v_bucket := p_result->>'storageBucket';
    v_path := p_result->>'storagePath';
    v_original_hash := lower(p_result->>'originalSha256');
    v_compressed_hash := lower(p_result->>'compressedSha256');
    v_compressed_size := nullif(p_result->>'compressedSizeBytes', '')::bigint;

    if v_bucket <> 'private-documents'
       or v_path is null
       or v_path !~ ('^' || v_job.owner_id::text || '/documents/' || v_job.document_id::text || '/source/[0-9a-f]{64}[.]pdf$')
       or v_original_hash <> lower(v_document.original_file_sha256)
       or v_compressed_hash !~ '^[0-9a-f]{64}$'
       or v_compressed_size is null
       or v_compressed_size <= 0 then
      raise exception 'invalid_compression_result' using errcode = '22023';
    end if;

    update public.documents
    set
      storage_bucket = v_bucket,
      storage_path = v_path,
      compressed_file_sha256 = v_compressed_hash,
      compressed_size_bytes = v_compressed_size,
      page_count = coalesce(nullif(p_result->>'pageCount', '')::integer, page_count),
      compression_status = case
        when p_result->>'compressionMethod' = 'qpdf_lossless' then 'compressed'
        else 'kept_original'
      end,
      visibility = case when visibility = 'private' then 'submitted' else visibility end,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'upload_state', 'verified_submitted',
        'verified_sha256', v_original_hash,
        'verified_at', now(),
        'canonical_storage_path', v_path
      )
    where id = v_job.document_id;
  end if;

  update public.pdf_processing_jobs
  set
    status = case when p_skipped then 'skipped' else 'succeeded' end,
    progress = 100,
    progress_stage = case when p_skipped then 'skipped' else 'completed' end,
    result = coalesce(p_result, '{}'::jsonb),
    finished_at = now(),
    heartbeat_at = now(),
    lease_token = null,
    lease_expires_at = null
  where id = p_job;

  insert into public.pdf_processing_job_attempts (
    job_id, run_id, attempt_no, worker_id, outcome, metrics,
    started_at, finished_at, duration_ms
  ) values (
    v_job.id, v_job.run_id, v_job.attempts, v_job.worker_id,
    case when p_skipped then 'skipped' else 'succeeded' end,
    coalesce(p_result->'metrics', '{}'::jsonb),
    v_job.leased_at, now(),
    greatest(0, (extract(epoch from (now() - coalesce(v_job.leased_at, now()))) * 1000)::bigint)
  )
  on conflict (job_id, attempt_no, outcome) do nothing;

  if v_job.job_type = 'quality_review' then
    -- Deactivate first so partial unique indexes never observe two active rows.
    update public.pdf_pages set is_active = false
      where document_id = v_job.document_id and is_active;
    update public.pdf_chunks set is_active = false
      where document_id = v_job.document_id and is_active;
    update public.document_blocks set is_active = false
      where document_id = v_job.document_id and is_active;
    update public.document_assets set is_active = false
      where document_id = v_job.document_id and is_active;
    update public.document_outline set is_active = false
      where document_id = v_job.document_id and is_active;

    update public.pdf_pages set is_active = true
      where processing_run_id = v_job.run_id and artifact_version = v_run.artifact_version;
    update public.pdf_chunks set is_active = true
      where processing_run_id = v_job.run_id and artifact_version = v_run.artifact_version;
    update public.document_blocks set is_active = true
      where processing_run_id = v_job.run_id and artifact_version = v_run.artifact_version;
    update public.document_assets set is_active = true
      where processing_run_id = v_job.run_id and artifact_version = v_run.artifact_version;
    update public.document_outline set is_active = true
      where processing_run_id = v_job.run_id and artifact_version = v_run.artifact_version;

    insert into public.document_quality_reports (
      document_id, owner_id, native_text_quality, ocr_quality,
      scanned_pages_pct, figures_detected, tables_detected, formulas_detected,
      outline_reliable, readability, overall_score, issues,
      outline_confidence, outline_strategy, outline_ai_recommended,
      processing_run_id, artifact_version, metrics, computed_at
    ) values (
      v_job.document_id,
      v_job.owner_id,
      nullif(v_quality->>'nativeTextQuality', '')::numeric,
      nullif(v_quality->>'ocrQuality', '')::numeric,
      nullif(v_quality->>'scannedPagesPct', '')::numeric,
      coalesce(nullif(v_quality->>'figuresDetected', '')::integer, 0),
      coalesce(nullif(v_quality->>'tablesDetected', '')::integer, 0),
      coalesce(nullif(v_quality->>'formulasDetected', '')::integer, 0),
      coalesce((v_quality->>'outlineReliable')::boolean, false),
      nullif(v_quality->>'readability', '')::numeric,
      nullif(v_quality->>'overallScore', '')::numeric,
      coalesce(v_quality->'issues', '[]'::jsonb),
      nullif(v_quality->>'outlineConfidence', '')::numeric,
      nullif(v_quality->>'outlineStrategy', ''),
      coalesce((v_quality->>'outlineAiRecommended')::boolean, false),
      v_job.run_id,
      v_run.artifact_version,
      coalesce(p_result->'metrics', '{}'::jsonb),
      now()
    )
    on conflict (document_id) do update set
      owner_id = excluded.owner_id,
      native_text_quality = excluded.native_text_quality,
      ocr_quality = excluded.ocr_quality,
      scanned_pages_pct = excluded.scanned_pages_pct,
      figures_detected = excluded.figures_detected,
      tables_detected = excluded.tables_detected,
      formulas_detected = excluded.formulas_detected,
      outline_reliable = excluded.outline_reliable,
      readability = excluded.readability,
      overall_score = excluded.overall_score,
      issues = excluded.issues,
      outline_confidence = excluded.outline_confidence,
      outline_strategy = excluded.outline_strategy,
      outline_ai_recommended = excluded.outline_ai_recommended,
      processing_run_id = excluded.processing_run_id,
      artifact_version = excluded.artifact_version,
      metrics = excluded.metrics,
      computed_at = excluded.computed_at;

    update public.pdf_processing_runs
    set
      status = case when v_partial then 'partial' else 'ready' end,
      progress = 100,
      current_stage = 'completed',
      jobs_succeeded = (
        select count(*) from public.pdf_processing_jobs
        where run_id = v_job.run_id and status in ('succeeded', 'skipped')
      ),
      jobs_failed = 0,
      finished_at = now()
    where id = v_job.run_id;

    update public.documents
    set
      analysis_status = case when v_partial then 'partial' else 'ready' end,
      analysis_progress = 100,
      analysis_stage = 'completed',
      analysis_error_code = null,
      analysis_updated_at = now(),
      active_processing_run_id = v_job.run_id,
      processing_version = v_run.pipeline_version,
      normalized_text_sha256 = coalesce(nullif(p_result->>'normalizedTextSha256', ''), normalized_text_sha256),
      rag_status = case
        when exists (
          select 1 from public.pdf_chunks chunk
          where chunk.processing_run_id = v_job.run_id and chunk.is_active
        ) then 'queued'
        else 'not_indexed'
      end
    where id = v_job.document_id;
  else
    perform public.refresh_pdf_processing_run(v_job.run_id);
  end if;

  return true;
end;
$$;

create or replace function public.fail_pdf_processing_job(
  p_job uuid,
  p_lease_token uuid,
  p_error_code text,
  p_public_message text,
  p_retryable boolean,
  p_technical_error jsonb default '{}'::jsonb,
  p_metrics jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.pdf_processing_jobs%rowtype;
  v_status text;
  v_backoff integer;
begin
  select * into v_job
  from public.pdf_processing_jobs
  where id = p_job
  for update;

  if not found
     or v_job.status <> 'running'
     or v_job.lease_token <> p_lease_token
     or v_job.lease_expires_at < now() then
    return 'lost_lease';
  end if;

  if coalesce(p_retryable, false) and v_job.attempts < v_job.max_attempts then
    v_status := 'retry_wait';
    v_backoff := least(
      21600,
      (30 * (2 ^ greatest(0, v_job.attempts - 1)))::integer
        + floor(random() * 16)::integer
    );
  elsif coalesce(p_retryable, false) then
    v_status := 'dead_lettered';
    v_backoff := 0;
  else
    v_status := 'failed';
    v_backoff := 0;
  end if;

  update public.pdf_processing_jobs
  set
    status = v_status,
    available_at = case when v_status = 'retry_wait' then now() + make_interval(secs => v_backoff) else available_at end,
    error_code = left(coalesce(nullif(trim(p_error_code), ''), 'processing_failed'), 120),
    error_message = left(coalesce(nullif(trim(p_public_message), ''), 'Elaborazione non riuscita.'), 500),
    progress_stage = v_status,
    finished_at = case when v_status in ('failed', 'dead_lettered') then now() else null end,
    heartbeat_at = now(),
    lease_token = null,
    lease_expires_at = null
  where id = v_job.id;

  insert into public.pdf_processing_job_attempts (
    job_id, run_id, attempt_no, worker_id, outcome, error_code,
    technical_error, metrics, started_at, finished_at, duration_ms
  ) values (
    v_job.id,
    v_job.run_id,
    v_job.attempts,
    v_job.worker_id,
    case v_status
      when 'retry_wait' then 'retry_scheduled'
      when 'dead_lettered' then 'dead_lettered'
      else 'failed'
    end,
    left(coalesce(nullif(trim(p_error_code), ''), 'processing_failed'), 120),
    coalesce(p_technical_error, '{}'::jsonb),
    coalesce(p_metrics, '{}'::jsonb),
    v_job.leased_at,
    now(),
    greatest(0, (extract(epoch from (now() - coalesce(v_job.leased_at, now()))) * 1000)::bigint)
  )
  on conflict (job_id, attempt_no, outcome) do nothing;

  if v_status in ('failed', 'dead_lettered') then
    update public.pdf_processing_jobs
    set
      status = 'cancelled',
      finished_at = now(),
      error_code = 'prerequisite_failed',
      error_message = 'Elaborazione interrotta perché una fase precedente non è riuscita.',
      progress_stage = 'cancelled'
    where run_id = v_job.run_id
      and id <> v_job.id
      and status in ('queued', 'retry_wait');

    update public.pdf_processing_runs
    set
      status = 'failed',
      jobs_failed = 1,
      current_stage = v_job.job_type,
      finished_at = now()
    where id = v_job.run_id;

    update public.documents
    set
      analysis_status = 'failed',
      analysis_stage = v_job.job_type,
      analysis_error_code = left(coalesce(nullif(trim(p_error_code), ''), 'processing_failed'), 120),
      analysis_updated_at = now(),
      compression_status = case when v_job.job_type = 'compress' then 'failed' else compression_status end,
      metadata = case
        when v_job.job_type = 'compress' then
          coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'upload_state', 'verification_failed',
            'verification_error', left(coalesce(nullif(trim(p_error_code), ''), 'processing_failed'), 120)
          )
        else metadata
      end
    where id = v_job.document_id;
  else
    update public.pdf_processing_runs
    set current_stage = 'retry_wait' where id = v_job.run_id;
    update public.documents
    set analysis_stage = 'retry_wait', analysis_updated_at = now()
    where id = v_job.document_id;
  end if;

  return v_status;
end;
$$;

create or replace function public.cancel_pdf_processing_run(
  p_run uuid,
  p_owner uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document uuid;
begin
  select document_id into v_document
  from public.pdf_processing_runs
  where id = p_run and owner_id = p_owner
  for update;
  if v_document is null then return false; end if;

  update public.pdf_processing_jobs
  set
    status = 'cancelled',
    finished_at = now(),
    lease_token = null,
    lease_expires_at = null,
    error_code = 'cancelled',
    error_message = 'Elaborazione annullata.',
    progress_stage = 'cancelled'
  where run_id = p_run
    and status in ('queued', 'retry_wait', 'running');

  update public.pdf_processing_runs
  set status = 'cancelled', current_stage = 'cancelled', finished_at = now()
  where id = p_run;
  update public.documents
  set
    analysis_status = 'cancelled',
    analysis_stage = 'cancelled',
    analysis_updated_at = now()
  where id = v_document;
  return true;
end;
$$;

-- Worker-authoritative vector reads: never return or rank an inactive artifact
-- version, even if historical embeddings still exist.
create or replace function public.match_rag_chunks(
  query_embedding extensions.vector(768),
  p_embedding_model text,
  p_embedding_version text,
  match_count int default 8,
  filter_document_ids uuid[] default null,
  min_similarity float default 0.0
)
returns table (
  chunk_id uuid,
  document_id uuid,
  page_start int,
  page_end int,
  section_path text[],
  chunk_index int,
  content text,
  structure jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    chunk.id,
    chunk.document_id,
    chunk.page_start,
    chunk.page_end,
    chunk.section_path,
    chunk.chunk_index,
    chunk.content,
    chunk.structure,
    1 - (embedding.embedding <=> query_embedding) as similarity
  from public.rag_chunk_embeddings embedding
  join public.pdf_chunks chunk on chunk.id = embedding.chunk_id
  where embedding.embedding is not null
    and embedding.embedding_status = 'embedded'
    and embedding.content_hash = chunk.content_sha256
    and embedding.document_id = chunk.document_id
    and embedding.embedding_model = p_embedding_model
    and embedding.embedding_version = p_embedding_version
    and chunk.is_active
    and chunk.processing_state <> 'failed'
    and chunk.document_id in (
      select accessible.document_id
      from public.rag_accessible_document_ids((select auth.uid())) accessible
    )
    and (filter_document_ids is null or chunk.document_id = any(filter_document_ids))
    and (1 - (embedding.embedding <=> query_embedding)) >= min_similarity
  order by embedding.embedding <=> query_embedding
  limit greatest(1, least(match_count, 24));
$$;

create or replace function public.rag_document_topic_chunks(
  p_document uuid,
  p_model text,
  p_version text,
  p_limit int default 48
)
returns table (
  chunk_id uuid,
  chunk_index int,
  page_start int,
  page_end int,
  section_path text[],
  content text,
  token_estimate int,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with centroid as (
    select avg(embedding.embedding) as center
    from public.rag_chunk_embeddings embedding
    join public.pdf_chunks chunk on chunk.id = embedding.chunk_id
    where embedding.document_id = p_document
      and embedding.embedding_status = 'embedded'
      and embedding.embedding_model = p_model
      and embedding.embedding_version = p_version
      and embedding.content_hash = chunk.content_sha256
      and chunk.document_id = p_document
      and chunk.is_active
      and chunk.processing_state <> 'failed'
      and embedding.embedding is not null
  )
  select
    chunk.id,
    chunk.chunk_index,
    chunk.page_start,
    chunk.page_end,
    chunk.section_path,
    chunk.content,
    chunk.token_estimate,
    1 - (embedding.embedding <=> (select center from centroid)) as similarity
  from public.rag_chunk_embeddings embedding
  join public.pdf_chunks chunk on chunk.id = embedding.chunk_id
  where embedding.document_id = p_document
    and embedding.embedding_status = 'embedded'
    and embedding.embedding_model = p_model
    and embedding.embedding_version = p_version
    and embedding.content_hash = chunk.content_sha256
    and chunk.document_id = p_document
    and chunk.is_active
    and chunk.processing_state <> 'failed'
    and embedding.embedding is not null
    and (select center from centroid) is not null
  order by embedding.embedding <=> (select center from centroid)
  limit greatest(1, least(p_limit, 120));
$$;

revoke all on function public.enqueue_pdf_processing_run(uuid, uuid, text, text, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.claim_pdf_processing_job(text, integer, text[])
  from public, anon, authenticated;
revoke all on function public.heartbeat_pdf_processing_job(uuid, uuid, integer, text, integer)
  from public, anon, authenticated;
revoke all on function public.refresh_pdf_processing_run(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_pdf_processing_job(uuid, uuid, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.fail_pdf_processing_job(uuid, uuid, text, text, boolean, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.cancel_pdf_processing_run(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.enqueue_pdf_processing_run(uuid, uuid, text, text, text, integer, text)
  to service_role;
grant execute on function public.claim_pdf_processing_job(text, integer, text[])
  to service_role;
grant execute on function public.heartbeat_pdf_processing_job(uuid, uuid, integer, text, integer)
  to service_role;
grant execute on function public.refresh_pdf_processing_run(uuid)
  to service_role;
grant execute on function public.complete_pdf_processing_job(uuid, uuid, jsonb, boolean)
  to service_role;
grant execute on function public.fail_pdf_processing_job(uuid, uuid, text, text, boolean, jsonb, jsonb)
  to service_role;
grant execute on function public.cancel_pdf_processing_run(uuid, uuid)
  to service_role;

revoke all on function public.rag_document_topic_chunks(uuid, text, text, int)
  from public, anon, authenticated;
grant execute on function public.rag_document_topic_chunks(uuid, text, text, int)
  to service_role;

revoke all on function public.match_rag_chunks(extensions.vector, text, text, int, uuid[], float)
  from public, anon;
grant execute on function public.match_rag_chunks(extensions.vector, text, text, int, uuid[], float)
  to authenticated, service_role;

-- Explicit grants are required on projects using the 2026 non-auto-exposed Data
-- API default. RLS still limits owner-visible rows.
grant select on public.pdf_processing_runs to authenticated;
grant all on public.pdf_processing_runs, public.pdf_processing_jobs,
  public.pdf_processing_job_dependencies, public.pdf_processing_job_attempts
  to service_role;
