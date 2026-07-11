-- Forward-only hardening: a worker must never claim a job produced by an
-- incompatible pipeline release. The legacy unversioned RPC remains in schema
-- for history compatibility but loses service_role execution.

create or replace function public.claim_pdf_processing_job_versioned(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_allowed_job_types text[] default null,
  p_pipeline_version text default 'pdf-worker-v1'
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
  if char_length(trim(coalesce(p_pipeline_version, ''))) not between 1 and 80 then
    raise exception 'invalid_pipeline_version' using errcode = '22023';
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
      and run.pipeline_version = trim(p_pipeline_version)
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
revoke all on function public.claim_pdf_processing_job_versioned(text, integer, text[], text)
  from public, anon, authenticated;
grant execute on function public.claim_pdf_processing_job_versioned(text, integer, text[], text)
  to service_role;
revoke execute on function public.claim_pdf_processing_job(text, integer, text[])
  from service_role;

-- Abort deployment if either browser roles can claim work or service_role can
-- still bypass the pipeline-version filter through the legacy entrypoint.
do $$
begin
  if has_function_privilege('anon', 'public.claim_pdf_processing_job_versioned(text,integer,text[],text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_pdf_processing_job_versioned(text,integer,text[],text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.claim_pdf_processing_job(text,integer,text[])', 'EXECUTE') then
    raise exception 'pdf_versioned_claim_acl_invariant_failed' using errcode = '42501';
  end if;
end;
$$;
