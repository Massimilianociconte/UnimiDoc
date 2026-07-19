-- fix_ocr_runs_job_conflict_for_upsert
--
-- Il worker usa:
--   ON CONFLICT (job_id)
--
-- L'indice precedente era parziale:
--   UNIQUE (job_id) WHERE job_id IS NOT NULL
--
-- PostgREST non include il predicato nell'ON CONFLICT, quindi PostgreSQL
-- non può inferire quell'indice. Un indice UNIQUE normale è sufficiente:
-- PostgreSQL consente comunque più valori NULL.

do $$
begin
  if exists (
    select 1
    from public.ocr_runs
    where job_id is not null
    group by job_id
    having count(*) > 1
  ) then
    raise exception
      'Impossibile correggere ocr_runs: esistono job_id duplicati non nulli';
  end if;
end;
$$;

drop index if exists public.ocr_runs_job_idx;

create unique index ocr_runs_job_idx
  on public.ocr_runs (job_id);

comment on index public.ocr_runs_job_idx is
  'Consente UPSERT ON CONFLICT(job_id); valori NULL multipli restano ammessi.';
