-- Repair the three public read models that became unreachable after they were
-- correctly switched to SECURITY INVOKER views. The underlying documents,
-- profiles and quality tables intentionally remain private: granting them to
-- anon would expose columns outside the public contract.
--
-- The views stay SECURITY INVOKER. Their only dependency is a set of
-- parameterless, read-only functions in the non-exposed private schema. Each
-- function has a fixed search_path and returns an explicit sanitized shape.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.public_document_catalog_rows()
returns table (
  id uuid,
  seller_id uuid,
  title text,
  course_name text,
  professor text,
  academic_year text,
  page_count integer,
  language text,
  preview_policy text,
  description text,
  exam_type text,
  semester text,
  degree_course text,
  university text,
  tags text[],
  compatible_exams text[],
  insights jsonb,
  price_credits integer,
  flashcard_quality_percent numeric(5,2),
  flashcard_reviewer_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  degree_slug text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    document.id,
    case
      when profile.seller_profile_enabled and profile.public_display_name is not null
        then document.owner_id
      else null::uuid
    end as seller_id,
    document.title,
    document.course_name,
    document.professor,
    document.academic_year,
    document.page_count,
    document.language,
    document.preview_policy,
    document.description,
    document.exam_type,
    document.semester,
    document.degree_course,
    document.university,
    document.tags,
    document.compatible_exams,
    document.insights,
    document.price_credits,
    quality.quality_percent,
    quality.reviewer_count,
    document.created_at,
    document.updated_at,
    document.degree_slug
  from public.documents as document
  join public.profiles as profile on profile.id = document.owner_id
  left join public.document_flashcard_quality_rollups as quality
    on quality.document_id = document.id
  where document.visibility = 'published';
$$;

create or replace function private.public_seller_profile_rows()
returns table (
  id uuid,
  public_display_name text,
  avatar_url text,
  university text,
  degree_course text,
  published_documents integer,
  average_flashcard_quality numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    profile.id,
    profile.public_display_name,
    profile.avatar_url,
    profile.university,
    profile.degree_course,
    count(distinct document.id)::integer as published_documents,
    round(avg(quality.quality_percent), 1) as average_flashcard_quality
  from public.profiles as profile
  join public.documents as document
    on document.owner_id = profile.id
    and document.visibility = 'published'
  left join public.document_flashcard_quality_rollups as quality
    on quality.document_id = document.id
  where profile.seller_profile_enabled = true
    and profile.public_display_name is not null
  group by
    profile.id,
    profile.public_display_name,
    profile.avatar_url,
    profile.university,
    profile.degree_course;
$$;

create or replace function private.accessible_document_flashcard_quality_rows()
returns table (
  document_id uuid,
  reviewer_count integer,
  total_votes integer,
  positive_votes integer,
  negative_votes integer,
  quality_percent numeric(5,2),
  top_positive_topic text,
  most_problematic_topic text,
  computed_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    quality.document_id,
    quality.reviewer_count,
    quality.total_votes,
    quality.positive_votes,
    quality.negative_votes,
    quality.quality_percent,
    quality.top_positive_topic,
    quality.most_problematic_topic,
    quality.computed_at
  from public.document_flashcard_quality_rollups as quality
  join public.documents as document on document.id = quality.document_id
  where document.visibility = 'published'
    or document.owner_id = auth.uid()
    or exists (
      select 1
      from public.document_purchases as purchase
      where purchase.document_id = document.id
        and purchase.buyer_id = auth.uid()
        and purchase.status = 'active'
    );
$$;

revoke all on function private.public_document_catalog_rows()
  from public, anon, authenticated;
revoke all on function private.public_seller_profile_rows()
  from public, anon, authenticated;
revoke all on function private.accessible_document_flashcard_quality_rows()
  from public, anon, authenticated;

grant execute on function private.public_document_catalog_rows()
  to anon, authenticated, service_role;
grant execute on function private.public_seller_profile_rows()
  to anon, authenticated, service_role;
grant execute on function private.accessible_document_flashcard_quality_rows()
  to anon, authenticated, service_role;

create or replace view public.public_document_catalog
with (security_barrier = true, security_invoker = true)
as
select
  catalog.id,
  catalog.seller_id,
  catalog.title,
  catalog.course_name,
  catalog.professor,
  catalog.academic_year,
  catalog.page_count,
  catalog.language,
  catalog.preview_policy,
  catalog.description,
  catalog.exam_type,
  catalog.semester,
  catalog.degree_course,
  catalog.university,
  catalog.tags,
  catalog.compatible_exams,
  catalog.insights,
  catalog.price_credits,
  catalog.flashcard_quality_percent::numeric(5,2) as flashcard_quality_percent,
  catalog.flashcard_reviewer_count,
  catalog.created_at,
  catalog.updated_at,
  catalog.degree_slug
from private.public_document_catalog_rows() as catalog;

create or replace view public.public_seller_profiles
with (security_barrier = true, security_invoker = true)
as
select * from private.public_seller_profile_rows();

create or replace view public.public_document_flashcard_quality
with (security_barrier = true, security_invoker = true)
as
select
  quality.document_id,
  quality.reviewer_count,
  quality.total_votes,
  quality.positive_votes,
  quality.negative_votes,
  quality.quality_percent::numeric(5,2) as quality_percent,
  quality.top_positive_topic,
  quality.most_problematic_topic,
  quality.computed_at
from private.accessible_document_flashcard_quality_rows() as quality;

revoke all on public.public_document_catalog from public;
revoke all on public.public_seller_profiles from public;
revoke all on public.public_document_flashcard_quality from public;
grant select on public.public_document_catalog to anon, authenticated;
grant select on public.public_seller_profiles to anon, authenticated;
grant select on public.public_document_flashcard_quality to anon, authenticated;

comment on function private.public_document_catalog_rows() is
  'Sanitized published-document projection used only by the public invoker view.';
comment on function private.public_seller_profile_rows() is
  'Opt-in seller projection used only by the public invoker view.';
comment on function private.accessible_document_flashcard_quality_rows() is
  'Quality projection limited to published, owned or actively purchased documents.';

do $$
begin
  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'public_document_catalog',
        'public_seller_profiles',
        'public_document_flashcard_quality'
      )
      and not (coalesce(relation.reloptions, '{}') @> array['security_invoker=true'])
  ) then
    raise exception 'public_read_model_security_invoker_invariant_failed'
      using errcode = '42501';
  end if;

  if has_table_privilege('anon', 'public.documents', 'select')
    or has_table_privilege('anon', 'public.profiles', 'select')
    or has_table_privilege('anon', 'public.document_flashcard_quality_rollups', 'select') then
    raise exception 'public_read_model_base_table_exposure_invariant_failed'
      using errcode = '42501';
  end if;
end;
$$;

notify pgrst, 'reload schema';
