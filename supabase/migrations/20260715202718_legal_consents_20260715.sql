-- Versioned acceptance log for legal documents (terms, privacy, ...).
-- One row per (user, document, version): re-accepting the same version is a
-- no-op, a new LEGAL_VERSION requires a fresh acceptance row. Writes go only
-- through record_legal_acceptance so user_id/version cannot be forged.

create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_type text not null,
  legal_version text not null,
  accepted_at timestamptz not null default now(),
  locale text not null default 'it-IT',
  constraint legal_consents_document_type_check check (
    document_type in ('terms', 'privacy', 'cookies', 'sales', 'refunds', 'authors', 'content', 'ai', 'copyright')
  ),
  constraint legal_consents_version_format check (legal_version ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint legal_consents_locale_length check (char_length(locale) between 2 and 20),
  constraint legal_consents_unique unique (user_id, document_type, legal_version)
);

create index if not exists legal_consents_user_idx
  on public.legal_consents (user_id, accepted_at desc);

alter table public.legal_consents enable row level security;

revoke all on table public.legal_consents from anon, authenticated;
grant select on table public.legal_consents to authenticated;

drop policy if exists legal_consents_select_own on public.legal_consents;
create policy legal_consents_select_own on public.legal_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.record_legal_acceptance(
  p_document_types text[],
  p_legal_version text,
  p_locale text default 'it-IT'
) returns setof public.legal_consents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_type text;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  if p_document_types is null or array_length(p_document_types, 1) is null then
    raise exception 'document_types_required' using errcode = 'P0001';
  end if;
  if array_length(p_document_types, 1) > 16 then
    raise exception 'too_many_document_types' using errcode = 'P0001';
  end if;
  if p_legal_version is null or p_legal_version !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'invalid_legal_version' using errcode = 'P0001';
  end if;

  foreach v_type in array p_document_types loop
    if v_type not in ('terms', 'privacy', 'cookies', 'sales', 'refunds', 'authors', 'content', 'ai', 'copyright') then
      raise exception 'invalid_document_type' using errcode = 'P0001';
    end if;
    insert into public.legal_consents (user_id, document_type, legal_version, locale)
    values (v_user, v_type, p_legal_version, coalesce(nullif(trim(p_locale), ''), 'it-IT'))
    on conflict (user_id, document_type, legal_version) do nothing;
  end loop;

  return query
    select consents.*
    from public.legal_consents consents
    where consents.user_id = v_user
      and consents.legal_version = p_legal_version
      and consents.document_type = any (p_document_types);
end;
$$;

revoke all on function public.record_legal_acceptance(text[], text, text) from public, anon;
grant execute on function public.record_legal_acceptance(text[], text, text) to authenticated;
