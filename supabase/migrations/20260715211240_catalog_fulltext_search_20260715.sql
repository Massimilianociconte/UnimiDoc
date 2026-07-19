-- Ricerca full-text server-side del catalogo (Postgres FTS, config italiana)
-- con filtri strutturati e paginazione stabile. Sostituisce progressivamente
-- il filtro client; pgvector resta per la ricerca semantica (RAG).
-- Nota: i tag non entrano nell'espressione FTS perché array_to_string non è
-- IMMUTABLE (requisito degli indici funzionali); title/corso/docente/
-- descrizione/corso di laurea coprono le query reali del catalogo.

create index if not exists documents_fts_published_idx
  on public.documents using gin (
    to_tsvector('italian',
      coalesce(title, '') || ' ' ||
      coalesce(course_name, '') || ' ' ||
      coalesce(professor, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(degree_course, '')))
  where visibility = 'published';

create or replace function public.search_documents(
  p_query text default null,
  p_course text default null,
  p_professor text default null,
  p_university text default null,
  p_degree_slug text default null,
  p_academic_year text default null,
  p_seller uuid default null,
  p_exam_type text default null,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  id uuid,
  seller_id uuid,
  title text,
  course_name text,
  professor text,
  academic_year text,
  page_count int,
  language text,
  preview_policy text,
  description text,
  exam_type text,
  semester text,
  degree_course text,
  degree_slug text,
  university text,
  tags text[],
  price_credits int,
  created_at timestamptz,
  updated_at timestamptz,
  rank real,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with query as (
    select case
      when p_query is null or length(trim(p_query)) < 2 then null
      else websearch_to_tsquery('italian', p_query)
    end as ts
  ),
  base as (
    select d.*,
      case when q.ts is null then 0
        else ts_rank(
          to_tsvector('italian',
            coalesce(d.title, '') || ' ' ||
            coalesce(d.course_name, '') || ' ' ||
            coalesce(d.professor, '') || ' ' ||
            coalesce(d.description, '') || ' ' ||
            coalesce(d.degree_course, '')), q.ts)
      end::real as rank
    from public.documents d cross join query q
    where d.visibility = 'published'
      and (q.ts is null or to_tsvector('italian',
            coalesce(d.title, '') || ' ' ||
            coalesce(d.course_name, '') || ' ' ||
            coalesce(d.professor, '') || ' ' ||
            coalesce(d.description, '') || ' ' ||
            coalesce(d.degree_course, '')) @@ q.ts)
      and (p_course is null or d.course_name ilike p_course)
      and (p_professor is null or d.professor ilike '%' || p_professor || '%')
      and (p_university is null or d.university ilike p_university)
      and (p_degree_slug is null or d.degree_slug = p_degree_slug)
      and (p_academic_year is null or d.academic_year = p_academic_year)
      and (p_seller is null or d.owner_id = p_seller)
      and (p_exam_type is null or d.exam_type ilike p_exam_type)
  )
  select
    b.id, b.owner_id as seller_id, b.title, b.course_name, b.professor,
    b.academic_year, b.page_count, b.language, b.preview_policy, b.description,
    b.exam_type, b.semester, b.degree_course, b.degree_slug, b.university,
    b.tags, b.price_credits, b.created_at, b.updated_at, b.rank,
    count(*) over () as total_count
  from base b
  order by
    case when p_sort = 'recent' then b.created_at end desc,
    case when p_sort = 'price_asc' then b.price_credits end asc,
    case when p_sort = 'price_desc' then b.price_credits end desc,
    b.rank desc,
    b.created_at desc,
    b.id
  limit greatest(1, least(coalesce(p_limit, 24), 60))
  offset greatest(0, coalesce(p_offset, 0))
$$;

revoke all on function public.search_documents(text, text, text, text, text, text, uuid, text, text, int, int) from public;
grant execute on function public.search_documents(text, text, text, text, text, text, uuid, text, text, int, int) to anon, authenticated;
