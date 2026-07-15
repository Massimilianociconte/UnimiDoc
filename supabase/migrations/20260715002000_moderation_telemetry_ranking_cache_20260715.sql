-- Moderazione, telemetria privacy-friendly e cache materializzata dei ranking.
--
-- 1) Moderatori + RPC di moderazione: coda dei documenti inviati, publish/
--    reject con audit, gestione segnalazioni. SECURITY DEFINER con controllo
--    esplicito app_private.is_moderator(); EXECUTE solo ad authenticated.
-- 2) usage_events: eventi d'uso anonimi/minimi (nessun PII, insert-only,
--    nessuna lettura client) per arricchire ranking e decisioni di prodotto.
--    Retention 180 giorni via pg_cron.
-- 3) Ranking scalabile: materialized view alimentate dalle funzioni
--    app_private.*_rankings_fn, refresh concorrente ogni 15 minuti via
--    pg_cron; le viste pubbliche leggono dalla cache (staleness max 15').

-- ---------------------------------------------------------------------------
-- 1a) Moderatori
-- ---------------------------------------------------------------------------
create table if not exists app_private.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

create or replace function app_private.is_moderator()
returns boolean
language sql stable security definer
set search_path to 'app_private', 'pg_temp'
as $$ select exists (select 1 from app_private.moderators m where m.user_id = auth.uid()) $$;

revoke all on function app_private.is_moderator() from public, anon;
grant execute on function app_private.is_moderator() to authenticated;

-- Primo moderatore: account fondatore.
insert into app_private.moderators (user_id, note)
select id, 'founder' from auth.users where email = 'massimilianociconte9@gmail.com'
on conflict (user_id) do nothing;

-- Audit delle decisioni di moderazione.
create table if not exists app_private.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references auth.users(id),
  document_id uuid,
  report_id uuid,
  action text not null check (action in ('publish', 'reject', 'report_dismissed', 'report_upheld', 'report_reviewing')),
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1b) RPC moderazione — verificano is_moderator() internamente.
-- ---------------------------------------------------------------------------
create or replace function public.moderation_is_moderator()
returns boolean
language sql stable security definer
set search_path to 'app_private', 'pg_temp'
as $$ select app_private.is_moderator() $$;

revoke all on function public.moderation_is_moderator() from public, anon;
grant execute on function public.moderation_is_moderator() to authenticated;

create or replace function public.moderation_queue()
returns table (
  document_id uuid, title text, course_name text, professor text,
  degree_slug text, academic_year text, page_count integer,
  price_credits integer, owner_email text, submitted_at timestamptz,
  ai_quality numeric, open_reports integer
)
language plpgsql stable security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $$
begin
  if not app_private.is_moderator() then
    raise exception 'not_moderator';
  end if;
  return query
  select d.id, d.title, d.course_name, d.professor, d.degree_slug,
         d.academic_year, d.page_count, d.price_credits,
         u.email::text, d.updated_at,
         dq.overall_score,
         (select count(*)::int from public.document_reports r
           where r.document_id = d.id and r.status in ('open', 'reviewing'))
  from public.documents d
  join auth.users u on u.id = d.owner_id
  left join public.document_quality_reports dq on dq.document_id = d.id
  where d.visibility = 'submitted'
  order by d.updated_at asc;
end;
$$;

create or replace function public.moderate_document(p_document uuid, p_action text, p_note text default null)
returns void
language plpgsql security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $$
begin
  if not app_private.is_moderator() then
    raise exception 'not_moderator';
  end if;
  if p_action not in ('publish', 'reject') then
    raise exception 'invalid_action';
  end if;
  update public.documents
     set visibility = case p_action when 'publish' then 'published' else 'rejected' end,
         updated_at = now()
   where id = p_document and visibility = 'submitted';
  if not found then
    raise exception 'document_not_in_queue';
  end if;
  insert into app_private.moderation_actions (moderator_id, document_id, action, note)
  values (auth.uid(), p_document, p_action, left(coalesce(p_note, ''), 500));
end;
$$;

create or replace function public.moderation_reports()
returns table (
  report_id uuid, document_id uuid, document_title text, reason text,
  details text, status text, created_at timestamptz
)
language plpgsql stable security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $$
begin
  if not app_private.is_moderator() then
    raise exception 'not_moderator';
  end if;
  return query
  select r.id, r.document_id, d.title, r.reason, r.details, r.status, r.created_at
  from public.document_reports r
  join public.documents d on d.id = r.document_id
  where r.status in ('open', 'reviewing')
  order by r.created_at asc;
end;
$$;

create or replace function public.resolve_document_report(p_report uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $$
begin
  if not app_private.is_moderator() then
    raise exception 'not_moderator';
  end if;
  if p_status not in ('reviewing', 'dismissed', 'upheld') then
    raise exception 'invalid_status';
  end if;
  update public.document_reports set status = p_status where id = p_report;
  if not found then
    raise exception 'report_not_found';
  end if;
  insert into app_private.moderation_actions (moderator_id, report_id, action, note)
  values (auth.uid(), p_report,
          case p_status when 'dismissed' then 'report_dismissed'
                         when 'upheld' then 'report_upheld'
                         else 'report_reviewing' end,
          left(coalesce(p_note, ''), 500));
end;
$$;

revoke all on function public.moderation_queue() from public, anon;
revoke all on function public.moderate_document(uuid, text, text) from public, anon;
revoke all on function public.moderation_reports() from public, anon;
revoke all on function public.resolve_document_report(uuid, text, text) from public, anon;
grant execute on function public.moderation_queue() to authenticated;
grant execute on function public.moderate_document(uuid, text, text) to authenticated;
grant execute on function public.moderation_reports() to authenticated;
grant execute on function public.resolve_document_report(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Telemetria minima (nessun PII: niente IP, niente user agent; user_id
--    facoltativo solo per utenti autenticati, query troncata).
-- ---------------------------------------------------------------------------
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  event text not null check (event in (
    'document_preview', 'document_download', 'document_open',
    'search', 'search_no_results', 'degree_page_view'
  )),
  document_id uuid,
  degree_slug text check (degree_slug is null or degree_slug ~ '^[a-z0-9-]{1,80}$'),
  query text check (query is null or char_length(query) <= 120),
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_event_created_idx on public.usage_events (event, created_at desc);
create index if not exists usage_events_document_idx on public.usage_events (document_id) where document_id is not null;

alter table public.usage_events enable row level security;

drop policy if exists usage_events_insert on public.usage_events;
create policy usage_events_insert on public.usage_events
  for insert to anon, authenticated with check (
    user_id is null or user_id = auth.uid()
  );
-- nessuna policy SELECT: la lettura è riservata a service role / analisi.

revoke all on public.usage_events from anon, authenticated;
grant insert (event, document_id, degree_slug, query, user_id) on public.usage_events to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Cache materializzata dei ranking + refresh e retention via pg_cron.
--    Le MV vivono in public (dati già pubblici per definizione delle viste),
--    con indice unico per il refresh concorrente.
-- ---------------------------------------------------------------------------
create materialized view if not exists public.document_rankings_cache as
select * from app_private.public_document_rankings_fn();

create unique index if not exists document_rankings_cache_pk on public.document_rankings_cache (document_id);
create index if not exists document_rankings_cache_degree_idx on public.document_rankings_cache (degree_slug, overall_score desc);
create index if not exists document_rankings_cache_course_idx on public.document_rankings_cache (course_name, overall_score desc);

create materialized view if not exists public.author_rankings_cache as
select * from app_private.public_author_rankings_fn();

create unique index if not exists author_rankings_cache_pk on public.author_rankings_cache (author_id);

revoke all on public.document_rankings_cache from anon, authenticated;
revoke all on public.author_rankings_cache from anon, authenticated;
grant select on public.document_rankings_cache to anon, authenticated;
grant select on public.author_rankings_cache to anon, authenticated;

-- Le viste pubbliche diventano letture dalla cache: costo O(1) per richiesta,
-- staleness massima pari alla frequenza del refresh (15 minuti).
create or replace view public.public_document_rankings
with (security_invoker = true) as
select * from public.document_rankings_cache;

create or replace view public.public_author_rankings
with (security_invoker = true) as
select * from public.author_rankings_cache;

revoke all on public.public_document_rankings from anon, authenticated;
revoke all on public.public_author_rankings from anon, authenticated;
grant select on public.public_document_rankings to anon, authenticated;
grant select on public.public_author_rankings to anon, authenticated;

create or replace function app_private.refresh_ranking_caches()
returns void
language plpgsql security definer
set search_path to 'public', 'app_private', 'pg_temp'
as $$
begin
  refresh materialized view concurrently public.document_rankings_cache;
  refresh materialized view concurrently public.author_rankings_cache;
end;
$$;

revoke all on function app_private.refresh_ranking_caches() from public, anon, authenticated;

create or replace function app_private.purge_old_usage_events()
returns void
language sql security definer
set search_path to 'public', 'pg_temp'
as $$ delete from public.usage_events where created_at < now() - interval '180 days' $$;

revoke all on function app_private.purge_old_usage_events() from public, anon, authenticated;

-- pg_cron: idempotente (unschedule se già presenti).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'refresh-ranking-caches';
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-usage-events';
exception when others then null;
end $$;

select cron.schedule('refresh-ranking-caches', '*/15 * * * *', $$select app_private.refresh_ranking_caches()$$);
select cron.schedule('purge-usage-events', '30 3 * * *', $$select app_private.purge_old_usage_events()$$);
